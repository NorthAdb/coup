import path from "node:path";
import { homedir, networkInterfaces } from "node:os";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { activeDecidingSeatId, forceEliminateForHostAbsence } from "@coup/domain";
import type { SeatDecision } from "@coup/protocol";
import {
  startMatch,
  submitHumanDecision,
  toSeatView,
  type ActiveMatch,
  type MatchPersistence,
} from "./matchRuntime.js";
import { openMatchStore, type MatchRunRecord, type MatchStore } from "./matchStore.js";
import {
  listLanIpv4Candidates,
  pickDefaultLanIpv4,
  type NetIfaceMap,
} from "./lanAddresses.js";
import {
  evaluateLobbyStartGates,
  lobbySeatsToMatchSetup,
} from "./lobbyStart.js";
import {
  createRoomRegistry,
  publicSeats,
  roomInvitePayload,
  type RoomRecord,
  type RoomRegistry,
} from "./roomRegistry.js";
import { openRoomStore, type RoomStore } from "./roomStore.js";
import {
  IDLE_ROOM_RECLAIM_MS,
  isRoomEmpty,
  MAX_ROOMS,
} from "./roomLifecycle.js";
import {
  CSRF_HEADER,
  SEAT_COOKIE,
  SESSION_COOKIE,
  allowedOrigins,
  createSessionStore,
  hashToken,
  issueSeatToken,
  parseCookies,
  serializeCookie,
  type SessionRecord,
  type SessionStore,
} from "./sessionAuth.js";
import {
  createSeatPresenceTracker,
  type SeatPresenceTracker,
} from "./seatPresenceTracker.js";

export type BindMode = "local" | "host";

export type RoomRecoveryStatus = "none" | "restored" | "failed";

type RoomRecoveryRecord = {
  code: string;
  status: RoomRecoveryStatus;
  reason: string | null;
  room: RoomRecord | null;
};

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
  rooms?: RoomRegistry;
  sessions?: SessionStore;
  /** Injectable clock for absence timers (tests). */
  now?: () => number;
  presence?: SeatPresenceTracker;
  /** Room persistence (defaults to same dbPath as MatchStore). */
  roomStore?: RoomStore;
};

function defaultDbPath() {
  return path.join(homedir(), ".coup", "coup.sqlite");
}

export function activeMatchFromRun(run: MatchRunRecord): ActiveMatch {
  return {
    state: run.state,
    events: run.events,
    humanSeatId: run.humanSeatId,
    displayNames: run.displayNames,
  };
}

function humanFacingPayload(
  match: ActiveMatch,
  requestId?: string,
  seatId = match.humanSeatId,
) {
  return {
    view: toSeatView(match, seatId, requestId),
    decisionRationales: {},
  };
}

export function persistenceForStore(store: MatchStore): MatchPersistence {
  return {
    onCreated(match, roomCode) {
      if (!roomCode) throw new Error("room_code_required");
      store.createRun({
        matchId: match.state.matchId,
        roomCode,
        humanSeatId: match.humanSeatId,
        displayNames: match.displayNames,
        seatAgents: {},
        state: match.state,
        events: match.events,
      });
    },
    onCommitted(match, newEvents) {
      if (newEvents.length === 0) return;
      store.commitCommand(match.state.matchId, match.state, newEvents);
    },
  };
}

function abortReasonFrom(error: unknown): string {
  if (!(error instanceof Error) || !error.message) {
    return "technical_failure";
  }
  const message = error.message;
  const colon = message.indexOf(":");
  const head = (colon >= 0 ? message.slice(0, colon) : message).trim();
  const known = new Set([
    "match_requires_local_human",
    "illegal_decision",
    "persistence_failed",
    "technical_failure",
  ]);
  if (known.has(head)) return head;
  if (known.has(message)) return message;
  // Never persist raw error text — only a stable category token.
  return "technical_failure";
}

/**
 * 房间号限速：对查询失败的来源 IP 计数，超过阈值直接 429，
 * 把 4 位房间号的穷举从分钟级拖到小时级。
 */
