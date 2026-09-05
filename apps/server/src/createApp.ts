import path from "node:path";
import { homedir, networkInterfaces } from "node:os";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { listLanIpv4Candidates, pickDefaultLanIpv4, type NetIfaceMap } from "./lanAddresses.js";
import { openMatchStore, type MatchStore } from "./matchStore.js";
import { openRoomStore, type RoomStore } from "./roomStore.js";
import type { RoomRegistry } from "./roomRegistry.js";
import {
  CSRF_HEADER,
  SESSION_COOKIE,
  allowedOrigins,
  createSessionStore,
  parseCookies,
  serializeCookie,
  type SessionRecord,
  type SessionStore,
} from "./sessionAuth.js";
import { createGameRoomStack } from "./platform/gameRoomStack.js";
import type { GameHostContext } from "./platform/gameModule.js";
import {
  coupGameStore,
  coupModule,
  coupRoomPersistence,
  persistenceForStore,
} from "./games/coupModule.js";
import { brassGameStore, brassModule } from "./brass/brassModule.js";
import { openBrassStore } from "./brass/brassStore.js";
import { splendorGameStore, splendorModule } from "./splendor/splendorModule.js";
import { openSplendorStore } from "./splendor/splendorStore.js";
import { catanGameStore, catanModule } from "./catan/catanModule.js";
import { openCatanStore } from "./catan/catanStore.js";
import { createSeatPresenceTracker, type SeatPresenceTracker } from "./seatPresenceTracker.js";

export type BindMode = "local" | "host";

export type HostingState = {
  bindMode: BindMode;
  listenHost: string;
  port: number;
};

export type HostingController = {
  getState(): HostingState;
  ensureHostMode(): Promise<HostingState & { bindMode: "host" }>;
};

export type CreateAppOptions = {
  webRoot: string;
  /** SQLite path; defaults to ~/.coup/coup.sqlite. */
  dbPath?: string;
  /** Inject an already-open store (tests). */
  store?: MatchStore;
  /** Host bind / rebind control (omit in pure inject tests that stub it). */
  hosting?: HostingController;
  listNetworkInterfaces?: () => NetIfaceMap;
  /** Inject a prebuilt room registry (tests, coup stack). */
  rooms?: RoomRegistry;
  sessions?: SessionStore;
  /** Injectable clock for absence timers (tests). */
  now?: () => number;
  presence?: SeatPresenceTracker;
  /** Room persistence (defaults to same dbPath as MatchStore). */
  roomStore?: RoomStore;
  /** Injectable bot decision delay for all stacks (tests). */
  botDecisionDelayMs?: () => number;
};

function defaultDbPath() {
  return path.join(homedir(), ".coup", "coup.sqlite");
}

export { persistenceForStore };

/**
 * 应用外壳（ADR-0010）：只负责会话/CSRF、Origin 白名单、主机模式与静态资源；
 * 两款游戏的房间/对局栈由 platform/gameRoomStack 按 GameModule 挂载，
 * coup 与 brass 共用同一份房间编排实现与同一批集成测试。
 */
