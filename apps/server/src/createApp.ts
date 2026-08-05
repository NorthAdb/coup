import path from "node:path";
import { homedir, networkInterfaces } from "node:os";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { activeDecidingSeatId, forceEliminateForHostAbsence } from "@coup/domain";
import type { SeatDecision } from "@coup/protocol";
import { createAgentRuntime, type AgentRuntime } from "./agents/index.js";
import { createProcessCliRunner } from "./agents/cliRunner.js";
import {
  probeCapabilities,
  recheckSetupSeats,
  sanitizeCapabilityReport,
  type CapabilityProbeOptions,
  type CapabilityReport,
} from "./capabilityProbe.js";
import {
  advanceAgentSeats,
  pendingAgentSeatIds,
  startMatch,
  submitHumanDecision,
  toSeatView,
  type ActiveMatch,
  type MatchPersistence,
} from "./matchRuntime.js";
import type { AgentDecisionPhase } from "./agentDecision.js";
import { parseMatchSetup } from "./matchSetup.js";
import {
  openMatchStore,
  type MatchRunRecord,
  type MatchStore,
} from "./matchStore.js";
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
  agentRuntime?: AgentRuntime;
  /** Override capability probing (tests / fixtures). */
  probe?: (options?: CapabilityProbeOptions) => Promise<CapabilityReport>;
  /** SQLite path; defaults to ~/.coup/coup.sqlite. */
  dbPath?: string;
  /** Inject an already-open store (tests). */
  store?: MatchStore;
  /** LAN host bind / rebind control (omit in pure inject tests that stub it). */
  hosting?: HostingController;
  listNetworkInterfaces?: () => NetIfaceMap;
  rooms?: RoomRegistry;
  sessions?: SessionStore;
  /** Injectable clock for absence timers (tests). */
  now?: () => number;
  presence?: SeatPresenceTracker;
  /** LAN room persistence (defaults to same dbPath as MatchStore). */
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
    seatAgents: run.seatAgents,
    seatWorkspaces: {},
    decisionRationales: {},
  };
}

function humanFacingPayload(
  match: ActiveMatch,
  requestId?: string,
  seatId = match.humanSeatId,
) {
  return {
    view: toSeatView(match, seatId, requestId),
    decisionRationales: match.decisionRationales,
  };
}

