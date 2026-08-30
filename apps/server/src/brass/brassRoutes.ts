import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { BrassCommand, BrassState } from "@coup/brass-domain";
import { planAutoDecision } from "@coup/brass-domain";
import { createRoomRegistry, normalizeTurnTimeLimit, publicSeats, type RoomRecord, type RoomRegistry } from "../roomRegistry.js";
import { claimRoomCode, allClaimedCodes } from "../roomCodePool.js";
import { IDLE_ROOM_RECLAIM_MS, IDLE_ROOM_SWEEP_MS } from "../roomLifecycle.js";
import {
  SEAT_COOKIE,
  hashToken,
  issueSeatToken,
  parseCookies,
  serializeCookie,
  type SessionRecord,
} from "../sessionAuth.js";
import { createSeatPresenceTracker, type SeatPresenceTracker } from "../seatPresenceTracker.js";
import { evaluateLobbyStartGates, effectiveLobbySeats } from "../lobbyStart.js";
import { openBrassStore, type BrassStore } from "./brassStore.js";
import {
  activeDecidingPlayerOf,
  newBrassMatchId,
  playerToSeatId,
  seatIdToPlayer,
  startBrassMatch,
  submitBrassDecision,
  toBrassSpectatorView,
  toBrassSeatView,
  type ActiveBrassMatch,
  type BrassDecisionPayload,
} from "./brassRuntime.js";

/**
 * Brass 房间/对局 API（ADR-0009）：与 coup 平行的路由栈，挂载于 /api/brass/*。
 * 复用 coup 的会话/CSRF 守卫（requireSession 由 createApp 注入闭包）、
 * 房间注册表（4 座位 + 共享码池）、心跳离席状态机与空房清扫语义。
 * 对局规则完全来自 @coup/brass-domain。
 */

export type BrassDeps = {
  dbPath: string;
  now: () => number;
  /** coup createApp 的会话/CSRF 守卫（含 Origin 校验）。 */
  requireSession: (
    request: { headers: Record<string, unknown> },
    reply: { code: (status: number) => { send: (body: unknown) => unknown } },
  ) => SessionRecord | null;
  appendSetCookie: (
    reply: { getHeader: (name: string) => unknown; header: (name: string, value: string | string[]) => unknown },
    value: string,
  ) => void;
  /** 主机模式与局域网主机信息（建房/快照用）。 */
  getHostContext: () => { bindMode: "local" | "host"; port: number; lanHost: string | null } | null;
};

export type BrassRuntime = {
  registry: RoomRegistry;
  store: BrassStore;
  /** 进程内手动解散（测试/诊断）。 */
  dissolve: (code: string) => void;
};