export async function createApp(options: CreateAppOptions) {
  const app = Fastify({
    logger: false,
    // 将来经 Nginx 反代（域名）时开启，让 request.ip 取真实客户端 IP；
    // 直连 IP:8787 时保持默认（socket IP）。
    trustProxy: process.env.COUP_TRUST_PROXY === "1",
  });
  const dbPath = options.dbPath ?? defaultDbPath();
  const store = options.store ?? openMatchStore(dbPath);
  const roomStore = options.roomStore ?? openRoomStore(dbPath);
  const brassStore = openBrassStore(dbPath);
  const splendorStore = openSplendorStore(dbPath);
  const catanStore = openCatanStore(dbPath);
  // 旧库迁移：把无 room_code 的历史 run 归位到其房间（须在栈恢复房间前执行）。
  store.migrateLegacyRuns(roomStore.loadRooms().rooms);
  const sessions = options.sessions ?? createSessionStore();
  const listIfaces = options.listNetworkInterfaces ?? networkInterfaces;
  const envOrigins = (process.env.COUP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const publicHost = process.env.COUP_PUBLIC_HOST?.trim() || null;
  let selectedLanHost: string | null = null;

  function currentAllowedOrigins(): string[] {
    const state = options.hosting?.getState();
    const port = state?.port ?? 0;
    const candidates = listLanIpv4Candidates(listIfaces() as NetIfaceMap);
    const addresses = candidates.map((c) => c.address);
    const hosts = [
      ...addresses,
      ...(selectedLanHost && !addresses.includes(selectedLanHost)
        ? [selectedLanHost]
        : []),
    ];
    return [
      ...new Set([...allowedOrigins({ port, lanHosts: hosts }), ...envOrigins]),
    ];
  }

  function originAllowed(origin: string | undefined): boolean {
    if (!origin) return false;
    return currentAllowedOrigins().includes(origin);
  }

  /** Prefer Origin; same-origin GET may omit it — fall back to Host. */
  function requestEntryAllowed(request: {
    headers: { origin?: unknown; host?: unknown };
  }): boolean {
    const origin = request.headers.origin;
    if (typeof origin === "string" && originAllowed(origin)) return true;
    if (origin === undefined || origin === null || origin === "") {
      const host = request.headers.host;
      if (typeof host === "string" && host.length > 0) {
        return originAllowed(`http://${host}`);
      }
    }
    return false;
  }

  function appendSetCookie(reply: { getHeader: (name: string) => unknown; header: (name: string, value: string | string[]) => unknown }, value: string) {
    const existing = reply.getHeader("set-cookie");
    if (!existing) {
      reply.header("set-cookie", value);
      return;
    }
    if (Array.isArray(existing)) {
      reply.header("set-cookie", [...existing.map(String), value]);
      return;
    }
    reply.header("set-cookie", [String(existing), value]);
  }

  function requireSession(
    request: { headers: Record<string, unknown> },
    reply: {
      code: (status: number) => { send: (body: unknown) => unknown };
    },
  ): SessionRecord | null {
    if (
      !requestEntryAllowed({
        headers: {
          origin: request.headers.origin,
          host: request.headers.host,
        },
      })
    ) {
      reply.code(403).send({ error: "origin_not_allowed" });
      return null;
    }
    const cookies = parseCookies(
      typeof request.headers.cookie === "string"
        ? request.headers.cookie
        : undefined,
    );
    const session = cookies[SESSION_COOKIE]
      ? sessions.get(cookies[SESSION_COOKIE])
      : null;
    if (!session) {
      reply.code(401).send({ error: "session_required" });
      return null;
    }
    const csrf = request.headers[CSRF_HEADER];
    if (typeof csrf !== "string" || csrf.length === 0) {
      reply.code(403).send({ error: "csrf_required" });
      return null;
    }
    if (csrf !== session.csrfToken) {
      reply.code(403).send({ error: "csrf_invalid" });
      return null;
    }
    return session;
  }

  function getHostContext(): GameHostContext | null {
    const state = options.hosting?.getState();
    if (!state) return null;
    const candidates = listLanIpv4Candidates(listIfaces() as NetIfaceMap);
    const addresses = candidates.map((c) => c.address);
    if (selectedLanHost && !addresses.includes(selectedLanHost)) {
      selectedLanHost = null;
    }
    const lanHost = publicHost ?? selectedLanHost ?? pickDefaultLanIpv4(candidates);
    if (lanHost && !publicHost) {
      selectedLanHost = lanHost;
    }
    return { bindMode: state.bindMode, port: state.port, lanHost, candidates: addresses };
  }

  const now = () => (options.now ? options.now() : Date.now());

  // coup：/api/rooms…（沿用旧路径，前端无需迁移）；brass：/api/brass/rooms…。
  createGameRoomStack(app, {
    module: coupModule,
    store: coupGameStore(store),
    roomPersistence: coupRoomPersistence(roomStore),
    requireSession,
    appendSetCookie,
    getHostContext,
    hostingAvailable: options.hosting != null,
    now,
    presence: options.presence,
    registry: options.rooms,
    botDecisionDelayMs: options.botDecisionDelayMs,
  });
  createGameRoomStack(app, {
    module: brassModule,
    store: brassGameStore(brassStore),
    roomPersistence: {
      saveRoom: (room) => brassStore.saveBrassRoom(room),
      clearRoom: (code) => brassStore.clearBrassRoom(code),
      loadRooms: () => brassStore.loadBrassRooms(),
    },
    requireSession,
    appendSetCookie,
    getHostContext,
    hostingAvailable: options.hosting != null,
    now,
    botDecisionDelayMs: options.botDecisionDelayMs,
  });
  createGameRoomStack(app, {
    module: splendorModule,
    store: splendorGameStore(splendorStore),
    roomPersistence: {
      saveRoom: (room) => splendorStore.saveSplendorRoom(room),
      clearRoom: (code) => splendorStore.clearSplendorRoom(code),
      loadRooms: () => splendorStore.loadSplendorRooms(),
    },
    requireSession,
    appendSetCookie,
    getHostContext,
    hostingAvailable: options.hosting != null,
    now,
    botDecisionDelayMs: options.botDecisionDelayMs,
  });
  createGameRoomStack(app, {
    module: catanModule,
    store: catanGameStore(catanStore),
    roomPersistence: {
      saveRoom: (room) => catanStore.saveCatanRoom(room),
      clearRoom: (code) => catanStore.clearCatanRoom(code),
      loadRooms: () => catanStore.loadCatanRooms(),
    },
    requireSession,
    appendSetCookie,
    getHostContext,
    hostingAvailable: options.hosting != null,
    now,
    botDecisionDelayMs: options.botDecisionDelayMs,
  });

  app.addHook("onClose", async () => {
    store.close();
    roomStore.close();
    brassStore.close();
    splendorStore.close();
    catanStore.close();
  });

  app.get("/api/session", async (request, reply) => {
    if (!requestEntryAllowed(request)) {
      return reply.code(403).send({ error: "origin_not_allowed" });
    }
    const cookies = parseCookies(request.headers.cookie);
    const existing = cookies[SESSION_COOKIE]
      ? sessions.get(cookies[SESSION_COOKIE])
      : null;
    const session = existing ?? sessions.create();
    reply.header(
      "set-cookie",
      serializeCookie(SESSION_COOKIE, session.id),
    );
    return reply.send({
      csrfToken: session.csrfToken,
      allowedOrigins: currentAllowedOrigins(),
    });
  });

  app.get("/api/hosting", async (_request, reply) => {
    // Public, read-only probe of the bind state.
    reply.header("access-control-allow-origin", "*");
    const state = options.hosting?.getState() ?? {
      bindMode: "local" as const,
      listenHost: "127.0.0.1",
      port: 0,
    };
    const candidates = listLanIpv4Candidates(listIfaces() as NetIfaceMap);
    return reply.send({
      ...state,
      candidates: candidates.map((c) => c.address),
      selectedHost: publicHost ?? selectedLanHost ?? pickDefaultLanIpv4(candidates),
    });
  });

  app.post("/api/hosting/enter", async (_request, reply) => {
    if (!options.hosting) {
      return reply.code(500).send({ error: "hosting_unavailable" });
    }
    const current = options.hosting.getState();
    if (current.bindMode === "host") {
      return reply.send({
        status: "ready",
        ...current,
        candidates: [],
        selectedHost: publicHost ?? null,
      });
    }
    // Flush response before rebinding — server.close() waits for in-flight
    // requests, so the rebind must happen after this request has finished.
    const payload = {
      status: "rebinding" as const,
      preferredPort: 8787,
      candidates: [],
      retryOrigins: [],
    };
    void reply.then(
      () => {
        queueMicrotask(() => {
          void options.hosting?.ensureHostMode().catch(() => {
            /* bind errors surface on next client poll */
          });
        });
      },
      () => undefined,
    );
    return reply.send(payload);
  });

  await app.register(fastifyStatic, {
    root: options.webRoot,
  });

  app.setNotFoundHandler(async (request, reply) => {
    if (request.method === "GET" && !request.url.startsWith("/api")) {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({ error: "not_found" });
  });

  return app;
}