function createRoomCodeThrottle(limit = 10, windowMs = 60_000) {
  const fails = new Map<string, number[]>();
  return {
    recordFail(ip: string) {
      const now = Date.now();
      const recent = (fails.get(ip) ?? []).filter((t) => now - t < windowMs);
      recent.push(now);
      fails.set(ip, recent);
    },
    blocked(ip: string): boolean {
      const now = Date.now();
      const recent = (fails.get(ip) ?? []).filter((t) => now - t < windowMs);
      fails.set(ip, recent);
      return recent.length >= limit;
    },
    clear(ip: string) {
      fails.delete(ip);
    },
  };
}

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
  const initialRooms = roomStore.loadRooms();
  store.migrateLegacyRuns(initialRooms.rooms);
  const persistence = persistenceForStore(store);
  const rooms = options.rooms ?? createRoomRegistry();
  const sessions = options.sessions ?? createSessionStore();
  const listIfaces = options.listNetworkInterfaces ?? networkInterfaces;
  const envOrigins = (process.env.COUP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const publicHost = process.env.COUP_PUBLIC_HOST?.trim() || null;
  const roomCodeThrottle = createRoomCodeThrottle();
  let selectedLanHost: string | null = null;
  const recovery = new Map<string, RoomRecoveryRecord>();

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

  const matchesByRoom = new Map<string, ActiveMatch>();
  const roomActivity = new Map<
    string,
    { lastActivityAt: number; emptySince: number | null }
  >();
  const presence = options.presence ?? createSeatPresenceTracker();
  const now = () => (options.now ? options.now() : Date.now());

  function tickPresence(code?: string) {
    const codes = code ? [code] : rooms.listCodes();
    for (const roomCode of codes) {
      const match = matchesByRoom.get(roomCode);
      if (match) {
        for (const seat of match.state.seats) {
          if (seat.controller !== "remote_human") {
            presence.clearSeat(roomCode, seat.seatId);
          }
        }
      }
      presence.tick(roomCode, now());
    }
  }

  function markRoomActive(code: string) {
    const room = rooms.getByCode(code);
    const current = now();
    roomActivity.set(code, {
      lastActivityAt: current,
      emptySince:
        room &&
        isRoomEmpty(room, matchesByRoom.get(code) ?? null, (seatId) =>
          presence.get(code, seatId),
        )
          ? current
          : null,
    });
  }

  function reclaimIdleRooms() {
    const current = now();
    for (const code of rooms.listCodes()) {
      const room = rooms.getByCode(code);
      if (!room) continue;
      tickPresence(code);
      const activity = roomActivity.get(code) ?? {
        lastActivityAt: current,
        emptySince: null,
      };
      const empty = isRoomEmpty(
        room,
        matchesByRoom.get(code) ?? null,
        (seatId) => presence.get(code, seatId),
      );
      if (!empty) {
        activity.emptySince = null;
      } else if (activity.emptySince === null) {
        activity.emptySince = activity.lastActivityAt;
      }
      if (
        empty &&
        activity.emptySince !== null &&
        current - activity.emptySince >= IDLE_ROOM_RECLAIM_MS
      ) {
        const match = matchesByRoom.get(code);
        if (match && store.getRun(match.state.matchId)?.runStatus === "in_progress") {
          store.technicalAbort(match.state.matchId, "room_idle_reclaimed");
        }
        rooms.dissolve(code);
        roomStore.clearRoom(code);
        matchesByRoom.delete(code);
        presence.clearRoom(code);
        roomActivity.delete(code);
        continue;
      }
      roomActivity.set(code, activity);
    }
  }

  function trackRemoteSeatsForMatch(code: string, match: ActiveMatch) {
    presence.clearRoom(code);
    const t = now();
    for (const seat of match.state.seats) {
      if (seat.controller === "remote_human" && !seat.eliminated) {
        presence.trackSeat(code, seat.seatId);
        presence.noteHeartbeat(code, seat.seatId, t);
      }
    }
  }

  function trackRemoteSeatsAfterAuthorityRestore(code: string, match: ActiveMatch) {
    presence.clearRoom(code);
    const seatIds: string[] = [];
    for (const seat of match.state.seats) {
      if (seat.controller === "remote_human" && !seat.eliminated) {
        seatIds.push(seat.seatId);
      }
    }
    presence.grantRecoveryGrace(seatIds, code, now());
  }

  /*
   * Keep the runtime lookup explicit at every HTTP seam. A seat credential
   * must never be used to infer a different room.
   */
  function matchForRoom(code: string) {
    return matchesByRoom.get(code) ?? null;
  }

  function resolveMatchSeatId(
    request: { headers: Record<string, unknown> },
    code: string,
    match: ActiveMatch,
  ): string | null {
    const room = rooms.getByCode(code);
    if (!room) return null;
    const cookies = parseCookies(
      typeof request.headers.cookie === "string"
        ? request.headers.cookie
        : undefined,
    );
    const seatToken = cookies[SEAT_COOKIE];
    if (!seatToken) return null;
    const holder = rooms.findSeatByCredential(room.code, hashToken(seatToken));
    if (!holder) return null;
    const matchSeat = match.state.seats.find(
      (seat) => seat.seatId === holder.seatId,
    );
    if (
      !matchSeat ||
      (matchSeat.controller !== "local_human" &&
        matchSeat.controller !== "remote_human")
    ) {
      return null;
    }
    return holder.seatId;
  }

  function persistActiveRoom() {
    const codes = rooms.listCodes();
    for (const code of codes) {
      const room = rooms.getByCode(code);
      if (room) roomStore.saveRoom(room);
    }
  }

  {
    const loaded = initialRooms;
    for (const failure of loaded.failures) {
      const recoveryCode = failure.roomCode ?? `migration:${failure.reason}`;
      recovery.set(recoveryCode, {
        code: recoveryCode,
        status: "failed",
        reason: failure.reason,
        room: null,
      });
    }
    for (const room of loaded.rooms) {
      if (room.phase === "match") {
        if (!room.matchId) {
          recovery.set(room.code, {
            code: room.code,
            status: "failed",
            reason: "match_missing",
            room,
          });
          continue;
        }
        const run = store.getRun(room.matchId);
        if (
          !run ||
          run.roomCode !== room.code ||
          run.runStatus !== "in_progress"
        ) {
          recovery.set(room.code, {
            code: room.code,
            status: "failed",
            reason: !run ? "match_not_active" : "match_room_mismatch",
            room,
          });
          continue;
        }
        rooms.restore(room);
        markRoomActive(room.code);
        const match = activeMatchFromRun(run);
        matchesByRoom.set(room.code, match);
        markRoomActive(room.code);
        recovery.set(room.code, {
          code: room.code,
          status: "restored",
          reason: null,
          room,
        });
        trackRemoteSeatsAfterAuthorityRestore(room.code, match);
      } else {
        if (room.phase === "rematch" && room.matchId) {
          const run = store.getRun(room.matchId);
          if (!run || run.roomCode !== room.code || run.runStatus === "in_progress") {
            recovery.set(room.code, {
              code: room.code,
              status: "failed",
              reason: !run ? "rematch_match_not_found" : "rematch_match_active",
              room,
            });
            continue;
          }
        }
        rooms.restore(room);
        markRoomActive(room.code);
        recovery.set(room.code, {
          code: room.code,
          status: "restored",
          reason: null,
          room,
        });
      }
    }
  }

  function requireHostSeat(
    request: { headers: Record<string, unknown> },
    reply: {
      code: (status: number) => { send: (body: unknown) => unknown };
    },
    code: string,
  ) {
    if (!requireSession(request, reply)) return null;
    const room = rooms.getByCode(code);
    if (!room) {
      reply.code(404).send({ error: "room_not_found" });
      return null;
    }
    const cookies = parseCookies(
      typeof request.headers.cookie === "string"
        ? request.headers.cookie
        : undefined,
    );
    const seatToken = cookies[SEAT_COOKIE];
    const holder = seatToken
      ? rooms.findSeatByCredential(room.code, hashToken(seatToken))
      : null;
    if (!holder || holder.kind !== "local_human" || holder.seatId !== "1") {
      reply.code(403).send({ error: "host_seat_required" });
      return null;
    }
    return { room, holder };
  }

  function revokeAllRemoteCredentials(code: string) {
    const room = rooms.getByCode(code);
    if (!room) return;
    for (const seat of room.seats) {
      if (seat.kind === "remote_human") {
        rooms.revokeSeatCredential(code, seat.seatId);
      }
    }
    persistActiveRoom();
  }

  function lanSnapshot(port: number, code: string) {
    const candidates = listLanIpv4Candidates(listIfaces() as NetIfaceMap);
    const addresses = candidates.map((c) => c.address);
    if (selectedLanHost && !addresses.includes(selectedLanHost)) {
      selectedLanHost = null;
    }
    const lanHost = publicHost ?? selectedLanHost ?? pickDefaultLanIpv4(candidates);
    if (lanHost && !publicHost) {
      selectedLanHost = lanHost;
    }
    const room = rooms.getByCode(code);
    if (!room) return null;
    return {
      ...roomInvitePayload({
        room,
        lanHost,
        port,
        candidates: addresses,
      }),
      bindMode: options.hosting?.getState().bindMode ?? "local",
      lanOrigin: lanHost ? `http://${lanHost}:${port}` : null,
    };
  }

  app.addHook("onClose", async () => {
    store.close();
    roomStore.close();
  });

  app.addHook("onResponse", async (request, reply) => {
    if (reply.statusCode < 200 || reply.statusCode >= 300) return;
    if (request.method !== "POST" && request.method !== "PATCH") return;
    const match = request.url.match(/^\/api\/rooms\/([0-9]{4})(?:\/|$)/);
    if (match && rooms.getByCode(match[1]!)) markRoomActive(match[1]!);
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

  app.get("/api/room-recovery", async (_request, reply) => {
    const roomsResult = [...recovery.values()].map((item) => ({
      code: item.code,
      status: item.status,
      reason: item.reason,
      phase: item.room?.phase ?? null,
      matchId: item.room?.matchId ?? null,
      seats: item.room ? publicSeats(item.room) : [],
    }));
    return reply.send({ rooms: roomsResult });
  });

  app.post<{ Body: { roomCode?: string } }>("/api/room-recovery/abandon", async (request, reply) => {
    if (!requireSession(request, reply)) return;
    const roomCode = request.body?.roomCode;
    if (typeof roomCode !== "string" || !roomCode) {
      return reply.code(400).send({ error: "room_code_required" });
    }
    const item = recovery.get(roomCode);
    if (!item) return reply.code(404).send({ error: "recovery_room_not_found" });
    const matchId = item.room?.matchId;
    if (matchId) {
      const run = store.getRun(matchId);
      if (run && run.runStatus === "in_progress") {
        store.technicalAbort(matchId, "host_restart_abandoned");
      }
    }
    rooms.dissolve(roomCode);
    roomStore.clearRoom(roomCode);
    matchesByRoom.delete(roomCode);
    presence.clearRoom(roomCode);
    roomActivity.delete(roomCode);
    recovery.delete(roomCode);
    return reply.send({ status: "none", abandoned: true, roomCode });
  });

  app.post("/api/rooms", async (request, reply) => {
    if (!requireSession(request, reply)) return;
    if (!options.hosting) {
      return reply.code(500).send({ error: "hosting_unavailable" });
    }
    reclaimIdleRooms();
    if (rooms.listCodes().length >= MAX_ROOMS) {
      return reply.code(503).send({
        error: "room_capacity_reached",
        message: "房间已满，稍后再试",
      });
    }

    const hostState = options.hosting.getState();
    if (hostState.bindMode !== "host") {
      return reply.code(409).send({ error: "need_host_mode" });
    }

    const candidates = listLanIpv4Candidates(listIfaces() as NetIfaceMap);
    const addresses = candidates.map((c) => c.address);
    const lanHost = publicHost ?? selectedLanHost ?? pickDefaultLanIpv4(candidates);
    if (!lanHost) {
      return reply.code(400).send({ error: "no_lan_ipv4" });
    }
    if (!publicHost) {
      selectedLanHost = lanHost;
    }

    const room = rooms.create();
    markRoomActive(room.code);
    const hostSeat = room.seats[0];
    const issued = issueSeatToken();
    if (hostSeat) {
      hostSeat.credentialHash = issued.hash;
    }
    persistActiveRoom();
    appendSetCookie(reply, serializeCookie(SEAT_COOKIE, issued.token));

    const payload = roomInvitePayload({
      room,
      lanHost,
      port: hostState.port,
      candidates: addresses,
    });
    return reply.send({
      ...payload,
      bindMode: hostState.bindMode,
      lanOrigin: `http://${lanHost}:${hostState.port}`,
    });
  });

  app.post<{
    Params: { code: string; seatId: string };
    Body: { displayName?: string };
  }>("/api/rooms/:code/seats/:seatId/claim", async (request, reply) => {
    if (!requireSession(request, reply)) return;
    const room = rooms.getByCode(request.params.code);
    if (!room) {
      return reply.code(404).send({ error: "room_not_found" });
    }
    const displayName =
      typeof request.body?.displayName === "string" &&
      request.body.displayName.trim().length > 0
        ? request.body.displayName.trim().slice(0, 24)
        : "客人";
    const issued = issueSeatToken();
    const result = rooms.claimSeat(room.code, request.params.seatId, {
      displayName,
      credentialHash: issued.hash,
    });
    if (!result.ok) {
      if (result.reason === "room_not_found") {
        return reply.code(404).send({ error: "room_not_found" });
      }
      if (result.reason === "seat_not_found") {
        return reply.code(404).send({ error: "seat_not_found" });
      }
      return reply.code(409).send({ error: "seat_not_open" });
    }
    persistActiveRoom();
    appendSetCookie(reply, serializeCookie(SEAT_COOKIE, issued.token));
    return reply.send({
      seat: {
        seatId: result.seat.seatId,
        kind: result.seat.kind,
        displayName: result.seat.displayName,
        rematchStatus: result.seat.rematchStatus,
      },
      seats: publicSeats(result.room),
    });
  });

  app.patch<{
    Params: { code: string; seatId: string };
    Body: { displayName?: string };
  }>("/api/rooms/:code/seats/:seatId", async (request, reply) => {
    if (!requireSession(request, reply)) return;
    const room = rooms.getByCode(request.params.code);
    if (!room) {
      return reply.code(404).send({ error: "room_not_found" });
    }
    const cookies = parseCookies(
      typeof request.headers.cookie === "string"
        ? request.headers.cookie
        : undefined,
    );
    const seatToken = cookies[SEAT_COOKIE];
    if (!seatToken) {
      return reply.code(401).send({ error: "seat_credential_required" });
    }
    const holder = rooms.findSeatByCredential(room.code, hashToken(seatToken));
    if (!holder || holder.seatId !== request.params.seatId) {
      return reply.code(403).send({ error: "seat_credential_mismatch" });
    }
    const displayName =
      typeof request.body?.displayName === "string" &&
      request.body.displayName.trim().length > 0
        ? request.body.displayName.trim().slice(0, 24)
        : null;
    if (!displayName) {
      return reply.code(400).send({ error: "display_name_required" });
    }
    const result = rooms.renameSeat(room.code, request.params.seatId, displayName);
    if (!result.ok) {
      if (result.reason === "room_not_found") {
        return reply.code(404).send({ error: "room_not_found" });
      }
      if (result.reason === "seat_not_found") {
        return reply.code(404).send({ error: "seat_not_found" });
      }
      return reply.code(409).send({ error: "seat_not_human" });
    }
    persistActiveRoom();
    return reply.send({
      seat: {
        seatId: result.seat.seatId,
        kind: result.seat.kind,
        displayName: result.seat.displayName,
        rematchStatus: result.seat.rematchStatus,
      },
      seats: publicSeats(result.room),
    });
  });

  app.patch<{
    Params: { code: string; seatId: string };
    Body: { kind?: string };
  }>("/api/rooms/:code/seats/:seatId/config", async (request, reply) => {
    if (!requireSession(request, reply)) return;
    const room = rooms.getByCode(request.params.code);
    if (!room) {
      return reply.code(404).send({ error: "room_not_found" });
    }
    const cookies = parseCookies(
      typeof request.headers.cookie === "string"
        ? request.headers.cookie
        : undefined,
    );
    const seatToken = cookies[SEAT_COOKIE];
    const holder = seatToken
      ? rooms.findSeatByCredential(room.code, hashToken(seatToken))
      : null;
    if (!holder || holder.kind !== "local_human" || holder.seatId !== "1") {
      return reply.code(403).send({ error: "host_seat_required" });
    }

    const kind = request.body?.kind;
    if (kind !== "open" && kind !== "closed") {
      return reply.code(400).send({ error: "invalid_seat_kind" });
    }

    const configInput = kind === "open" ? { kind: "open" as const } : { kind: "closed" as const };
    const result = rooms.configureSeat(room.code, request.params.seatId, configInput);
    if (!result.ok) {
      if (result.reason === "room_not_found") {
        return reply.code(404).send({ error: "room_not_found" });
      }
      if (result.reason === "seat_not_found") {
        return reply.code(404).send({ error: "seat_not_found" });
      }
      if (result.reason === "room_not_lobby") {
        return reply.code(409).send({ error: "room_not_lobby" });
      }
      return reply.code(409).send({ error: "seat_not_configurable" });
    }
    persistActiveRoom();
    return reply.send({
      seat: {
        seatId: result.seat.seatId,
        kind: result.seat.kind,
        displayName: result.seat.displayName,
        rematchStatus: result.seat.rematchStatus,
      },
      seats: publicSeats(result.room),
    });
  });

  app.post<{ Params: { code: string } }>(
    "/api/rooms/:code/rematch",
    async (request, reply) => {
      const host = requireHostSeat(request, reply, request.params.code);
      if (!host) return;
      const { room } = host;
      if (room.phase !== "match") {
        return reply.code(409).send({ error: "room_not_match" });
      }
      const run = room.matchId != null ? store.getRun(room.matchId) : null;
      if (!run || run.runStatus === "in_progress") {
        return reply.code(409).send({ error: "match_in_progress" });
      }
      const entered = rooms.enterRematch(room.code);
      if (!entered.ok) {
        return reply.code(409).send({ error: entered.reason });
      }
      persistActiveRoom();
      return reply.send({
        code: entered.room.code,
        phase: entered.room.phase,
        seats: publicSeats(entered.room),
        matchId: entered.room.matchId,
      });
    },
  );

  app.post<{ Params: { code: string } }>(
    "/api/rooms/:code/rematch/join",
    async (request, reply) => {
      if (!requireSession(request, reply)) return;
      const room = rooms.getByCode(request.params.code);
      if (!room) {
        return reply.code(404).send({ error: "room_not_found" });
      }
      if (room.phase !== "rematch") {
        return reply.code(409).send({ error: "room_not_rematch" });
      }
      const cookies = parseCookies(
        typeof request.headers.cookie === "string"
          ? request.headers.cookie
          : undefined,
      );
      const seatToken = cookies[SEAT_COOKIE];
      const holder = seatToken
        ? rooms.findSeatByCredential(room.code, hashToken(seatToken))
        : null;
      if (!holder || holder.kind !== "remote_human") {
        return reply.code(403).send({ error: "seat_credential_required" });
      }
      const confirmed = rooms.confirmRematchSeat(room.code, holder.seatId);
      if (!confirmed.ok) {
        if (confirmed.reason === "seat_not_awaiting") {
          return reply.code(409).send({ error: "seat_not_awaiting" });
        }
        return reply.code(409).send({ error: confirmed.reason });
      }
      const issued = issueSeatToken();
      const rotated = rooms.rotateSeatCredential(
        room.code,
        holder.seatId,
        issued.hash,
      );
      if (!rotated.ok) {
        return reply.code(409).send({ error: rotated.reason });
      }
      persistActiveRoom();
      appendSetCookie(reply, serializeCookie(SEAT_COOKIE, issued.token));
      return reply.send({
        seat: {
          seatId: rotated.seat.seatId,
          kind: rotated.seat.kind,
          displayName: rotated.seat.displayName,
          rematchStatus: rotated.seat.rematchStatus,
        },
        seats: publicSeats(rotated.room),
      });
    },
  );

  app.post<{ Params: { code: string } }>(
    "/api/rooms/:code/rematch/leave",
    async (request, reply) => {
      if (!requireSession(request, reply)) return;
      const room = rooms.getByCode(request.params.code);
      if (!room) {
        return reply.code(404).send({ error: "room_not_found" });
      }
      if (room.phase !== "rematch") {
        return reply.code(409).send({ error: "room_not_rematch" });
      }
      const cookies = parseCookies(
        typeof request.headers.cookie === "string"
          ? request.headers.cookie
          : undefined,
      );
      const seatToken = cookies[SEAT_COOKIE];
      const holder = seatToken
        ? rooms.findSeatByCredential(room.code, hashToken(seatToken))
        : null;
      if (!holder || holder.kind !== "remote_human") {
        return reply.code(403).send({ error: "seat_credential_required" });
      }
      const declined = rooms.declineRematchSeat(room.code, holder.seatId);
      if (!declined.ok) {
        return reply.code(409).send({ error: declined.reason });
      }
      persistActiveRoom();
      return reply.send({
        seats: publicSeats(declined.room),
      });
    },
  );

  app.post<{ Params: { code: string } }>(
    "/api/rooms/:code/start",
    async (request, reply) => {
      if (!requireSession(request, reply)) return;
      const room = rooms.getByCode(request.params.code);
      if (!room) {
        return reply.code(404).send({ error: "room_not_found" });
      }
      const cookies = parseCookies(
        typeof request.headers.cookie === "string"
          ? request.headers.cookie
          : undefined,
      );
      const seatToken = cookies[SEAT_COOKIE];
      const holder = seatToken
        ? rooms.findSeatByCredential(room.code, hashToken(seatToken))
        : null;
      if (!holder || holder.kind !== "local_human" || holder.seatId !== "1") {
        return reply.code(403).send({ error: "host_seat_required" });
      }

      // 同一房间终局后允许继续对局（重开一局）：仅当当前 run 已结束；
      // 续局等待阶段须全部座位已确认（门禁内校验）。
      const currentRun =
        room.matchId != null ? store.getRun(room.matchId) : null;
      const rematchAllowed =
        room.phase === "match" &&
        currentRun !== null &&
        currentRun.runStatus !== "in_progress";
      const gates = evaluateLobbyStartGates(room, {
        allowMatchPhase: rematchAllowed,
        allowRematchPhase: room.phase === "rematch",
      });
      if (!gates.ok) {
        return reply.code(400).send({ error: gates.reason });
      }

      const setupSeats = lobbySeatsToMatchSetup(room);

      const matchId = `match-${Date.now()}`;
      let activeMatch: ActiveMatch;
      try {
        activeMatch = await startMatch({
          matchId,
          seats: setupSeats,
          persistence,
          roomCode: room.code,
        });
      } catch (error) {
        const started = store.getRun(matchId);
        if (started?.runStatus === "in_progress") {
          store.technicalAbort(matchId, abortReasonFrom(error));
        }
        return reply.code(502).send({
          error: abortReasonFrom(error),
          aborted: Boolean(started),
          matchId: started ? matchId : null,
        });
      }

      const begun = rooms.beginMatch(room.code, activeMatch.state.matchId);
      if (!begun.ok) {
        store.userAbort(activeMatch.state.matchId);
        return reply.code(409).send({ error: begun.reason });
      }
      matchesByRoom.set(room.code, activeMatch);
      persistActiveRoom();
      trackRemoteSeatsForMatch(room.code, activeMatch);

      return reply.send({
        ...humanFacingPayload(activeMatch, undefined, "1"),
        phase: begun.room.phase,
        matchId: activeMatch.state.matchId,
        absences: presence.projectAll(room.code, now()),
      });
    },
  );

  app.post<{ Params: { code: string } }>(
    "/api/rooms/:code/heartbeat",
    async (request, reply) => {
      if (!requireSession(request, reply)) return;
      const room = rooms.getByCode(request.params.code);
      if (!room) {
        return reply.code(404).send({ error: "room_not_found" });
      }
      const cookies = parseCookies(
        typeof request.headers.cookie === "string"
          ? request.headers.cookie
          : undefined,
      );
      const seatToken = cookies[SEAT_COOKIE];
      const holder = seatToken
        ? rooms.findSeatByCredential(room.code, hashToken(seatToken))
        : null;
      if (!holder || holder.kind !== "remote_human") {
        return reply.code(403).send({ error: "remote_seat_required" });
      }
      const t = now();
      presence.trackSeat(room.code, holder.seatId);
      presence.noteHeartbeat(room.code, holder.seatId, t);
      tickPresence(room.code);
      return reply.send({
        ok: true,
        absences: presence.projectAll(room.code, now()),
      });
    },
  );

  app.get<{ Params: { code: string } }>(
    "/api/rooms/:code/presence",
    async (request, reply) => {
      const room = rooms.getByCode(request.params.code);
      if (!room) {
        return reply.code(404).send({ error: "room_not_found" });
      }
      tickPresence(room.code);
      return reply.send({
        absences: presence.projectAll(room.code, now()),
      });
    },
  );

  app.post<{ Params: { code: string } }>(
    "/api/rooms/:code/resume-seat",
    async (request, reply) => {
      if (!requireSession(request, reply)) return;
      const room = rooms.getByCode(request.params.code);
      if (!room) {
        return reply.code(404).send({ error: "room_not_found" });
      }
      const cookies = parseCookies(
        typeof request.headers.cookie === "string"
          ? request.headers.cookie
          : undefined,
      );
      const seatToken = cookies[SEAT_COOKIE];
      const holder = seatToken
        ? rooms.findSeatByCredential(room.code, hashToken(seatToken))
        : null;
      if (
        !holder ||
        (holder.kind !== "remote_human" && holder.kind !== "local_human")
      ) {
        return reply.code(403).send({ error: "seat_credential_required" });
      }
      if (holder.kind === "local_human") {
        // Local human seats have no remote heartbeat lease. Older clients may
        // still call this endpoint on match entry; keep that call harmless.
        presence.clearSeat(room.code, holder.seatId);
        tickPresence(room.code);
        return reply.send({
          resumed: false,
          seat: {
            seatId: holder.seatId,
            kind: holder.kind,
            displayName: holder.displayName,
            rematchStatus: holder.rematchStatus,
          },
          absences: presence.projectAll(room.code, now()),
        });
      }
      tickPresence(room.code);
      presence.trackSeat(room.code, holder.seatId);
      const before = presence.get(room.code, holder.seatId);
      if (!before || before.phase === "present") {
        presence.noteHeartbeat(room.code, holder.seatId, now());
        return reply.send({
          resumed: false,
          seat: {
            seatId: holder.seatId,
            kind: holder.kind,
            displayName: holder.displayName,
            rematchStatus: holder.rematchStatus,
          },
          absences: presence.projectAll(room.code, now()),
        });
      }
      const issued = issueSeatToken();
      const rotated = rooms.rotateSeatCredential(
        room.code,
        holder.seatId,
        issued.hash,
      );
      if (!rotated.ok) {
        return reply.code(409).send({ error: rotated.reason });
      }
      persistActiveRoom();
      appendSetCookie(reply, serializeCookie(SEAT_COOKIE, issued.token));
      presence.resume(room.code, holder.seatId);
      presence.noteHeartbeat(room.code, holder.seatId, now());
      return reply.send({
        resumed: true,
        seat: {
          seatId: holder.seatId,
          kind: holder.kind,
          displayName: holder.displayName,
        },
        absences: presence.projectAll(room.code, now()),
      });
    },
  );

  app.post<{
    Params: { code: string; seatId: string };
    Body: { action?: string };
  }>("/api/rooms/:code/seats/:seatId/disposition", async (request, reply) => {
    const host = requireHostSeat(request, reply, request.params.code);
    if (!host) return;
    const { room } = host;
    let activeMatch = matchForRoom(room.code);
    if (room.phase !== "match" || !activeMatch) {
      return reply.code(409).send({ error: "room_not_match" });
    }
    const seatId = request.params.seatId;
    const action = request.body?.action;
    tickPresence(room.code);
    const absence = presence.get(room.code, seatId);
    if (
      !absence ||
      (absence.phase !== "absent" && absence.phase !== "timed_out")
    ) {
      return reply.code(409).send({ error: "seat_not_absent" });
    }

    if (action === "extend_wait") {
      presence.extendWait(room.code, seatId, now());
      return reply.send({
        action: "extend_wait",
        absences: presence.projectAll(room.code, now()),
      });
    }

    if (action === "technical_abort") {
      const matchId = activeMatch.state.matchId;
      store.technicalAbort(matchId, "host_absence_disposition");
      revokeAllRemoteCredentials(room.code);
      rooms.revokeSeatCredential(room.code, seatId);
      persistActiveRoom();
      presence.clearRoom(room.code);
      matchesByRoom.delete(room.code);
      return reply.send({
        action: "technical_abort",
        aborted: true,
        matchId,
      });
    }

    if (action === "force_eliminate") {
      const result = forceEliminateForHostAbsence(activeMatch.state, seatId);
      if (!result.ok) {
        return reply.code(409).send({ error: result.reason });
      }
      activeMatch = {
        ...activeMatch,
        state: result.state,
        events: [...activeMatch.events, ...result.events],
      };
      matchesByRoom.set(room.code, activeMatch);
      store.commitCommand(
        activeMatch.state.matchId,
        activeMatch.state,
        result.events,
      );
      rooms.revokeSeatCredential(room.code, seatId);
      persistActiveRoom();
      presence.clearSeat(room.code, seatId);
      return reply.send({
        action: "force_eliminate",
        ...humanFacingPayload(activeMatch, undefined, "1"),
        absences: presence.projectAll(room.code, now()),
      });
    }

    return reply.code(400).send({ error: "invalid_disposition" });
  });

  app.get<{ Params: { code: string } }>(
    "/api/rooms/:code/me",
    async (request, reply) => {
      const room = rooms.getByCode(request.params.code);
      if (!room) {
        return reply.code(404).send({ error: "room_not_found" });
      }
      const cookies = parseCookies(
        typeof request.headers.cookie === "string"
          ? request.headers.cookie
          : undefined,
      );
      const seatToken = cookies[SEAT_COOKIE];
      const holder = seatToken
        ? rooms.findSeatByCredential(room.code, hashToken(seatToken))
        : null;
      return reply.send({
        seat: holder
          ? {
              seatId: holder.seatId,
              kind: holder.kind,
              displayName: holder.displayName,
            }
          : null,
        seats: publicSeats(room),
      });
    },
  );

  app.get<{ Params: { code: string } }>(
    "/api/rooms/:code",
    async (request, reply) => {
      const room = rooms.getByCode(request.params.code);
      if (!room) {
        if (roomCodeThrottle.blocked(request.ip)) {
          return reply.code(429).send({ error: "too_many_attempts" });
        }
        roomCodeThrottle.recordFail(request.ip);
        return reply.code(404).send({ error: "room_not_found" });
      }
      roomCodeThrottle.clear(request.ip);
      const state = options.hosting?.getState();
      const port = state?.port ?? 0;
      const snap = lanSnapshot(port, room.code);
      return reply.send(snap);
    },
  );

  app.get<{ Params: { code: string } }>(
    "/api/rooms/:code/matches/current",
    async (request, reply) => {
    const room = rooms.getByCode(request.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    const activeMatch = matchForRoom(room.code);
    if (!activeMatch) {
      return reply.code(404).send({ error: "no_active_match" });
    }

    const seatId = resolveMatchSeatId(request, room.code, activeMatch);
    if (!seatId) {
      return reply.code(403).send({ error: "seat_credential_required" });
    }

    tickPresence(room.code);
    const deciding = activeDecidingSeatId(activeMatch.state);
    const blockedByAbsence =
      deciding !== null &&
      presence.blocksAdvancement(room.code, deciding, true);

    return reply.send({
      ...humanFacingPayload(activeMatch, undefined, seatId),
      matchId: activeMatch.state.matchId,
      absences: presence.projectAll(room.code, now()),
      pausedForAbsenceSeatId: blockedByAbsence ? deciding : null,
    });
    },
  );

  app.post<{
    Params: { code: string };
  }>("/api/rooms/:code/matches/current/decision", async (request, reply) => {
    const room = rooms.getByCode(request.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    let activeMatch = matchForRoom(room.code);
    if (!activeMatch) {
      return reply.code(404).send({ error: "no_active_match" });
    }
    const seatId = resolveMatchSeatId(request, room.code, activeMatch);
    if (!seatId) {
      return reply.code(403).send({ error: "seat_credential_required" });
    }
    tickPresence(room.code);
    const absence = presence.get(room.code, seatId);
    if (
      absence &&
      (absence.phase === "absent" || absence.phase === "timed_out")
    ) {
      return reply.code(409).send({
        error: "seat_absent",
        absences: presence.projectAll(room.code, now()),
      });
    }
    // Decision during grace counts as channel recovery (no credential rotate).
    if (absence?.phase === "reconnecting") {
      presence.noteHeartbeat(room.code, seatId, now());
      presence.resume(room.code, seatId);
    }
    const body = request.body as SeatDecision;
    const matchId = activeMatch.state.matchId;
    let result: Awaited<ReturnType<typeof submitHumanDecision>>;
    try {
      result = await submitHumanDecision(activeMatch, body, {
        persistence,
        actingSeatId: seatId,
      });
    } catch (error) {
      const run = store.getRun(matchId);
      if (run && run.runStatus === "in_progress") {
        store.technicalAbort(matchId, abortReasonFrom(error));
      }
      matchesByRoom.delete(room.code);
      return reply.code(502).send({
        error: abortReasonFrom(error),
        aborted: true,
        matchId,
      });
    }
    if (!result.ok) {
      return reply.code(409).send({ error: result.reason });
    }
    activeMatch = result.match;
    matchesByRoom.set(room.code, activeMatch);
    if (
      activeMatch.state.status === "finished" &&
      room.code
    ) {
      // 终局凭证保留到续局等待结束（加入→轮换；离开/处置→作废），
      // 让客人刷新后仍能认回原座位。
      presence.clearRoom(room.code);
    }
    return reply.send({
      ...humanFacingPayload(activeMatch, body.requestId, seatId),
      absences: presence.projectAll(room.code, now()),
    });
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