export function registerBrassRoutes(app: FastifyInstance, deps: BrassDeps): BrassRuntime {
  const registry = createRoomRegistry({
    seatCount: 4,
    takenExtra: allClaimedCodes,
    onCodeAllocated: claimRoomCode,
  });
  const store = openBrassStore(deps.dbPath);
  const presence: SeatPresenceTracker = createSeatPresenceTracker();
  const now = deps.now;
  const matchesByRoom = new Map<string, ActiveBrassMatch>();
  const roomActivity = new Map<string, { lastActivityAt: number; emptySince: number | null }>();
  const lastAutoDecisions = new Map<string, { seatId: string; at: number; kind: string; matchId: string }>();

  type TurnTimerState = {
    timeoutId: ReturnType<typeof setTimeout> | null;
    seatId: string | null;
    deadlineAt: number | null;
    durationMs: number;
    armedForVersion: number;
  };
  const turnTimers = new Map<string, TurnTimerState>();

  const BRASS_MAX_ROOMS = 10;

  function tickPresence(code?: string) {
    const codes = code ? [code] : registry.listCodes();
    for (const roomCode of codes) {
      const room = registry.getByCode(roomCode);
      if (room) {
        for (const seat of room.seats) {
          if (seat.kind !== "remote_human") {
            presence.clearSeat(roomCode, seat.seatId);
          }
        }
      }
      presence.tick(roomCode, now());
    }
  }

  function isBrassRoomEmpty(room: RoomRecord): boolean {
    if (room.phase !== "match") {
      return !room.seats.some((seat) => seat.kind === "remote_human");
    }
    const match = matchesByRoom.get(room.code);
    if (!match) {
      return !room.seats.some((seat) => seat.kind === "local_human" || seat.kind === "remote_human");
    }
    for (let i = 0; i < match.state.playerCount; i++) {
      const seatId = String(i + 1);
      const roomSeat = room.seats.find((s) => s.seatId === seatId);
      if (!roomSeat || roomSeat.kind === "local_human") return false;
      const current = presence.get(room.code, seatId);
      if (!current || (current.phase !== "absent" && current.phase !== "timed_out")) {
        return false;
      }
    }
    return true;
  }

  function markRoomActive(code: string) {
    const room = registry.getByCode(code);
    const current = now();
    roomActivity.set(code, {
      lastActivityAt: current,
      emptySince: room && isBrassRoomEmpty(room) ? current : null,
    });
  }

  function persistActiveRoom() {
    for (const code of registry.listCodes()) {
      const room = registry.getByCode(code);
      if (room) store.saveBrassRoom(room);
    }
  }

  function clearTurnTimer(code: string) {
    const timer = turnTimers.get(code);
    if (timer?.timeoutId) clearTimeout(timer.timeoutId);
    turnTimers.delete(code);
  }

  function turnTimeLimitMs(code: string): number {
    const room = registry.getByCode(code);
    const limitSec = normalizeTurnTimeLimit(room?.turnTimeLimitSec);
    return limitSec > 0 ? limitSec * 1000 : 0;
  }

  function turnDeadlinePayload(code: string) {
    const timer = turnTimers.get(code);
    if (!timer || timer.seatId == null || timer.deadlineAt == null || timer.durationMs <= 0) return null;
    return { seatId: timer.seatId, deadlineAt: timer.deadlineAt, durationMs: timer.durationMs };
  }

  function lastAutoDecisionPayload(code: string) {
    const record = lastAutoDecisions.get(code);
    const match = matchesByRoom.get(code);
    if (!record || !match || record.matchId !== match.state.matchId) return null;
    return { seatId: record.seatId, at: record.at, kind: record.kind };
  }

  function armTurnTimer(code: string) {
    clearTurnTimer(code);
    const match = matchesByRoom.get(code);
    if (!match || match.state.status !== "in_progress") return;
    const durationMs = turnTimeLimitMs(code);
    if (durationMs <= 0) return;
    const player = activeDecidingPlayerOf(match.state);
    if (player === null) return;
    const seatId = playerToSeatId(player);
    if (presence.blocksAdvancement(code, seatId, true)) return;
    const deadlineAt = now() + durationMs;
    const armedForVersion = match.state.stateVersion;
    const timeoutId = setTimeout(() => {
      void fireTurnTimeout(code, armedForVersion);
    }, durationMs + 40);
    (timeoutId as { unref?: () => void }).unref?.();
    turnTimers.set(code, { timeoutId, seatId, deadlineAt, durationMs, armedForVersion });
  }

  function fireTurnTimeout(code: string, armedForVersion: number) {
    const match = matchesByRoom.get(code);
    if (!match || match.state.stateVersion !== armedForVersion) {
      turnTimers.delete(code);
      return;
    }
    const timer = turnTimers.get(code);
    const seatId = timer?.seatId;
    clearTurnTimer(code);
    if (!match || match.state.status !== "in_progress" || !seatId) return;
    if (presence.blocksAdvancement(code, seatId, true)) {
      armTurnTimer(code);
      return;
    }
    const player = seatIdToPlayer(seatId);
    if (player === null) return;
    const plan = planAutoDecision(match.state, player, match.state.stateVersion);
    if (!plan) {
      armTurnTimer(code);
      return;
    }
    try {
      const result = submitBrassDecision(
        match,
        {
          protocolVersion: 1,
          requestId: `auto-${match.state.stateVersion}-${seatId}`,
          stateVersion: match.state.stateVersion,
          command: plan,
        },
        { actingSeatId: seatId },
      );
      if (result.ok) {
        matchesByRoom.set(code, result.match);
        lastAutoDecisions.set(code, {
          seatId,
          at: now(),
          kind: plan.type,
          matchId: result.match.state.matchId,
        });
      }
    } catch {
      // 持久化失败等：交由下次决策路径处理。
    }
    armTurnTimer(code);
  }

  function dissolveRoom(code: string, matchId?: string | null, abortReason = "room_idle_reclaimed") {
    const activeMatchId = matchId ?? matchesByRoom.get(code)?.state.matchId;
    if (activeMatchId) {
      const run = store.getRun(activeMatchId);
      if (run && run.runStatus === "in_progress") store.technicalAbort(activeMatchId, abortReason);
    }
    clearTurnTimer(code);
    lastAutoDecisions.delete(code);
    registry.dissolve(code);
    store.clearBrassRoom(code);
    matchesByRoom.delete(code);
    presence.clearRoom(code);
    roomActivity.delete(code);
  }

  function reclaimIdleRooms() {
    const current = now();
    for (const code of registry.listCodes()) {
      const room = registry.getByCode(code);
      if (!room) continue;
      tickPresence(code);
      const activity = roomActivity.get(code) ?? { lastActivityAt: current, emptySince: null };
      const empty = isBrassRoomEmpty(room);
      if (!empty) {
        activity.emptySince = null;
      } else if (activity.emptySince === null) {
        activity.emptySince = activity.lastActivityAt;
      }
      if (empty && activity.emptySince !== null && current - activity.emptySince >= IDLE_ROOM_RECLAIM_MS) {
        dissolveRoom(code);
        continue;
      }
      roomActivity.set(code, activity);
    }
  }

  function resolveMatchSeatId(
    request: { headers: Record<string, unknown> },
    code: string,
    match: ActiveBrassMatch,
  ): string | null {
    const room = registry.getByCode(code);
    if (!room) return null;
    const cookies = parseCookies(typeof request.headers.cookie === "string" ? request.headers.cookie : undefined);
    const seatToken = cookies[SEAT_COOKIE];
    if (!seatToken) return null;
    const holder = registry.findSeatByCredential(room.code, hashToken(seatToken));
    if (!holder) return null;
    const player = seatIdToPlayer(holder.seatId);
    if (player === null || player >= match.state.playerCount) return null;
    return holder.seatId;
  }

  function sharedTail(code: string) {
    const match = matchesByRoom.get(code);
    const decidingPlayer = match ? activeDecidingPlayerOf(match.state) : null;
    const decidingSeatId = decidingPlayer === null ? null : playerToSeatId(decidingPlayer);
    const blockedByAbsence =
      decidingSeatId !== null && presence.blocksAdvancement(code, decidingSeatId, true);
    return {
      absences: presence.projectAll(code, now()),
      pausedForAbsenceSeatId: blockedByAbsence ? decidingSeatId : null,
      turnDeadline: turnDeadlinePayload(code),
      autoDecision: lastAutoDecisionPayload(code),
    };
  }

  function brassInvitePayload(room: RoomRecord) {
    const host = deps.getHostContext();
    const seats = publicSeats(room);
    const lanHost = host?.lanHost ?? null;
    return {
      code: room.code,
      phase: room.phase,
      game: "brass" as const,
      seats,
      turnTimeLimitSec: room.turnTimeLimitSec,
      joinUrl: lanHost ? `http://${lanHost}:${host?.port ?? 80}/brass/join?code=${room.code}` : null,
      lanOrigin: lanHost && host ? `http://${lanHost}:${host.port}` : null,
      bindMode: host?.bindMode ?? "local",
      error: lanHost ? null : ("no_lan_ipv4" as const),
    };
  }

  function requireHostSeat(
    request: { headers: Record<string, unknown> },
    reply: { code: (status: number) => { send: (body: unknown) => unknown } },
    code: string,
  ) {
    if (!deps.requireSession(request, reply)) return null;
    const room = registry.getByCode(code);
    if (!room) {
      reply.code(404).send({ error: "room_not_found" });
      return null;
    }
    const cookies = parseCookies(typeof request.headers.cookie === "string" ? request.headers.cookie : undefined);
    const seatToken = cookies[SEAT_COOKIE];
    const holder = seatToken ? registry.findSeatByCredential(room.code, hashToken(seatToken)) : null;
    if (!holder || holder.kind !== "local_human" || holder.seatId !== "1") {
      reply.code(403).send({ error: "host_seat_required" });
      return null;
    }
    return { room, holder };
  }

  function playerCountFor(room: RoomRecord): 2 | 3 | 4 {
    const n = effectiveLobbySeats(room).length;
    return Math.min(4, Math.max(2, n)) as 2 | 3 | 4;
  }

  // ------------------------------------------------------------------
  // 启动恢复：brass_rooms + brass_runs
  // ------------------------------------------------------------------
  const recovery = new Map<string, { code: string; status: "none" | "restored" | "failed"; reason: string | null; room: RoomRecord | null }>();
  {
    const loaded = store.loadBrassRooms();
    for (const failure of loaded.failures) {
      recovery.set(failure.roomCode ?? "migration", {
        code: failure.roomCode ?? "migration",
        status: "failed",
        reason: failure.reason,
        room: null,
      });
    }
    for (const room of loaded.rooms) {
      if (room.phase === "match") {
        if (!room.matchId) {
          recovery.set(room.code, { code: room.code, status: "failed", reason: "match_missing", room });
          continue;
        }
        const run = store.getRun(room.matchId);
        if (!run || run.roomCode !== room.code || run.runStatus !== "in_progress") {
          const reason = !run ? "match_not_active" : run.roomCode !== room.code ? "match_room_mismatch" : "match_not_active";
          recovery.set(room.code, { code: room.code, status: "failed", reason, room });
          continue;
        }
        registry.restore(room);
        claimRoomCode(room.code);
        const match: ActiveBrassMatch = {
          state: run.state,
          events: run.events,
          humanSeatId: run.humanSeatId,
          displayNames: run.displayNames,
        };
        matchesByRoom.set(room.code, match);
        markRoomActive(room.code);
        recovery.set(room.code, { code: room.code, status: "restored", reason: null, room });
        // 恢复宽限 + 重排计时。
        const seatIds = room.seats.filter((s) => s.kind === "remote_human").map((s) => s.seatId);
        presence.grantRecoveryGrace(seatIds, room.code, now());
        armTurnTimer(room.code);
      } else {
        registry.restore(room);
        claimRoomCode(room.code);
        markRoomActive(room.code);
        recovery.set(room.code, { code: room.code, status: "restored", reason: null, room });
      }
    }
  }

  const idleSweepTimer = setInterval(() => {
    reclaimIdleRooms();
  }, IDLE_ROOM_SWEEP_MS);
  (idleSweepTimer as { unref?: () => void }).unref?.();

  app.addHook("onClose", async () => {
    store.close();
    for (const code of [...turnTimers.keys()]) clearTurnTimer(code);
  });

  app.addHook("onResponse", async (request, reply) => {
    if (reply.statusCode < 200 || reply.statusCode >= 300) return;
    if (request.method !== "POST" && request.method !== "PATCH") return;
    const match = request.url.match(/^\/api\/brass\/rooms\/([0-9]{4})(?:\/|$)/);
    if (match && registry.getByCode(match[1]!)) markRoomActive(match[1]!);
  });

  // ------------------------------------------------------------------
  // 路由
  // ------------------------------------------------------------------

  app.get("/api/brass/room-recovery", async (_request, reply) => {
    return reply.send({
      items: [...recovery.values()].map(({ code, status, reason, room }) => ({
        code,
        status,
        reason,
        game: "brass",
        phase: room?.phase ?? null,
      })),
    });
  });

  app.post("/api/brass/room-recovery/abandon", async (request, reply) => {
    if (!deps.requireSession(request, reply)) return;
    const roomCode = (request.body as { roomCode?: string } | undefined)?.roomCode;
    if (typeof roomCode !== "string" || !roomCode) {
      return reply.code(400).send({ error: "room_code_required" });
    }
    const item = recovery.get(roomCode);
    if (!item) return reply.code(404).send({ error: "recovery_room_not_found" });
    dissolveRoom(roomCode, item.room?.matchId, "host_restart_abandoned");
    recovery.delete(roomCode);
    return reply.send({ status: "none", abandoned: true, roomCode });
  });

  app.post("/api/brass/rooms", async (_request, reply) => {
    if (!deps.requireSession(_request, reply)) return;
    const host = deps.getHostContext();
    if (!host || host.bindMode !== "host") {
      return reply.code(409).send({ error: "need_host_mode" });
    }
    reclaimIdleRooms();
    if (registry.listCodes().length >= BRASS_MAX_ROOMS) {
      return reply.code(503).send({ error: "room_capacity_reached", message: "伯明翰房间已满，稍后再试" });
    }
    const room = registry.create();
    markRoomActive(room.code);
    const hostSeat = room.seats[0];
    const issued = issueSeatToken();
    if (hostSeat) hostSeat.credentialHash = issued.hash;
    persistActiveRoom();
    deps.appendSetCookie(reply, serializeCookie(SEAT_COOKIE, issued.token));
    return reply.send(brassInvitePayload(room));
  });

  app.post<{ Params: { code: string; seatId: string }; Body: { displayName?: string } }>(
    "/api/brass/rooms/:code/seats/:seatId/claim",
    async (request, reply) => {
      if (!deps.requireSession(request, reply)) return;
      const room = registry.getByCode(request.params.code);
      if (!room) return reply.code(404).send({ error: "room_not_found" });
      const displayName =
        typeof request.body?.displayName === "string" && request.body.displayName.trim().length > 0
          ? request.body.displayName.trim().slice(0, 24)
          : "客人";
      const issued = issueSeatToken();
      const result = registry.claimSeat(room.code, request.params.seatId, {
        displayName,
        credentialHash: issued.hash,
      });
      if (!result.ok) {
        if (result.reason === "room_not_found" || result.reason === "seat_not_found") {
          return reply.code(404).send({ error: result.reason });
        }
        return reply.code(409).send({ error: "seat_not_open" });
      }
      persistActiveRoom();
      deps.appendSetCookie(reply, serializeCookie(SEAT_COOKIE, issued.token));
      return reply.send({
        seat: {
          seatId: result.seat.seatId,
          kind: result.seat.kind,
          displayName: result.seat.displayName,
          rematchStatus: result.seat.rematchStatus,
        },
        seats: publicSeats(result.room),
      });
    },
  );

  app.patch<{ Params: { code: string; seatId: string }; Body: { displayName?: string } }>(
    "/api/brass/rooms/:code/seats/:seatId",
    async (request, reply) => {
      if (!deps.requireSession(request, reply)) return;
      const room = registry.getByCode(request.params.code);
      if (!room) return reply.code(404).send({ error: "room_not_found" });
      const cookies = parseCookies(typeof request.headers.cookie === "string" ? request.headers.cookie : undefined);
      const seatToken = cookies[SEAT_COOKIE];
      if (!seatToken) return reply.code(401).send({ error: "seat_credential_required" });
      const holder = registry.findSeatByCredential(room.code, hashToken(seatToken));
      if (!holder || holder.seatId !== request.params.seatId) {
        return reply.code(403).send({ error: "seat_credential_mismatch" });
      }
      const displayName =
        typeof request.body?.displayName === "string" && request.body.displayName.trim().length > 0
          ? request.body.displayName.trim().slice(0, 24)
          : null;
      if (!displayName) return reply.code(400).send({ error: "display_name_required" });
      const result = registry.renameSeat(room.code, request.params.seatId, displayName);
      if (!result.ok) {
        return reply.code(result.reason === "room_not_found" || result.reason === "seat_not_found" ? 404 : 409).send({
          error: result.reason,
        });
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
    },
  );

  app.patch<{ Params: { code: string; seatId: string }; Body: { kind?: string } }>(
    "/api/brass/rooms/:code/seats/:seatId/config",
    async (request, reply) => {
      const host = requireHostSeat(request, reply, request.params.code);
      if (!host) return;
      const kind = request.body?.kind;
      if (kind !== "open" && kind !== "closed") {
        return reply.code(400).send({ error: "invalid_seat_kind" });
      }
      const result = registry.configureSeat(host.room.code, request.params.seatId, {
        kind: kind === "open" ? "open" : "closed",
      });
      if (!result.ok) {
        return reply.code(409).send({ error: result.reason });
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
    },
  );

  app.patch<{ Params: { code: string }; Body: { turnTimeLimitSec?: number } }>(
    "/api/brass/rooms/:code/settings",
    async (request, reply) => {
      const host = requireHostSeat(request, reply, request.params.code);
      if (!host) return;
      const raw = request.body?.turnTimeLimitSec;
      if (typeof raw !== "number" || !Number.isFinite(raw)) {
        return reply.code(400).send({ error: "invalid_setting" });
      }
      const normalized = normalizeTurnTimeLimit(raw);
      if (normalized !== raw) return reply.code(400).send({ error: "invalid_setting" });
      const result = registry.updateSettings(host.room.code, { turnTimeLimitSec: normalized });
      if (!result.ok) {
        return reply.code(result.reason === "room_locked" ? 409 : 400).send({ error: result.reason });
      }
      persistActiveRoom();
      return reply.send({ turnTimeLimitSec: result.room.turnTimeLimitSec, seats: publicSeats(result.room) });
    },
  );

  app.post<{ Params: { code: string } }>("/api/brass/rooms/:code/start", async (request, reply) => {
    if (!deps.requireSession(request, reply)) return;
    const room = registry.getByCode(request.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    const cookies = parseCookies(typeof request.headers.cookie === "string" ? request.headers.cookie : undefined);
    const seatToken = cookies[SEAT_COOKIE];
    const holder = seatToken ? registry.findSeatByCredential(room.code, hashToken(seatToken)) : null;
    if (!holder || holder.kind !== "local_human" || holder.seatId !== "1") {
      return reply.code(403).send({ error: "host_seat_required" });
    }
    const currentRun = room.matchId != null ? store.getRun(room.matchId) : null;
    const rematchAllowed =
      room.phase === "match" && currentRun !== null && currentRun.runStatus !== "in_progress";
    // 大厅开局：剩余空位自动关闭（brass 2-4 人即可开局）。
    if (room.phase === "lobby") {
      for (const seat of room.seats) {
        if (seat.kind === "open") {
          registry.configureSeat(room.code, seat.seatId, { kind: "closed" });
        }
      }
    }
    const gates = evaluateLobbyStartGates(room, {
      allowMatchPhase: rematchAllowed,
      allowRematchPhase: room.phase === "rematch",
    });
    if (!gates.ok) return reply.code(400).send({ error: gates.reason });

    const seats = effectiveLobbySeats(room);
    const playerCount = playerCountFor(room);
    const matchId = newBrassMatchId();
    const displayNames: Record<string, string> = {};
    for (const seat of seats) {
      displayNames[seat.seatId] = seat.displayName ?? (seat.kind === "local_human" ? "你" : "客人");
    }
    const match = startBrassMatch({
      matchId,
      seed: `brass-${randomUUID()}`,
      playerCount,
      displayNames,
      persistence: {
        onCreated: (m, roomCode) => {
          if (!roomCode) throw new Error("room_code_required");
          store.createRun({
            matchId: m.state.matchId,
            roomCode,
            humanSeatId: m.humanSeatId,
            displayNames: m.displayNames,
            state: m.state,
            events: m.events,
          });
        },
        onCommitted: (m, newEvents) => {
          if (newEvents.length === 0) return;
          store.commitCommand(m.state.matchId, m.state, newEvents);
        },
      },
      roomCode: room.code,
    });
    const begun = registry.beginMatch(room.code, matchId);
    if (!begun.ok) {
      store.userAbort(matchId);
      return reply.code(409).send({ error: begun.reason });
    }
    matchesByRoom.set(room.code, match);
    persistActiveRoom();
    // 追踪远程座位心跳。
    presence.clearRoom(room.code);
    const t = now();
    for (const seat of seats) {
      if (seat.kind === "remote_human") {
        presence.trackSeat(room.code, seat.seatId);
        presence.noteHeartbeat(room.code, seat.seatId, t);
      }
    }
    lastAutoDecisions.delete(room.code);
    armTurnTimer(room.code);
    return reply.send({
      view: toBrassSeatView(match, "1"),
      phase: begun.room.phase,
      matchId,
      absences: presence.projectAll(room.code, now()),
      turnDeadline: turnDeadlinePayload(room.code),
      autoDecision: null,
    });
  });

  app.post<{ Params: { code: string } }>("/api/brass/rooms/:code/heartbeat", async (request, reply) => {
    if (!deps.requireSession(request, reply)) return;
    const room = registry.getByCode(request.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    const cookies = parseCookies(typeof request.headers.cookie === "string" ? request.headers.cookie : undefined);
    const seatToken = cookies[SEAT_COOKIE];
    const holder = seatToken ? registry.findSeatByCredential(room.code, hashToken(seatToken)) : null;
    if (!holder || holder.kind !== "remote_human") {
      return reply.code(403).send({ error: "remote_seat_required" });
    }
    const t = now();
    presence.trackSeat(room.code, holder.seatId);
    presence.noteHeartbeat(room.code, holder.seatId, t);
    tickPresence(room.code);
    return reply.send({ ok: true, absences: presence.projectAll(room.code, now()) });
  });

  app.get<{ Params: { code: string } }>("/api/brass/rooms/:code/presence", async (request, reply) => {
    const room = registry.getByCode(request.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    tickPresence(room.code);
    return reply.send({ absences: presence.projectAll(room.code, now()) });
  });

  app.post<{ Params: { code: string } }>("/api/brass/rooms/:code/resume-seat", async (request, reply) => {
    if (!deps.requireSession(request, reply)) return;
    const room = registry.getByCode(request.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    const cookies = parseCookies(typeof request.headers.cookie === "string" ? request.headers.cookie : undefined);
    const seatToken = cookies[SEAT_COOKIE];
    const holder = seatToken ? registry.findSeatByCredential(room.code, hashToken(seatToken)) : null;
    if (!holder || (holder.kind !== "remote_human" && holder.kind !== "local_human")) {
      return reply.code(403).send({ error: "seat_credential_required" });
    }
    if (holder.kind === "local_human") {
      presence.clearSeat(room.code, holder.seatId);
      tickPresence(room.code);
      return reply.send({
        resumed: false,
        seat: { seatId: holder.seatId, kind: holder.kind, displayName: holder.displayName, rematchStatus: holder.rematchStatus },
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
        seat: { seatId: holder.seatId, kind: holder.kind, displayName: holder.displayName, rematchStatus: holder.rematchStatus },
        absences: presence.projectAll(room.code, now()),
      });
    }
    const issued = issueSeatToken();
    const rotated = registry.rotateSeatCredential(room.code, holder.seatId, issued.hash);
    if (!rotated.ok) return reply.code(409).send({ error: rotated.reason });
    persistActiveRoom();
    deps.appendSetCookie(reply, serializeCookie(SEAT_COOKIE, issued.token));
    presence.resume(room.code, holder.seatId);
    presence.noteHeartbeat(room.code, holder.seatId, now());
    return reply.send({
      resumed: true,
      seat: { seatId: holder.seatId, kind: holder.kind, displayName: holder.displayName },
      absences: presence.projectAll(room.code, now()),
    });
  });

  app.post<{ Params: { code: string; seatId: string }; Body: { action?: string } }>(
    "/api/brass/rooms/:code/seats/:seatId/disposition",
    async (request, reply) => {
      const host = requireHostSeat(request, reply, request.params.code);
      if (!host) return;
      const { room } = host;
      let activeMatch = matchesByRoom.get(room.code) ?? null;
      if (room.phase !== "match" || !activeMatch) {
        return reply.code(409).send({ error: "room_not_match" });
      }
      const seatId = request.params.seatId;
      const action = request.body?.action;
      tickPresence(room.code);
      const absence = presence.get(room.code, seatId);
      if (!absence || (absence.phase !== "absent" && absence.phase !== "timed_out")) {
        return reply.code(409).send({ error: "seat_not_absent" });
      }
      if (action === "extend_wait") {
        presence.extendWait(room.code, seatId, now());
        return reply.send({ action: "extend_wait", absences: presence.projectAll(room.code, now()) });
      }
      if (action === "technical_abort") {
        const matchId = activeMatch.state.matchId;
        store.technicalAbort(matchId, "host_absence_disposition");
        for (const seat of room.seats) {
          if (seat.kind === "remote_human") registry.revokeSeatCredential(room.code, seat.seatId);
        }
        registry.revokeSeatCredential(room.code, seatId);
        persistActiveRoom();
        presence.clearRoom(room.code);
        clearTurnTimer(room.code);
        lastAutoDecisions.delete(room.code);
        matchesByRoom.delete(room.code);
        return reply.send({ action: "technical_abort", aborted: true, matchId });
      }
      // brass 无淘汰语义：离席玩家的处置仅支持等待或终止对局。
      return reply.code(400).send({ error: "disposition_not_supported" });
    },
  );

  app.get<{ Params: { code: string } }>("/api/brass/rooms/:code/me", async (request, reply) => {
    const room = registry.getByCode(request.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    const cookies = parseCookies(typeof request.headers.cookie === "string" ? request.headers.cookie : undefined);
    const seatToken = cookies[SEAT_COOKIE];
    const holder = seatToken ? registry.findSeatByCredential(room.code, hashToken(seatToken)) : null;
    return reply.send({
      seat: holder
        ? { seatId: holder.seatId, kind: holder.kind, displayName: holder.displayName }
        : null,
      seats: publicSeats(room),
    });
  });

  app.get<{ Params: { code: string } }>("/api/brass/rooms/:code", async (request, reply) => {
    const room = registry.getByCode(request.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    markRoomActive(room.code);
    return reply.send(brassInvitePayload(room));
  });

  app.get<{ Params: { code: string }; Querystring: { since?: string; spectate?: string } }>(
    "/api/brass/rooms/:code/matches/current",
    async (request, reply) => {
      const room = registry.getByCode(request.params.code);
      if (!room) return reply.code(404).send({ error: "room_not_found" });
      const activeMatch = matchesByRoom.get(room.code) ?? null;
      if (!activeMatch) return reply.code(404).send({ error: "no_active_match" });

      const wantsSpectate = request.query.spectate === "1";
      const seatId = wantsSpectate ? null : resolveMatchSeatId(request, room.code, activeMatch);
      if (!seatId && !wantsSpectate) {
        return reply.code(403).send({ error: "seat_credential_required" });
      }
      tickPresence(room.code);
      const tail = sharedTail(room.code);

      const sinceRaw = request.query.since;
      if (sinceRaw != null && sinceRaw !== "") {
        const since = Number(sinceRaw);
        if (Number.isInteger(since) && since === activeMatch.state.stateVersion) {
          return reply.send({ unchanged: true, stateVersion: since, ...tail });
        }
      }

      if (wantsSpectate) {
        return reply.send({
          view: toBrassSpectatorView(activeMatch),
          matchId: activeMatch.state.matchId,
          ...tail,
        });
      }
      return reply.send({
        view: toBrassSeatView(activeMatch, seatId ?? "1"),
        matchId: activeMatch.state.matchId,
        ...tail,
      });
    },
  );

  app.post<{ Params: { code: string } }>("/api/brass/rooms/:code/matches/current/decision", async (request, reply) => {
    const room = registry.getByCode(request.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    let activeMatch = matchesByRoom.get(room.code) ?? null;
    if (!activeMatch) return reply.code(404).send({ error: "no_active_match" });
    const seatId = resolveMatchSeatId(request, room.code, activeMatch);
    if (!seatId) return reply.code(403).send({ error: "seat_credential_required" });
    tickPresence(room.code);
    const absence = presence.get(room.code, seatId);
    if (absence && (absence.phase === "absent" || absence.phase === "timed_out")) {
      return reply.code(409).send({ error: "seat_absent", absences: presence.projectAll(room.code, now()) });
    }
    if (absence?.phase === "reconnecting") {
      presence.noteHeartbeat(room.code, seatId, now());
      presence.resume(room.code, seatId);
    }
    const body = request.body as BrassDecisionPayload;
    const result = submitBrassDecision(activeMatch, body, { actingSeatId: seatId });
    if (!result.ok) {
      return reply.code(409).send({ error: result.reason });
    }
    activeMatch = result.match;
    matchesByRoom.set(room.code, activeMatch);
    if (activeMatch.state.status === "finished") {
      presence.clearRoom(room.code);
    }
    armTurnTimer(room.code);
    return reply.send({
      view: toBrassSeatView(activeMatch, seatId, body.requestId),
      absences: presence.projectAll(room.code, now()),
      turnDeadline: turnDeadlinePayload(room.code),
      autoDecision: lastAutoDecisionPayload(room.code),
    });
  });

  // 续局三端点（语义与 coup 一致）。
  app.post<{ Params: { code: string } }>("/api/brass/rooms/:code/rematch", async (request, reply) => {
    const host = requireHostSeat(request, reply, request.params.code);
    if (!host) return;
    const result = registry.enterRematch(host.room.code);
    if (!result.ok) return reply.code(409).send({ error: result.reason });
    persistActiveRoom();
    return reply.send({ phase: result.room.phase, seats: publicSeats(result.room) });
  });

  app.post<{ Params: { code: string; seatId: string } }>("/api/brass/rooms/:code/rematch/join", async (request, reply) => {
    if (!deps.requireSession(request, reply)) return;
    const room = registry.getByCode(request.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    const cookies = parseCookies(typeof request.headers.cookie === "string" ? request.headers.cookie : undefined);
    const seatToken = cookies[SEAT_COOKIE];
    const holder = seatToken ? registry.findSeatByCredential(room.code, hashToken(seatToken)) : null;
    if (!holder || holder.seatId !== request.params.seatId) {
      return reply.code(403).send({ error: "seat_credential_mismatch" });
    }
    const issued = issueSeatToken();
    const result = registry.confirmRematchSeat(room.code, request.params.seatId);
    if (!result.ok) return reply.code(409).send({ error: result.reason });
    const rotated = registry.rotateSeatCredential(room.code, request.params.seatId, issued.hash);
    if (!rotated.ok) return reply.code(409).send({ error: rotated.reason });
    persistActiveRoom();
    deps.appendSetCookie(reply, serializeCookie(SEAT_COOKIE, issued.token));
    return reply.send({ seats: publicSeats(result.room) });
  });

  app.post<{ Params: { code: string; seatId: string } }>("/api/brass/rooms/:code/rematch/leave", async (request, reply) => {
    const host = requireHostSeat(request, reply, request.params.code);
    if (!host) return;
    const result = registry.declineRematchSeat(host.room.code, request.params.seatId);
    if (!result.ok) return reply.code(result.reason === "room_not_found" || result.reason === "seat_not_found" ? 404 : 409).send({ error: result.reason });
    persistActiveRoom();
    return reply.send({ seats: publicSeats(result.room) });
  });

  return {
    registry,
    store,
    dissolve: (code: string) => dissolveRoom(code),
  };
}