export function persistenceForStore(store: MatchStore): MatchPersistence {
  return {
    onCreated(match) {
      const existing = store.findResumableRun();
      if (existing && existing.matchId !== match.state.matchId) {
        store.userAbort(existing.matchId);
      }
      store.createRun({
        matchId: match.state.matchId,
        humanSeatId: match.humanSeatId,
        displayNames: match.displayNames,
        seatAgents: match.seatAgents,
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
    return "agent_failed";
  }
  const message = error.message;
  const colon = message.indexOf(":");
  const head = (colon >= 0 ? message.slice(0, colon) : message).trim();
  const known = new Set([
    "agent_unsupported_protocol",
    "agent_request_id_mismatch",
    "agent_version_mismatch",
    "agent_decision_not_legal",
    "agent_advance_exceeded_guard",
    "agent_start_failed",
    "agent_resume_failed",
    "agent_decision_failed",
    "agent_illegal_decision",
    "agent_timeout",
    "agent_cli_not_installed",
    "agent_cli_unsupported",
    "agent_auth_failed",
    "agent_credentials_missing",
    "agent_billing_unavailable",
    "agent_model_unavailable",
    "agent_model_forbidden",
    "agent_tools_not_denied",
    "agent_tool_permission_requested",
    "agent_isolation_violated",
    "agent_persist_failed",
    "agent_empty_output",
    "agent_invalid_json",
    "agent_schema_mismatch",
    "agent_subprocess_exited",
    "agent_session_error",
    "agent_rate_limited",
    "agent_provider_transient",
  ]);
  if (known.has(head)) return head;
  if (known.has(message)) return message;
  if (
    head.startsWith("opencode_") ||
    head.startsWith("claude_") ||
    message.startsWith("agent ")
  ) {
    return "agent_failed";
  }
  // Never persist raw CLI/model text — only a stable category token.
  return "agent_failed";
}

export async function createApp(options: CreateAppOptions) {
  const app = Fastify({ logger: false });
  const dbPath = options.dbPath ?? defaultDbPath();
  const store = options.store ?? openMatchStore(dbPath);
  const roomStore = options.roomStore ?? openRoomStore(dbPath);
  const persistence = persistenceForStore(store);
  const agentRuntime = options.agentRuntime ?? createAgentRuntime();
  const runProbe =
    options.probe ??
    (() => probeCapabilities({ runner: createProcessCliRunner() }));
  const rooms = options.rooms ?? createRoomRegistry();
  const sessions = options.sessions ?? createSessionStore();
  const listIfaces = options.listNetworkInterfaces ?? networkInterfaces;
  let selectedLanHost: string | null = null;
  let recoveryStatus: RoomRecoveryStatus = "none";
  let recoveryReason: string | null = null;
  let failedRecoveryRoom: RoomRecord | null = null;

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
    return allowedOrigins({ port, lanHosts: hosts });
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

  let activeMatch: ActiveMatch | null = null;
  let activeRoomCode: string | null = null;
  let agentPhase: AgentDecisionPhase | "idle" = "idle";
  let agentSeatId: string | null = null;
  let thinkingSeatIds: string[] = [];
  const presence = options.presence ?? createSeatPresenceTracker();
  const now = () => (options.now ? options.now() : Date.now());

  function tickPresence() {
    if (activeMatch) {
      for (const seat of activeMatch.state.seats) {
        if (seat.controller !== "remote_human") {
          // Presence is a remote-human lease; clean up stale entries from
          // older clients or a previous controller assignment.
          presence.clearSeat(seat.seatId);
        }
      }
    }
    presence.tick(now());
  }

  function persistActiveRoom() {
    const codes = rooms.listCodes();
    if (codes.length === 0) {
      roomStore.clearActiveRoom();
      return;
    }
    const room = rooms.getByCode(codes[0]!);
    if (room) roomStore.saveActiveRoom(room);
  }

  function trackRemoteSeatsForMatch() {
    presence.clear();
    if (!activeMatch || !activeRoomCode) return;
    const t = now();
    for (const seat of activeMatch.state.seats) {
      if (seat.controller === "remote_human" && !seat.eliminated) {
        presence.trackSeat(seat.seatId);
        // Treat match start as an initial heartbeat so silence starts the lease.
        presence.noteHeartbeat(seat.seatId, t);
      }
    }
  }

  function trackRemoteSeatsAfterAuthorityRestore() {
    presence.clear();
    if (!activeMatch || !activeRoomCode) return;
    const seatIds: string[] = [];
    for (const seat of activeMatch.state.seats) {
      if (seat.controller === "remote_human" && !seat.eliminated) {
        seatIds.push(seat.seatId);
      }
    }
    // Fresh 15s grace — authority downtime is not counted against soft timeout.
    presence.grantRecoveryGrace(seatIds, now());
  }

  {
    const loaded = roomStore.loadActiveRoom();
    if (!loaded.ok) {
      recoveryStatus = "failed";
      recoveryReason = loaded.reason;
      failedRecoveryRoom = null;
    } else if (loaded.room) {
      const room = loaded.room;
      if (room.phase === "match") {
        if (!room.matchId) {
          recoveryStatus = "failed";
          recoveryReason = "match_missing";
          failedRecoveryRoom = room;
        } else {
          const run = store.getRun(room.matchId);
          if (!run || run.runStatus !== "in_progress") {
            recoveryStatus = "failed";
            recoveryReason = "match_not_active";
            failedRecoveryRoom = room;
          } else {
            rooms.restore(room);
            activeRoomCode = room.code;
            activeMatch = activeMatchFromRun(run);
            recoveryStatus = "restored";
            trackRemoteSeatsAfterAuthorityRestore();
          }
        }
      } else {
        rooms.restore(room);
        activeRoomCode = room.code;
        recoveryStatus = "restored";
      }
    } else {
      // No LAN room — keep MVP local resumable-run behavior.
      const resumable = store.findResumableRun();
      activeMatch = resumable ? activeMatchFromRun(resumable) : null;
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

  function resolveMatchSeatId(
    request: { headers: Record<string, unknown> },
  ): string | null {
    if (!activeMatch) return null;
    if (!activeRoomCode) return activeMatch.humanSeatId;
    const room = rooms.getByCode(activeRoomCode);
    if (!room) return null;
    const cookies = parseCookies(
      typeof request.headers.cookie === "string"
        ? request.headers.cookie
        : undefined,
    );
    const seatToken = cookies[SEAT_COOKIE];
    if (!seatToken) return null;
    const holder = rooms.findSeatByCredential(
      room.code,
      hashToken(seatToken),
    );
    if (!holder) return null;
    const matchSeat = activeMatch.state.seats.find(
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

  function lanSnapshot(port: number, code: string) {
    const candidates = listLanIpv4Candidates(listIfaces() as NetIfaceMap);
    const addresses = candidates.map((c) => c.address);
    if (selectedLanHost && !addresses.includes(selectedLanHost)) {
      selectedLanHost = null;
    }
    const lanHost =
      selectedLanHost ?? pickDefaultLanIpv4(candidates);
    selectedLanHost = lanHost;
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

  function runtimeOptions() {
    return {
      agentRuntime,
      persistence,
      onAgentPhase: (phase: AgentDecisionPhase, seatId?: string) => {
        agentPhase = phase;
        if (seatId !== undefined) {
          agentSeatId = seatId;
        }
      },
      onMatchAdvanced: (match: ActiveMatch) => {
        thinkingSeatIds = pendingAgentSeatIds(match);
      },
    };
  }

  async function advanceActiveOrAbort(
    match: ActiveMatch,
  ): Promise<
    | { ok: true; match: ActiveMatch }
    | { ok: false; matchId: string; error: string }
  > {
    agentPhase = "thinking";
    agentSeatId = null;
    thinkingSeatIds = pendingAgentSeatIds(match);
    try {
      const next = await advanceAgentSeats(match, runtimeOptions());
      agentPhase = "idle";
      agentSeatId = null;
      thinkingSeatIds = [];
      return { ok: true, match: next };
    } catch (error) {
      agentPhase = "failed";
      thinkingSeatIds = [];
      const matchId = match.state.matchId;
      const run = store.getRun(matchId);
      if (run && run.runStatus === "in_progress") {
        store.technicalAbort(matchId, abortReasonFrom(error));
      }
      return {
        ok: false,
        matchId,
        error: abortReasonFrom(error),
      };
    }
  }

  app.addHook("onClose", async () => {
    store.close();
    roomStore.close();
  });

  app.get("/api/capabilities", async (_request, reply) => {
    const report = sanitizeCapabilityReport(await runProbe());
    return reply.send(report);
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
    // This endpoint is a public, read-only probe used while the browser
    // moves from the loopback origin to the LAN origin.
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
      selectedHost: selectedLanHost ?? pickDefaultLanIpv4(candidates),
    });
  });

  app.post("/api/hosting/enter", async (_request, reply) => {
    if (!options.hosting) {
      return reply.code(500).send({ error: "hosting_unavailable" });
    }
    const candidates = listLanIpv4Candidates(listIfaces() as NetIfaceMap);
    const addresses = candidates.map((c) => c.address);
    const current = options.hosting.getState();
    if (current.bindMode === "host") {
      return reply.send({
        status: "ready",
        ...current,
        candidates: addresses,
        selectedHost: selectedLanHost ?? pickDefaultLanIpv4(candidates),
      });
    }

    const preferredPort = 8787;
    // LAN origins first — host should land on LAN Origin, not loopback.
    // Lead with the RFC1918-ranked default so VPN/TUN adapters (e.g.
    // 198.18.x.x) don't win the redirect race over the real LAN NIC.
    const defaultHost = selectedLanHost ?? pickDefaultLanIpv4(candidates);
    const others = addresses.filter((ip) => ip !== defaultHost);
    const retryOrigins = [
      ...(defaultHost ? [`http://${defaultHost}:${preferredPort}`] : []),
      ...others.map((ip) => `http://${ip}:${preferredPort}`),
      `http://127.0.0.1:${preferredPort}`,
    ];
    // Flush response before rebinding — server.close() waits for in-flight requests.
    const payload = {
      status: "rebinding" as const,
      preferredPort,
      candidates: addresses,
      retryOrigins,
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
    if (recoveryStatus === "failed") {
      return reply.send({
        status: "failed",
        reason: recoveryReason,
        message: "无法恢复上一房间",
        room: failedRecoveryRoom
          ? {
              code: failedRecoveryRoom.code,
              phase: failedRecoveryRoom.phase,
              matchId: failedRecoveryRoom.matchId,
              seats: publicSeats(failedRecoveryRoom),
            }
          : null,
      });
    }
    if (recoveryStatus === "restored" && activeRoomCode) {
      const room = rooms.getByCode(activeRoomCode);
      if (room) {
        return reply.send({
          status: "restored",
          reason: null,
          message: null,
          room: {
            code: room.code,
            phase: room.phase,
            matchId: room.matchId,
            seats: publicSeats(room),
          },
        });
      }
    }
    return reply.send({
      status: "none",
      reason: null,
      message: null,
      room: null,
    });
  });

  app.post("/api/room-recovery/abandon", async (request, reply) => {
    if (!requireSession(request, reply)) return;
    if (recoveryStatus !== "failed" && recoveryStatus !== "restored") {
      return reply.code(409).send({ error: "no_recovery_to_abandon" });
    }

    // Prefer the room-linked matchId. Corrupt payloads have no parseable link;
    // then only fall back to the single in-progress run (LAN is one-room/one-match).
    const matchId =
      failedRecoveryRoom?.matchId ??
      (activeRoomCode ? rooms.getByCode(activeRoomCode)?.matchId : null) ??
      (recoveryReason === "corrupt"
        ? (store.findResumableRun()?.matchId ?? null)
        : null);
    if (matchId) {
      const run = store.getRun(matchId);
      if (run && run.runStatus === "in_progress") {
        store.technicalAbort(matchId, "host_restart_abandoned");
      }
    }

    for (const code of rooms.listCodes()) {
      rooms.dissolve(code);
    }
    roomStore.clearActiveRoom();
    failedRecoveryRoom = null;
    recoveryStatus = "none";
    recoveryReason = null;
    activeRoomCode = null;
    activeMatch = null;
    presence.clear();

    return reply.send({ status: "none", abandoned: true });
  });

  app.post("/api/rooms", async (request, reply) => {
    if (!requireSession(request, reply)) return;
    if (!options.hosting) {
      return reply.code(500).send({ error: "hosting_unavailable" });
    }
    if (recoveryStatus === "failed" || recoveryStatus === "restored") {
      return reply.code(409).send({
        error: "recovery_pending_abandon",
        message:
          recoveryStatus === "failed"
            ? "无法恢复上一房间：须先放弃并作废旧房后才能创建新房"
            : "已恢复上一房间：须先放弃并作废旧房后才能创建新房",
      });
    }
    const hostState = options.hosting.getState();
    if (hostState.bindMode !== "host") {
      return reply.code(409).send({ error: "need_host_mode" });
    }

    const candidates = listLanIpv4Candidates(listIfaces() as NetIfaceMap);
    const addresses = candidates.map((c) => c.address);
    const lanHost = selectedLanHost ?? pickDefaultLanIpv4(candidates);
    if (!lanHost) {
      return reply.code(400).send({ error: "no_lan_ipv4" });
    }
    selectedLanHost = lanHost;

    // One active room for now (spec: single room).
    for (const code of rooms.listCodes()) {
      rooms.dissolve(code);
    }
    const room = rooms.create();
    const hostSeat = room.seats[0];
    const issued = issueSeatToken();
    if (hostSeat) {
      hostSeat.credentialHash = issued.hash;
    }
    activeRoomCode = room.code;
    recoveryStatus = "none";
    recoveryReason = null;
    failedRecoveryRoom = null;
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
        cli: result.seat.cli,
        modelId: result.seat.modelId,
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
        cli: result.seat.cli,
        modelId: result.seat.modelId,
      },
      seats: publicSeats(result.room),
    });
  });

  app.patch<{
    Params: { code: string; seatId: string };
    Body: {
      kind?: string;
      displayName?: string;
      cli?: string;
      modelId?: string | null;
    };
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
    if (kind !== "open" && kind !== "closed" && kind !== "local_agent") {
      return reply.code(400).send({ error: "invalid_seat_kind" });
    }

    let configInput:
      | { kind: "open" }
      | { kind: "closed" }
      | {
          kind: "local_agent";
          displayName: string;
          cli: "opencode" | "claude" | "stub";
          modelId: string | null;
        };
    if (kind === "open") {
      configInput = { kind: "open" };
    } else if (kind === "closed") {
      configInput = { kind: "closed" };
    } else {
      const cli = request.body?.cli;
      if (cli !== "opencode" && cli !== "claude" && cli !== "stub") {
        return reply.code(400).send({ error: "invalid_cli" });
      }
      const displayName =
        typeof request.body?.displayName === "string" &&
        request.body.displayName.trim().length > 0
          ? request.body.displayName.trim().slice(0, 24)
          : "Agent";
      const modelId =
        request.body?.modelId === undefined
          ? null
          : request.body.modelId === null
            ? null
            : typeof request.body.modelId === "string"
              ? request.body.modelId
              : undefined;
      if (modelId === undefined) {
        return reply.code(400).send({ error: "invalid_model_id" });
      }
      configInput = { kind: "local_agent", displayName, cli, modelId };
    }

    const result = rooms.configureSeat(
      room.code,
      request.params.seatId,
      configInput,
    );
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
        cli: result.seat.cli,
        modelId: result.seat.modelId,
      },
      seats: publicSeats(result.room),
    });
  });

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

      const gates = evaluateLobbyStartGates(room);
      if (!gates.ok) {
        return reply.code(400).send({ error: gates.reason });
      }

      const setupSeats = lobbySeatsToMatchSetup(room);
      const report = await runProbe();
      const gate = recheckSetupSeats(setupSeats, report);
      if (!gate.ok) {
        return reply.code(400).send({
          error: gate.reason,
          hint: gate.hint,
        });
      }

      if (activeMatch) {
        const existing = store.findResumableRun();
        if (existing && existing.runStatus === "in_progress") {
          store.userAbort(existing.matchId);
        }
        activeMatch = null;
        activeRoomCode = null;
      }

      try {
        agentPhase = "thinking";
        agentSeatId = null;
        thinkingSeatIds = [];
        activeMatch = await startMatch({
          seats: setupSeats,
          ...runtimeOptions(),
        });
        agentPhase = "idle";
        agentSeatId = null;
        thinkingSeatIds = [];
      } catch (error) {
        agentPhase = "failed";
        thinkingSeatIds = [];
        const startedId = store.findResumableRun()?.matchId;
        if (startedId) {
          store.technicalAbort(startedId, abortReasonFrom(error));
        }
        activeMatch = null;
        activeRoomCode = null;
        return reply.code(502).send({
          error: abortReasonFrom(error),
          aborted: Boolean(startedId),
          matchId: startedId ?? null,
        });
      }

      const begun = rooms.beginMatch(room.code, activeMatch.state.matchId);
      if (!begun.ok) {
        store.userAbort(activeMatch.state.matchId);
        activeMatch = null;
        activeRoomCode = null;
        return reply.code(409).send({ error: begun.reason });
      }
      activeRoomCode = room.code;
      persistActiveRoom();
      trackRemoteSeatsForMatch();

      return reply.send({
        ...humanFacingPayload(activeMatch, undefined, "1"),
        phase: begun.room.phase,
        matchId: activeMatch.state.matchId,
        absences: presence.projectAll(now()),
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
      presence.trackSeat(holder.seatId);
      presence.noteHeartbeat(holder.seatId, t);
      tickPresence();
      return reply.send({
        ok: true,
        absences: presence.projectAll(now()),
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
      tickPresence();
      return reply.send({
        absences: presence.projectAll(now()),
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
        presence.clearSeat(holder.seatId);
        tickPresence();
        return reply.send({
          resumed: false,
          seat: {
            seatId: holder.seatId,
            kind: holder.kind,
            displayName: holder.displayName,
          },
          absences: presence.projectAll(now()),
        });
      }
      tickPresence();
      presence.trackSeat(holder.seatId);
      const before = presence.get(holder.seatId);
      if (!before || before.phase === "present") {
        presence.noteHeartbeat(holder.seatId, now());
        return reply.send({
          resumed: false,
          seat: {
            seatId: holder.seatId,
            kind: holder.kind,
            displayName: holder.displayName,
          },
          absences: presence.projectAll(now()),
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
      presence.resume(holder.seatId);
      presence.noteHeartbeat(holder.seatId, now());
      return reply.send({
        resumed: true,
        seat: {
          seatId: holder.seatId,
          kind: holder.kind,
          displayName: holder.displayName,
        },
        absences: presence.projectAll(now()),
      });
    },
  );

  app.post<{
    Params: { code: string; seatId: string };
    Body: {
      action?: string;
      displayName?: string;
      cli?: string;
      modelId?: string | null;
    };
  }>("/api/rooms/:code/seats/:seatId/disposition", async (request, reply) => {
    const host = requireHostSeat(request, reply, request.params.code);
    if (!host) return;
    const { room } = host;
    if (room.phase !== "match" || !activeMatch || activeRoomCode !== room.code) {
      return reply.code(409).send({ error: "room_not_match" });
    }
    const seatId = request.params.seatId;
    const action = request.body?.action;
    tickPresence();
    const absence = presence.get(seatId);
    if (
      !absence ||
      (absence.phase !== "absent" && absence.phase !== "timed_out")
    ) {
      return reply.code(409).send({ error: "seat_not_absent" });
    }

    if (action === "extend_wait") {
      presence.extendWait(seatId, now());
      return reply.send({
        action: "extend_wait",
        absences: presence.projectAll(now()),
      });
    }

    if (action === "swap_agent") {
      const displayName =
        typeof request.body?.displayName === "string" &&
        request.body.displayName.trim().length > 0
          ? request.body.displayName.trim()
          : "Agent";
      const cli =
        request.body?.cli === "opencode" ||
        request.body?.cli === "claude" ||
        request.body?.cli === "stub"
          ? request.body.cli
          : "stub";
      const modelId =
        typeof request.body?.modelId === "string" ? request.body.modelId : null;
      const report = await runProbe();
      const ready = recheckSetupSeats([{ cli, modelId }], report);
      if (!ready.ok) {
        return reply.code(400).send({
          error: ready.reason,
          hint: ready.hint,
        });
      }
      const swapped = rooms.swapSeatToLocalAgent(room.code, seatId, {
        displayName,
        cli,
        modelId,
      });
      if (!swapped.ok) {
        return reply.code(409).send({ error: swapped.reason });
      }
      persistActiveRoom();
      const seats = activeMatch.state.seats.map((seat) =>
        seat.seatId === seatId
          ? { ...seat, controller: "stub_agent" as const }
          : seat,
      );
      activeMatch = {
        ...activeMatch,
        state: { ...activeMatch.state, seats },
        displayNames: {
          ...activeMatch.displayNames,
          [seatId]: displayName,
        },
        seatAgents: {
          ...activeMatch.seatAgents,
          [seatId]: { cli, modelId },
        },
      };
      store.commitCommand(activeMatch.state.matchId, activeMatch.state, []);
      presence.clearSeat(seatId);
      try {
        activeMatch = await advanceAgentSeats(activeMatch, runtimeOptions());
      } catch (error) {
        const matchId = activeMatch.state.matchId;
        store.technicalAbort(matchId, abortReasonFrom(error));
        revokeAllRemoteCredentials(room.code);
        presence.clear();
        activeMatch = null;
        activeRoomCode = null;
        return reply.code(502).send({
          error: abortReasonFrom(error),
          aborted: true,
          matchId,
        });
      }
      return reply.send({
        action: "swap_agent",
        ...humanFacingPayload(activeMatch, undefined, "1"),
        absences: presence.projectAll(now()),
        seats: publicSeats(swapped.room),
      });
    }

    if (action === "technical_abort") {
      const matchId = activeMatch.state.matchId;
      store.technicalAbort(matchId, "host_absence_disposition");
      revokeAllRemoteCredentials(room.code);
      rooms.revokeSeatCredential(room.code, seatId);
      persistActiveRoom();
      presence.clear();
      activeMatch = null;
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
      store.commitCommand(
        activeMatch.state.matchId,
        activeMatch.state,
        result.events,
      );
      rooms.revokeSeatCredential(room.code, seatId);
      persistActiveRoom();
      presence.clearSeat(seatId);
      if (activeMatch.state.status === "in_progress") {
        try {
          activeMatch = await advanceAgentSeats(activeMatch, runtimeOptions());
        } catch (error) {
          const matchId = activeMatch.state.matchId;
          store.technicalAbort(matchId, abortReasonFrom(error));
          revokeAllRemoteCredentials(room.code);
          presence.clear();
          activeMatch = null;
          activeRoomCode = null;
          return reply.code(502).send({
            error: abortReasonFrom(error),
            aborted: true,
            matchId,
          });
        }
      }
      return reply.send({
        action: "force_eliminate",
        ...humanFacingPayload(activeMatch, undefined, "1"),
        absences: presence.projectAll(now()),
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
              cli: holder.cli,
              modelId: holder.modelId,
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
        return reply.code(404).send({ error: "room_not_found" });
      }
      const state = options.hosting?.getState();
      const port = state?.port ?? 0;
      const snap = lanSnapshot(port, room.code);
      return reply.send(snap);
    },
  );

  app.patch<{
    Params: { code: string };
    Body: { selectedHost?: string };
  }>("/api/rooms/:code", async (request, reply) => {
    const room = rooms.getByCode(request.params.code);
    if (!room) {
      return reply.code(404).send({ error: "room_not_found" });
    }
    const candidates = listLanIpv4Candidates(listIfaces() as NetIfaceMap);
    const addresses = candidates.map((c) => c.address);
    const nextHost = request.body?.selectedHost;
    if (!nextHost || !addresses.includes(nextHost)) {
      return reply.code(400).send({ error: "invalid_lan_host" });
    }
    selectedLanHost = nextHost;
    const port = options.hosting?.getState().port ?? 0;
    const snap = lanSnapshot(port, room.code);
    return reply.send(snap);
  });

  app.get("/api/matches", async (_request, reply) => {
    return reply.send({ matches: store.listRuns() });
  });

  app.get("/api/matches/current/agent-phase", async (_request, reply) => {
    return reply.send({
      phase: agentPhase,
      seatId: agentSeatId,
      thinkingSeatIds,
    });
  });

  app.get<{ Params: { matchId: string } }>(
    "/api/matches/:matchId/events",
    async (request, reply) => {
      const run = store.getRun(request.params.matchId);
      if (!run) {
        return reply.code(404).send({ error: "match_not_found" });
      }
      return reply.send({
        matchId: run.matchId,
        runStatus: run.runStatus,
        winnerSeatId: run.winnerSeatId,
        events: store.listEvents(run.matchId),
      });
    },
  );

  app.post<{ Params: { matchId: string } }>(
    "/api/matches/:matchId/resume",
    async (request, reply) => {
      const source = store.getRun(request.params.matchId);
      if (!source) {
        return reply.code(404).send({ error: "match_not_found" });
      }
      if (
        source.runStatus !== "technical_abort"
      ) {
        return reply.code(409).send({ error: "match_not_resumable" });
      }

      const existing = store.findResumableRun();
      if (existing) {
        store.userAbort(existing.matchId);
      }

      const resumed = store.createResumeRun(
        source.matchId,
        `match-${Date.now()}`,
      );
      activeMatch = activeMatchFromRun(resumed);
      agentPhase = "thinking";
      agentSeatId = null;
      thinkingSeatIds = pendingAgentSeatIds(activeMatch);
      try {
        activeMatch = await advanceAgentSeats(activeMatch, runtimeOptions());
        agentPhase = "idle";
        agentSeatId = null;
        thinkingSeatIds = [];
      } catch (error) {
        agentPhase = "failed";
        thinkingSeatIds = [];
        store.technicalAbort(activeMatch.state.matchId, abortReasonFrom(error));
        activeMatch = null;
        return reply.code(502).send({
          error: abortReasonFrom(error),
          aborted: true,
          matchId: resumed.matchId,
        });
      }
      return reply.send({
        ...humanFacingPayload(activeMatch),
        resumedFromMatchId: source.matchId,
      });
    },
  );

  app.post("/api/matches", async (request, reply) => {
    const body =
      request.body === undefined || request.body === null
        ? {
            seats: [
              {
                seatId: "seat-human",
                controller: "local_human",
                displayName: "你",
              },
              {
                seatId: "seat-stub",
                controller: "stub_agent",
                displayName: "灰狐",
                cli: "stub",
                modelId: "stub/placeholder",
              },
            ],
          }
        : request.body;

    const parsed = parseMatchSetup(body);
    if (!parsed.ok) {
      return reply.code(400).send({ error: parsed.reason });
    }

    const report = await runProbe();
    const gate = recheckSetupSeats(parsed.setup.seats, report);
    if (!gate.ok) {
      return reply.code(400).send({
        error: gate.reason,
        hint: gate.hint,
      });
    }

    try {
      agentPhase = "thinking";
      agentSeatId = null;
      thinkingSeatIds = [];
      activeMatch = await startMatch({
        seats: parsed.setup.seats,
        ...runtimeOptions(),
      });
      activeRoomCode = null;
      agentPhase = "idle";
      agentSeatId = null;
      thinkingSeatIds = [];
    } catch (error) {
      agentPhase = "failed";
      thinkingSeatIds = [];
      const startedId = store.findResumableRun()?.matchId;
      if (startedId) {
        store.technicalAbort(startedId, abortReasonFrom(error));
      }
      activeMatch = null;
      activeRoomCode = null;
      return reply.code(502).send({
        error: abortReasonFrom(error),
        aborted: Boolean(startedId),
        matchId: startedId ?? null,
      });
    }
    return reply.send(humanFacingPayload(activeMatch));
  });

  app.get("/api/matches/current", async (request, reply) => {
    if (!activeMatch && recoveryStatus !== "failed") {
      // MVP local resume only — never silently revive a LAN run while recovery failed.
      if (recoveryStatus === "none" && !activeRoomCode) {
        const again = store.findResumableRun();
        if (again) {
          activeMatch = activeMatchFromRun(again);
        }
      }
    }
    if (!activeMatch) {
      return reply.code(404).send({ error: "no_active_match" });
    }

    const seatId = resolveMatchSeatId(request);
    if (!seatId) {
      return reply.code(403).send({ error: "seat_credential_required" });
    }

    tickPresence();
    const deciding = activeDecidingSeatId(activeMatch.state);
    const blockedByAbsence =
      deciding !== null &&
      presence.blocksAdvancement(deciding, true);

    // Still try to advance agents when the deciding seat is not an absent remote.
    if (!blockedByAbsence) {
      const advanced = await advanceActiveOrAbort(activeMatch);
      if (!advanced.ok) {
        activeMatch = null;
        activeRoomCode = null;
        return reply.code(502).send({
          error: advanced.error,
          aborted: true,
          matchId: advanced.matchId,
        });
      }
      activeMatch = advanced.match;
    }

    return reply.send({
      ...humanFacingPayload(activeMatch, undefined, seatId),
      matchId: activeMatch.state.matchId,
      absences: presence.projectAll(now()),
      pausedForAbsenceSeatId: blockedByAbsence ? deciding : null,
    });
  });

  app.post("/api/matches/current/decision", async (request, reply) => {
    if (!activeMatch) {
      return reply.code(404).send({ error: "no_active_match" });
    }
    const seatId = resolveMatchSeatId(request);
    if (!seatId) {
      return reply.code(403).send({ error: "seat_credential_required" });
    }
    tickPresence();
    const absence = presence.get(seatId);
    if (
      absence &&
      (absence.phase === "absent" || absence.phase === "timed_out")
    ) {
      return reply.code(409).send({
        error: "seat_absent",
        absences: presence.projectAll(now()),
      });
    }
    // Decision during grace counts as channel recovery (no credential rotate).
    if (absence?.phase === "reconnecting") {
      presence.noteHeartbeat(seatId, now());
      presence.resume(seatId);
    }
    const body = request.body as SeatDecision;
    const matchId = activeMatch.state.matchId;
    let result: Awaited<ReturnType<typeof submitHumanDecision>>;
    try {
      agentPhase = "thinking";
      agentSeatId = null;
      thinkingSeatIds = [];
      result = await submitHumanDecision(activeMatch, body, {
        ...runtimeOptions(),
        actingSeatId: seatId,
      });
      agentPhase = "idle";
      agentSeatId = null;
      thinkingSeatIds = [];
    } catch (error) {
      agentPhase = "failed";
      thinkingSeatIds = [];
      const run = store.getRun(matchId);
      if (run && run.runStatus === "in_progress") {
        store.technicalAbort(matchId, abortReasonFrom(error));
      }
      activeMatch = null;
      activeRoomCode = null;
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
    if (
      activeMatch.state.status === "finished" &&
      activeRoomCode
    ) {
      revokeAllRemoteCredentials(activeRoomCode);
      presence.clear();
    }
    return reply.send({
      ...humanFacingPayload(activeMatch, body.requestId, seatId),
      absences: presence.projectAll(now()),
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
