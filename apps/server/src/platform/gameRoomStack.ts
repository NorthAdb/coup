/**
 * 平台层通用房间/对局栈（ADR-0010）。
 *
 * 把 coup（createApp 内联路由）与 brass（brassRoutes 平行栈）收敛为一个
 * 按 GameModule 参数化的工厂：同一套路由、回合计时、空房回收、重启恢复、
 * 续局与增量轮询语义，两款游戏共用一份实现与同一批集成测试。
 * 游戏差异全部收敛在 GameModule 的钩子里（见 platform/gameModule.ts）。
 */

import type { FastifyInstance } from "fastify";
import {
  evaluateLobbyStartGates,
  effectiveLobbySeats,
} from "../lobbyStart.js";
import {
  createRoomRegistry,
  normalizeTurnTimeLimit,
  publicSeats,
  type RoomRecord,
  type RoomRegistry,
} from "../roomRegistry.js";
import { claimRoomCode, allClaimedCodes } from "../roomCodePool.js";
import {
  IDLE_ROOM_RECLAIM_MS,
  IDLE_ROOM_SWEEP_MS,
} from "../roomLifecycle.js";
import {
  SEAT_COOKIE,
  SEAT_COOKIE_MAX_AGE_SEC,
  hashToken,
  issueSeatToken,
  parseCookies,
  serializeCookie,
  type SessionRecord,
} from "../sessionAuth.js";
import {
  createSeatPresenceTracker,
  type SeatPresenceTracker,
} from "../seatPresenceTracker.js";
import type {
  GameHostContext,
  GameMatchStore,
  GameModule,
  GameRoomPersistence,
  GameSeatFact,
  GameViewPayload,
  StackMatch,
  StackMatchState,
} from "./gameModule.js";

type LikeRequest = { headers: Record<string, unknown>; ip?: string };
type LikeReply = {
  code: (status: number) => { send: (body: unknown) => unknown };
};

export type GameStackDeps<M extends StackMatch<any>> = {
  module: GameModule<M>;
  store: GameMatchStore<M["state"]>;
  roomPersistence: GameRoomPersistence;
  requireSession: (request: LikeRequest, reply: LikeReply) => SessionRecord | null;
  appendSetCookie: (
    reply: { getHeader: (name: string) => unknown; header: (name: string, value: string | string[]) => unknown },
    value: string,
  ) => void;
  /** 主机模式与局域网主机信息；null 表示宿主未配置 hosting（建房回 500）。 */
  getHostContext: () => GameHostContext | null;
  hostingAvailable: boolean;
  now: () => number;
  presence?: SeatPresenceTracker;
  /** 测试注入口：复用调用方预建的房间注册表（仅 coup 场景使用）。 */
  registry?: RoomRegistry;
  /** 测试注入口：机器人决策延迟（默认 900–2200ms 随机，模拟思考）。 */
  botDecisionDelayMs?: () => number;
};

export type GameStackRuntime = {
  moduleId: string;
  dissolve: (code: string) => void;
};

/**
 * 本地座位（房主浏览器）超过该时长未被看见（GET matches/current），
 * 且全部远程座位均已离席时，对局房间视为空房可回收。
 * 没有它，房主关闭浏览器后的对局房间会永远占据房间上限。
 */
export const LOCAL_SEAT_GONE_MS = 10 * 60_000;

/** 机器人决策延迟：0.9–2.2 秒随机，模拟思考节奏。 */
function defaultBotDelay(): number {
  return 900 + Math.floor(Math.random() * 1300);
}

export function abortReasonFrom(error: unknown): string {
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

export function createGameRoomStack<M extends StackMatch<any>>(
  app: FastifyInstance,
  deps: GameStackDeps<M>,
): GameStackRuntime {
  const module = deps.module;
  const store = deps.store;
  const registry: RoomRegistry =
    deps.registry ??
    createRoomRegistry({
      seatCount: module.seatCount,
      takenExtra: allClaimedCodes,
      onCodeAllocated: claimRoomCode,
    });
  const presence = deps.presence ?? createSeatPresenceTracker();
  const now = deps.now;
  const matchesByRoom = new Map<string, M>();
  const roomActivity = new Map<string, { lastActivityAt: number; emptySince: number | null }>();
  // 房主浏览器在场标记：对局内以本地人凭证 GET/POST matches/current 时刷新。
  const lastLocalSeen = new Map<string, number>();
  const lastAutoDecisions = new Map<string, { seatId: string; at: number; kind: string; matchId: string }>();
  const recovery = new Map<string, {
    code: string;
    status: "none" | "restored" | "failed";
    reason: string | null;
    room: RoomRecord | null;
  }>();
  const roomCodeThrottle = createRoomCodeThrottle();

  type TurnTimerState = {
    timeoutId: ReturnType<typeof setTimeout> | null;
    seatId: string | null;
    deadlineAt: number | null;
    durationMs: number;
    armedForVersion: number;
  };
  const turnTimers = new Map<string, TurnTimerState>();

  /*
   * 机器人座位（AI 队友）驱动：欠决策座位为 bot 时延迟 ~1–2 秒提交决策，
   * 与人类决策走同一条 submitDecision 通路（持久化/事件完全一致）。
   * 每次成功后按新状态续链（bot 连续行动）；失败则交给回合计时器兜底。
   */
  const botTimers = new Map<string, { timeoutId: ReturnType<typeof setTimeout>; stateVersion: number }>();
  const botDelay = deps.botDecisionDelayMs ?? defaultBotDelay;

  function clearBotTimer(code: string) {
    const timer = botTimers.get(code);
    if (timer) clearTimeout(timer.timeoutId);
    botTimers.delete(code);
  }

  function scheduleBotDecision(code: string) {
    clearBotTimer(code);
    if (!module.planBotDecision) return;
    const match = matchesByRoom.get(code);
    if (!match || match.state.status !== "in_progress") return;
    const deciding = module.activeDecidingSeatId(match.state);
    if (!deciding) return;
    const fact = seatFactsOf(match).find((entry) => entry.seatId === deciding);
    // 仅 bot 座位（投影为 controller "other"）由机器人驱动；人类超时走 turnTimer。
    if (!fact || fact.controller !== "other") return;
    const stateVersion = match.state.stateVersion;
    const timeoutId = setTimeout(() => {
      void fireBotDecision(code, stateVersion);
    }, botDelay());
    (timeoutId as { unref?: () => void }).unref?.();
    botTimers.set(code, { timeoutId, stateVersion });
  }

  async function fireBotDecision(code: string, armedForVersion: number) {
    botTimers.delete(code);
    const match = matchesByRoom.get(code);
    if (!match || match.state.status !== "in_progress") return;
    if (match.state.stateVersion !== armedForVersion) return;
    const seatId = module.activeDecidingSeatId(match.state);
    if (!seatId) return;
    const fact = seatFactsOf(match).find((entry) => entry.seatId === seatId);
    if (!fact || fact.controller !== "other") return;

    let plan = module.planBotDecision?.(match.state, seatId) ?? null;
    if (!plan) {
      // bot 规划器没有覆盖到（如缺额拆板等特殊阶段）→ 用超时代打计划兜底。
      plan = module.planAutoDecision(match.state, seatId);
    }
    if (!plan) return;

    let advanced = false;
    try {
      const result = await module.submitDecision(match, plan.payload, { store, actingSeatId: seatId });
      if (result.ok) {
        matchesByRoom.set(code, result.match);
        lastAutoDecisions.set(code, {
          seatId,
          at: now(),
          kind: plan.kind,
          matchId: result.match.state.matchId,
        });
        advanced = true;
      }
    } catch {
      // 持久化失败等：与超时代打同语义，静默放弃本次决策。
    }
    armTurnTimer(code);
    if (advanced) scheduleBotDecision(code);
  }

  const roomsBase = module.apiPrefix
    ? `/api/${module.apiPrefix}/rooms`
    : "/api/rooms";
  const recoveryBase = module.apiPrefix
    ? `/api/${module.apiPrefix}/room-recovery`
    : "/api/room-recovery";
  const activityUrlPattern = new RegExp(
    `^/api(?:/${module.apiPrefix})?/rooms/([0-9]{4})(?:/|$)`,
  );

  function seatFactsOf(match: M): GameSeatFact[] {
    return module.seatFacts(match.state);
  }

  function tickPresence(code?: string) {
    const codes = code ? [code] : registry.listCodes();
    for (const roomCode of codes) {
      const match = matchesByRoom.get(roomCode);
      if (match) {
        for (const fact of seatFactsOf(match)) {
          if (fact.controller !== "remote_human") {
            presence.clearSeat(roomCode, fact.seatId);
          }
        }
      }
      presence.tick(roomCode, now());
    }
  }

  function isRoomEmpty(room: RoomRecord, match: M | null): boolean {
    // 大厅/续局等待阶段没有心跳租约可依据：一律按「可回收」处理，
    // 靠活跃度（任意 GET/POST 刷新 emptySince）维持存活——页面有人轮询就不回收，
    // 所有人离开后 30 分钟清扫掉，避免「客人占座后失联」的房间永久占坑。
    if (room.phase !== "match") {
      return true;
    }
    if (!match) {
      // 对局阶段但内存中已无进行中的对局（如技术性中止后等待重开）：
      // 与大厅同语义，靠活跃度维持存活，避免僵尸壳房间永久占坑。
      return true;
    }
    let localSeatSeen = false;
    for (const fact of seatFactsOf(match)) {
      if (fact.controller === "local_human") {
        // 房主浏览器仍在对局页轮询 → 房间不空；超过宽限未见 → 视同离开。
        const seenAt = lastLocalSeen.get(room.code);
        if (seenAt !== undefined && now() - seenAt < LOCAL_SEAT_GONE_MS) {
          localSeatSeen = true;
        }
        continue;
      }
      if (fact.controller !== "remote_human") continue;
      if (fact.eliminated) continue;
      const current = presence.get(room.code, fact.seatId);
      if (!current || (current.phase !== "absent" && current.phase !== "timed_out")) {
        return false;
      }
    }
    return !localSeatSeen;
  }

  function markRoomActive(code: string) {
    const room = registry.getByCode(code);
    const current = now();
    roomActivity.set(code, {
      lastActivityAt: current,
      emptySince: room && isRoomEmpty(room, matchesByRoom.get(code) ?? null) ? current : null,
    });
  }

  function persistActiveRoom() {
    for (const code of registry.listCodes()) {
      const room = registry.getByCode(code);
      if (room) deps.roomPersistence.saveRoom(room);
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

  /*
   * 回合计时器（ADR-0008）：权威侧为「当前欠决策的座位」武装 setTimeout，
   * 到期未决策则由服务器以其名义提交自动决策。缺席暂停时顺延重排。
   */
  function armTurnTimer(code: string) {
    clearTurnTimer(code);
    const match = matchesByRoom.get(code);
    if (!match || match.state.status !== "in_progress") return;
    const durationMs = turnTimeLimitMs(code);
    if (durationMs <= 0) return;
    const deciding = module.activeDecidingSeatId(match.state);
    if (!deciding) return;
    // 缺席暂停中的座位不倒计时；等回席或处置后再武装。
    if (presence.blocksAdvancement(code, deciding, true)) return;

    const deadlineAt = now() + durationMs;
    const armedForVersion = match.state.stateVersion;
    const timeoutId = setTimeout(() => {
      void fireTurnTimeout(code, armedForVersion);
    }, durationMs + 40);
    // 不阻止进程退出
    (timeoutId as { unref?: () => void }).unref?.();
    turnTimers.set(code, { timeoutId, seatId: deciding, deadlineAt, durationMs, armedForVersion });
  }

  /**
   * 仅当房间当前没有武装计时器时补武装。用于回席/心跳等「状态恢复」路径：
   * 欠决策座位离席会把计时器拆除，回席后必须重新倒计时，
   * 否则该回合失去超时代打保护（回席者可以无限期思考）。
   * 不能无条件调用 armTurnTimer——那会以 now() 重置 deadline，等于无限顺延。
   */
  function ensureTurnTimer(code: string) {
    if (turnTimers.has(code)) return;
    armTurnTimer(code);
  }

  async function fireTurnTimeout(code: string, armedForVersion: number) {
    const match = matchesByRoom.get(code);
    if (!match || match.state.stateVersion !== armedForVersion) {
      turnTimers.delete(code);
      return;
    }
    const timer = turnTimers.get(code);
    const seatId = timer?.seatId;
    clearTurnTimer(code);
    if (!match || match.state.status !== "in_progress" || !seatId) return;

    // 缺席暂停：顺延一轮再武装（对局此刻不应推进）。
    if (presence.blocksAdvancement(code, seatId, true)) {
      armTurnTimer(code);
      return;
    }

    const plan = module.planAutoDecision(match.state, seatId);
    if (!plan) {
      armTurnTimer(code);
      return;
    }

    try {
      const result = await module.submitDecision(match, plan.payload, { store, actingSeatId: seatId });
      if (result.ok) {
        matchesByRoom.set(code, result.match);
        lastAutoDecisions.set(code, {
          seatId,
          at: now(),
          kind: plan.kind,
          matchId: result.match.state.matchId,
        });
      }
    } catch {
      // 持久化失败等：交由下次决策路径的 technicalAbort 语义处理。
    }
    armTurnTimer(code);
    scheduleBotDecision(code);
  }

  function resolveMatchSeatId(request: LikeRequest, code: string, match: M): string | null {
    const room = registry.getByCode(code);
    if (!room) return null;
    const cookies = parseCookies(typeof request.headers.cookie === "string" ? request.headers.cookie : undefined);
    const seatToken = cookies[SEAT_COOKIE];
    if (!seatToken) return null;
    const holder = registry.findSeatByCredential(room.code, hashToken(seatToken));
    if (!holder) return null;
    const fact = seatFactsOf(match).find((entry) => entry.seatId === holder.seatId);
    if (!fact || (fact.controller !== "local_human" && fact.controller !== "remote_human")) {
      return null;
    }
    return holder.seatId;
  }

  function dissolveRoom(code: string, matchId?: string | null, abortReason = "room_idle_reclaimed") {
    const activeMatchId = matchId ?? matchesByRoom.get(code)?.state.matchId;
    if (activeMatchId) {
      const run = store.getRun(activeMatchId);
      // 仅中止本房间的对局；损坏恢复条目可能指向别的房间的 run，不能误伤。
      if (run && run.runStatus === "in_progress" && run.roomCode === code) {
        store.technicalAbort(activeMatchId, abortReason);
      }
    }
    clearTurnTimer(code);
    clearBotTimer(code);
    lastAutoDecisions.delete(code);
    lastLocalSeen.delete(code);
    registry.dissolve(code);
    deps.roomPersistence.clearRoom(code);
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
      const empty = isRoomEmpty(room, matchesByRoom.get(code) ?? null);
      if (!empty) {
        activity.emptySince = null;
      } else if (activity.emptySince === null) {
        // 空置时长从「首次观察到空房」起算，而不是最后活动时间：
        // 这样「房主仍在轮询（活动已停但人在）」与「确实全员离开」可以区分。
        activity.emptySince = current;
      }
      if (empty && activity.emptySince !== null && current - activity.emptySince >= IDLE_ROOM_RECLAIM_MS) {
        dissolveRoom(code);
        continue;
      }
      roomActivity.set(code, activity);
    }
  }

  function requireHostSeat(request: LikeRequest, reply: LikeReply, code: string) {
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

  function revokeAllRemoteCredentials(code: string) {
    const room = registry.getByCode(code);
    if (!room) return;
    for (const seat of room.seats) {
      if (seat.kind === "remote_human") {
        registry.revokeSeatCredential(code, seat.seatId);
      }
    }
    persistActiveRoom();
  }

  function sharedTail(code: string) {
    const match = matchesByRoom.get(code);
    const deciding = match ? module.activeDecidingSeatId(match.state) : null;
    const blockedByAbsence = deciding !== null && presence.blocksAdvancement(code, deciding, true);
    return {
      absences: presence.projectAll(code, now()),
      pausedForAbsenceSeatId: blockedByAbsence ? deciding : null,
      turnDeadline: turnDeadlinePayload(code),
      autoDecision: lastAutoDecisionPayload(code),
    };
  }

  // ------------------------------------------------------------------
  // 启动恢复：房间表 + 对局 run 表，逐房恢复（大厅/续局等待/进行中对局）。
  // ------------------------------------------------------------------
  {
    const loaded = deps.roomPersistence.loadRooms();
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
          recovery.set(room.code, { code: room.code, status: "failed", reason: "match_missing", room });
          continue;
        }
        const run = store.getRun(room.matchId);
        if (!run || run.roomCode !== room.code || run.runStatus !== "in_progress") {
          // 区分三种失败：缺 run / 房间不匹配 / run 已结束（常见于上次进程
          // 未干净收尾的僵尸房，用户可放弃重建）。
          const reason = !run
            ? "match_not_active"
            : run.roomCode !== room.code
              ? "match_room_mismatch"
              : "match_not_active";
          recovery.set(room.code, { code: room.code, status: "failed", reason, room });
          continue;
        }
        registry.restore(room);
        const match = module.matchFromRun(run);
        matchesByRoom.set(room.code, match);
        markRoomActive(room.code);
        recovery.set(room.code, { code: room.code, status: "restored", reason: null, room });
        // 恢复宽限 + 重排计时。
        presence.clearRoom(room.code);
        const remoteSeatIds = seatFactsOf(match)
          .filter((fact) => fact.controller === "remote_human" && !fact.eliminated)
          .map((fact) => fact.seatId);
        presence.grantRecoveryGrace(remoteSeatIds, room.code, now());
        armTurnTimer(room.code);
        scheduleBotDecision(room.code);
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
        registry.restore(room);
        markRoomActive(room.code);
        recovery.set(room.code, { code: room.code, status: "restored", reason: null, room });
      }
    }
  }

  // 空房兜底清扫：不再依赖「下次建房时」才触发回收。
  const idleSweepTimer = setInterval(() => {
    reclaimIdleRooms();
  }, IDLE_ROOM_SWEEP_MS);
  (idleSweepTimer as { unref?: () => void }).unref?.();

  app.addHook("onClose", async () => {
    for (const code of [...turnTimers.keys()]) clearTurnTimer(code);
    for (const code of [...botTimers.keys()]) clearBotTimer(code);
  });

  app.addHook("onResponse", async (request, reply) => {
    if (reply.statusCode < 200 || reply.statusCode >= 300) return;
    if (request.method !== "POST" && request.method !== "PATCH") return;
    const match = request.url.match(activityUrlPattern);
    if (match && registry.getByCode(match[1]!)) markRoomActive(match[1]!);
  });

  // ------------------------------------------------------------------
  // 路由
  // ------------------------------------------------------------------

  app.get(recoveryBase, async (request, reply) => {
    // 恢复清单枚举所有存续房号（含座位与阶段），不能匿名获取——
    // 否则等于绕过房号限速门禁（ADR-0007）直接广播全部房号。
    if (!deps.requireSession(request, reply)) return;
    const items = [...recovery.values()].map((item) => ({
      code: item.code,
      status: item.status,
      reason: item.reason,
      game: module.id,
      phase: item.room?.phase ?? null,
      matchId: item.room?.matchId ?? null,
      seats: item.room ? publicSeats(item.room) : [],
    }));
    return reply.send(module.recoveryListKey === "items" ? { items } : { rooms: items });
  });

  app.post<{ Body: { roomCode?: string } }>(`${recoveryBase}/abandon`, async (request, reply) => {
    if (!deps.requireSession(request, reply)) return;
    const roomCode = request.body?.roomCode;
    if (typeof roomCode !== "string" || !roomCode) {
      return reply.code(400).send({ error: "room_code_required" });
    }
    const item = recovery.get(roomCode);
    if (!item) return reply.code(404).send({ error: "recovery_room_not_found" });
    if (item.status === "restored") {
      // 活房间不接受「放弃」：任何持会话者都不能凭 4 位房号终止他人对局
      // （ABANDON 曾是无门禁的杀局通道）。活房交给空房回收或对局内处置。
      return reply.code(409).send({ error: "restored_room_active" });
    }
    dissolveRoom(roomCode, item.room?.matchId, "host_restart_abandoned");
    recovery.delete(roomCode);
    return reply.send({ status: "none", abandoned: true, roomCode });
  });

  app.post(roomsBase, async (request, reply) => {
    if (!deps.requireSession(request, reply)) return;
    if (!deps.hostingAvailable) {
      return reply.code(500).send({ error: "hosting_unavailable" });
    }
    reclaimIdleRooms();
    if (registry.listCodes().length >= module.maxRooms) {
      return reply.code(503).send({ error: "room_capacity_reached", message: "房间已满，稍后再试" });
    }
    const host = deps.getHostContext();
    if (!host || host.bindMode !== "host") {
      return reply.code(409).send({ error: "need_host_mode" });
    }
    if (module.createRequiresLanHost && !host.lanHost) {
      return reply.code(400).send({ error: "no_lan_ipv4" });
    }

    const room = registry.create();
    markRoomActive(room.code);
    const hostSeat = room.seats[0];
    const issued = issueSeatToken();
    if (hostSeat) hostSeat.credentialHash = issued.hash;
    persistActiveRoom();
    deps.appendSetCookie(
      reply,
      serializeCookie(SEAT_COOKIE, issued.token, { maxAgeSec: SEAT_COOKIE_MAX_AGE_SEC }),
    );
    return reply.send(module.invitePayload(room, host));
  });

  app.post<{ Params: { code: string; seatId: string }; Body: { displayName?: string } }>(
    `${roomsBase}/:code/seats/:seatId/claim`,
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
      deps.appendSetCookie(
      reply,
      serializeCookie(SEAT_COOKIE, issued.token, { maxAgeSec: SEAT_COOKIE_MAX_AGE_SEC }),
    );
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

  // 客人主动让座：仅大厅阶段、仅远程座位（凭证即身份，无需 seatId 段）。
  // 对局中离开走「离席/房主处置」，不在此端点语义内。
  app.post<{ Params: { code: string } }>(
    `${roomsBase}/:code/seats/leave`,
    async (request, reply) => {
      if (!deps.requireSession(request, reply)) return;
      const room = registry.getByCode(request.params.code);
      if (!room) return reply.code(404).send({ error: "room_not_found" });
      const cookies = parseCookies(typeof request.headers.cookie === "string" ? request.headers.cookie : undefined);
      const seatToken = cookies[SEAT_COOKIE];
      const holder = seatToken ? registry.findSeatByCredential(room.code, hashToken(seatToken)) : null;
      if (!holder || holder.kind !== "remote_human") {
        return reply.code(403).send({ error: "seat_credential_required" });
      }
      if (room.phase !== "lobby") {
        return reply.code(409).send({ error: "room_not_lobby" });
      }
      const released = registry.releaseSeat(room.code, holder.seatId);
      if (!released.ok) {
        return reply.code(409).send({ error: released.reason });
      }
      presence.clearSeat(room.code, holder.seatId);
      persistActiveRoom();
      return reply.send({
        released: true,
        seatId: holder.seatId,
        seats: publicSeats(released.room),
      });
    },
  );

  app.patch<{ Params: { code: string; seatId: string }; Body: { displayName?: string } }>(
    `${roomsBase}/:code/seats/:seatId`,
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
        return reply
          .code(result.reason === "room_not_found" || result.reason === "seat_not_found" ? 404 : 409)
          .send({ error: result.reason });
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
    `${roomsBase}/:code/seats/:seatId/config`,
    async (request, reply) => {
      if (!deps.requireSession(request, reply)) return;
      const room = registry.getByCode(request.params.code);
      if (!room) return reply.code(404).send({ error: "room_not_found" });
      const cookies = parseCookies(typeof request.headers.cookie === "string" ? request.headers.cookie : undefined);
      const seatToken = cookies[SEAT_COOKIE];
      const holder = seatToken ? registry.findSeatByCredential(room.code, hashToken(seatToken)) : null;
      if (!holder || holder.kind !== "local_human" || holder.seatId !== "1") {
        return reply.code(403).send({ error: "host_seat_required" });
      }
      const kind = request.body?.kind;
      if (kind !== "open" && kind !== "closed" && kind !== "bot") {
        return reply.code(400).send({ error: "invalid_seat_kind" });
      }
      const result = registry.configureSeat(room.code, request.params.seatId, {
        kind: kind === "open" ? "open" : kind === "bot" ? "bot" : "closed",
      });
      if (!result.ok) {
        if (result.reason === "room_not_found" || result.reason === "seat_not_found") {
          return reply.code(404).send({ error: result.reason });
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
    },
  );

  // 房间设置：仅房主、仅大厅/续局阶段（ADR-0008）。
  app.patch<{ Params: { code: string }; Body: { turnTimeLimitSec?: number } }>(
    `${roomsBase}/:code/settings`,
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
        if (result.reason === "room_not_found") return reply.code(404).send({ error: "room_not_found" });
        if (result.reason === "room_locked") return reply.code(409).send({ error: "room_locked" });
        return reply.code(400).send({ error: "invalid_setting" });
      }
      persistActiveRoom();
      return reply.send({
        turnTimeLimitSec: result.room.turnTimeLimitSec,
        seats: publicSeats(result.room),
      });
    },
  );

  app.post<{ Params: { code: string } }>(`${roomsBase}/:code/start`, async (request, reply) => {
    if (!deps.requireSession(request, reply)) return;
    const room = registry.getByCode(request.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    const cookies = parseCookies(typeof request.headers.cookie === "string" ? request.headers.cookie : undefined);
    const seatToken = cookies[SEAT_COOKIE];
    const holder = seatToken ? registry.findSeatByCredential(room.code, hashToken(seatToken)) : null;
    if (!holder || holder.kind !== "local_human" || holder.seatId !== "1") {
      return reply.code(403).send({ error: "host_seat_required" });
    }

    const preStartError = module.beforeStart?.(room, registry) ?? null;
    if (preStartError) return reply.code(400).send({ error: preStartError });

    // 同一房间终局后允许继续对局（重开一局）：仅当当前 run 已结束；
    // 续局等待阶段须全部座位已确认（门禁内校验）。
    const currentRun = room.matchId != null ? store.getRun(room.matchId) : null;
    const rematchAllowed =
      room.phase === "match" && currentRun !== null && currentRun.runStatus !== "in_progress";
    const gates = evaluateLobbyStartGates(room, {
      allowMatchPhase: rematchAllowed,
      allowRematchPhase: room.phase === "rematch",
    });
    if (!gates.ok) return reply.code(400).send({ error: gates.reason });

    const seats = effectiveLobbySeats(room).map((seat) => ({
      seatId: seat.seatId,
      kind:
        seat.kind === "remote_human"
          ? ("remote_human" as const)
          : seat.kind === "bot"
            ? ("bot" as const)
            : ("local_human" as const),
      displayName:
        seat.displayName ??
        (seat.kind === "local_human" ? "你" : seat.kind === "bot" ? "机器人" : "客人"),
    }));

    const matchId = module.newMatchId();
    let match: M;
    try {
      match = await module.startMatch({ matchId, roomCode: room.code, seats, store });
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

    const begun = registry.beginMatch(room.code, match.state.matchId);
    if (!begun.ok) {
      store.userAbort(match.state.matchId);
      return reply.code(409).send({ error: begun.reason });
    }
    matchesByRoom.set(room.code, match);
    persistActiveRoom();
    // 追踪远程座位心跳。
    presence.clearRoom(room.code);
    const t = now();
    for (const fact of seatFactsOf(match)) {
      if (fact.controller === "remote_human" && !fact.eliminated) {
        presence.trackSeat(room.code, fact.seatId);
        presence.noteHeartbeat(room.code, fact.seatId, t);
      }
    }
    lastAutoDecisions.delete(room.code);
    armTurnTimer(room.code);
    scheduleBotDecision(room.code);

    return reply.send({
      ...module.seatView(match, "1"),
      phase: begun.room.phase,
      matchId: match.state.matchId,
      absences: presence.projectAll(room.code, now()),
      turnDeadline: turnDeadlinePayload(room.code),
      autoDecision: null,
    });
  });

  app.post<{ Params: { code: string } }>(`${roomsBase}/:code/heartbeat`, async (request, reply) => {
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
    // 心跳若把 reconnecting 座位恢复在场，而计时器此前已被拆除（缺席暂停），
    // 这里补武装；计时器仍在时不动作（不重置 deadline）。
    ensureTurnTimer(room.code);
    return reply.send({ ok: true, absences: presence.projectAll(room.code, now()) });
  });

  app.get<{ Params: { code: string } }>(`${roomsBase}/:code/presence`, async (request, reply) => {
    const room = registry.getByCode(request.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    tickPresence(room.code);
    return reply.send({ absences: presence.projectAll(room.code, now()) });
  });

  app.post<{ Params: { code: string } }>(`${roomsBase}/:code/resume-seat`, async (request, reply) => {
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
    const rotated = registry.rotateSeatCredential(room.code, holder.seatId, issued.hash);
    if (!rotated.ok) return reply.code(409).send({ error: rotated.reason });
    persistActiveRoom();
    deps.appendSetCookie(
      reply,
      serializeCookie(SEAT_COOKIE, issued.token, { maxAgeSec: SEAT_COOKIE_MAX_AGE_SEC }),
    );
    presence.resume(room.code, holder.seatId);
    presence.noteHeartbeat(room.code, holder.seatId, now());
    // 回席后若该座位仍欠决策且计时器已被缺席暂停拆除，重新倒计时。
    ensureTurnTimer(room.code);
    return reply.send({
      resumed: true,
      seat: { seatId: holder.seatId, kind: holder.kind, displayName: holder.displayName },
      absences: presence.projectAll(room.code, now()),
    });
  });

  app.post<{ Params: { code: string; seatId: string }; Body: { action?: string } }>(
    `${roomsBase}/:code/seats/:seatId/disposition`,
    async (request, reply) => {
      const host = requireHostSeat(request, reply, request.params.code);
      if (!host) return;
      const { room } = host;
      const activeMatch = matchesByRoom.get(room.code) ?? null;
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
        revokeAllRemoteCredentials(room.code);
        registry.revokeSeatCredential(room.code, seatId);
        persistActiveRoom();
        presence.clearRoom(room.code);
        clearTurnTimer(room.code);
        clearBotTimer(room.code);
        lastAutoDecisions.delete(room.code);
        matchesByRoom.delete(room.code);
        return reply.send({ action: "technical_abort", aborted: true, matchId });
      }

      if (action === "force_eliminate" && module.hostForceEliminate) {
        const result = module.hostForceEliminate(activeMatch, seatId);
        if (!result.ok) {
          return reply.code(409).send({ error: result.reason });
        }
        const match: M = {
          ...activeMatch,
          state: result.state,
          events: [...activeMatch.events, ...result.events],
        };
        matchesByRoom.set(room.code, match);
        store.commitCommand(match.state.matchId, match.state, result.events);
        registry.revokeSeatCredential(room.code, seatId);
        persistActiveRoom();
        presence.clearSeat(room.code, seatId);
        armTurnTimer(room.code);
        scheduleBotDecision(room.code);
        return reply.send({
          action: "force_eliminate",
          ...module.seatView(match, "1"),
          absences: presence.projectAll(room.code, now()),
          turnDeadline: turnDeadlinePayload(room.code),
          autoDecision: lastAutoDecisionPayload(room.code),
        });
      }

      if (action === "force_eliminate") {
        // 该游戏无淘汰语义（如 brass）。
        return reply.code(400).send({ error: "disposition_not_supported" });
      }

      return reply.code(400).send({ error: "invalid_disposition" });
    },
  );

  app.get<{ Params: { code: string } }>(`${roomsBase}/:code/me`, async (request, reply) => {
    const room = registry.getByCode(request.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    const cookies = parseCookies(typeof request.headers.cookie === "string" ? request.headers.cookie : undefined);
    const seatToken = cookies[SEAT_COOKIE];
    const holder = seatToken ? registry.findSeatByCredential(room.code, hashToken(seatToken)) : null;
    return reply.send({
      seat: holder ? { seatId: holder.seatId, kind: holder.kind, displayName: holder.displayName } : null,
      seats: publicSeats(room),
    });
  });

  app.get<{ Params: { code: string } }>(`${roomsBase}/:code`, async (request, reply) => {
    const room = registry.getByCode(request.params.code);
    if (!room) {
      if (module.throttleRoomLookup && request.ip) {
        if (roomCodeThrottle.blocked(request.ip)) {
          return reply.code(429).send({ error: "too_many_attempts" });
        }
        roomCodeThrottle.recordFail(request.ip);
      }
      return reply.code(404).send({ error: "room_not_found" });
    }
    if (module.throttleRoomLookup && request.ip) roomCodeThrottle.clear(request.ip);
    const host = deps.getHostContext();
    markRoomActive(room.code);
    return reply.send(
      module.invitePayload(room, host ?? { bindMode: "local", port: 0, lanHost: null, candidates: [] }),
    );
  });

  app.get<{ Params: { code: string }; Querystring: { since?: string; spectate?: string } }>(
    `${roomsBase}/:code/matches/current`,
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
      // 本地人（房主浏览器）仍在轮询对局 → 刷新在场标记（空房回收依据之一）。
      if (seatId) {
        const fact = seatFactsOf(activeMatch).find((entry) => entry.seatId === seatId);
        if (fact?.controller === "local_human") lastLocalSeen.set(room.code, now());
      }
      tickPresence(room.code);
      const tail = sharedTail(room.code);

      // 增量轮询（ADR-0008）：状态未变时只回轻量载荷。
      const sinceRaw = request.query.since;
      if (sinceRaw != null && sinceRaw !== "") {
        const since = Number(sinceRaw);
        if (Number.isInteger(since) && since === activeMatch.state.stateVersion) {
          return reply.send({ unchanged: true, stateVersion: since, ...tail });
        }
      }

      const payload: GameViewPayload = wantsSpectate
        ? module.spectatorView(activeMatch)
        : module.seatView(activeMatch, seatId ?? "1");
      return reply.send({
        ...payload,
        matchId: activeMatch.state.matchId,
        ...tail,
      });
    },
  );

  app.post<{ Params: { code: string } }>(
    `${roomsBase}/:code/matches/current/decision`,
    async (request, reply) => {
      const room = registry.getByCode(request.params.code);
      if (!room) return reply.code(404).send({ error: "room_not_found" });
      let activeMatch = matchesByRoom.get(room.code) ?? null;
      if (!activeMatch) return reply.code(404).send({ error: "no_active_match" });
      const seatId = resolveMatchSeatId(request, room.code, activeMatch);
      if (!seatId) return reply.code(403).send({ error: "seat_credential_required" });
      // 提交决策本身即在场证明（房主或客人都适用；客人另有心跳租约）。
      {
        const fact = seatFactsOf(activeMatch).find((entry) => entry.seatId === seatId);
        if (fact?.controller === "local_human") lastLocalSeen.set(room.code, now());
      }
      tickPresence(room.code);
      const absence = presence.get(room.code, seatId);
      if (absence && (absence.phase === "absent" || absence.phase === "timed_out")) {
        return reply.code(409).send({ error: "seat_absent", absences: presence.projectAll(room.code, now()) });
      }
      // Decision during grace counts as channel recovery (no credential rotate).
      if (absence?.phase === "reconnecting") {
        presence.noteHeartbeat(room.code, seatId, now());
        presence.resume(room.code, seatId);
      }
      const body = request.body;
      const matchId = activeMatch.state.matchId;
      let result: { ok: true; match: M } | { ok: false; reason: string };
      try {
        result = await module.submitDecision(activeMatch, body, { store, actingSeatId: seatId });
      } catch (error) {
        const run = store.getRun(matchId);
        if (run && run.runStatus === "in_progress") {
          store.technicalAbort(matchId, abortReasonFrom(error));
        }
        clearTurnTimer(room.code);
        matchesByRoom.delete(room.code);
        return reply.code(502).send({ error: abortReasonFrom(error), aborted: true, matchId });
      }
      if (!result.ok) {
        return reply.code(409).send({ error: result.reason });
      }
      activeMatch = result.match;
      matchesByRoom.set(room.code, activeMatch);
      if (activeMatch.state.status === "finished") {
        // 终局凭证保留到续局等待结束（加入→轮换；离开/处置→作废），
        // 让客人刷新后仍能认回原座位。
        presence.clearRoom(room.code);
      }
      armTurnTimer(room.code);
      scheduleBotDecision(room.code);
      return reply.send({
        ...module.seatView(activeMatch, seatId, (body as { requestId?: string } | null)?.requestId),
        absences: presence.projectAll(room.code, now()),
        turnDeadline: turnDeadlinePayload(room.code),
        autoDecision: lastAutoDecisionPayload(room.code),
      });
    },
  );

  // 续局三端点：房主发起 → 客人凭证确认加入（轮换凭证）→ 或离开。
  app.post<{ Params: { code: string } }>(`${roomsBase}/:code/rematch`, async (request, reply) => {
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
    const entered = registry.enterRematch(room.code);
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
  });

  app.post<{ Params: { code: string } }>(`${roomsBase}/:code/rematch/join`, async (request, reply) => {
    if (!deps.requireSession(request, reply)) return;
    const room = registry.getByCode(request.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    if (room.phase !== "rematch") {
      return reply.code(409).send({ error: "room_not_rematch" });
    }
    const cookies = parseCookies(typeof request.headers.cookie === "string" ? request.headers.cookie : undefined);
    const seatToken = cookies[SEAT_COOKIE];
    const holder = seatToken ? registry.findSeatByCredential(room.code, hashToken(seatToken)) : null;
    if (!holder || holder.kind !== "remote_human") {
      return reply.code(403).send({ error: "seat_credential_required" });
    }
    const confirmed = registry.confirmRematchSeat(room.code, holder.seatId);
    if (!confirmed.ok) {
      if (confirmed.reason === "seat_not_awaiting") {
        return reply.code(409).send({ error: "seat_not_awaiting" });
      }
      return reply.code(409).send({ error: confirmed.reason });
    }
    const issued = issueSeatToken();
    const rotated = registry.rotateSeatCredential(room.code, holder.seatId, issued.hash);
    if (!rotated.ok) {
      return reply.code(409).send({ error: rotated.reason });
    }
    persistActiveRoom();
    deps.appendSetCookie(
      reply,
      serializeCookie(SEAT_COOKIE, issued.token, { maxAgeSec: SEAT_COOKIE_MAX_AGE_SEC }),
    );
    return reply.send({
      seat: {
        seatId: rotated.seat.seatId,
        kind: rotated.seat.kind,
        displayName: rotated.seat.displayName,
        rematchStatus: rotated.seat.rematchStatus,
      },
      seats: publicSeats(rotated.room),
    });
  });

  app.post<{ Params: { code: string } }>(`${roomsBase}/:code/rematch/leave`, async (request, reply) => {
    if (!deps.requireSession(request, reply)) return;
    const room = registry.getByCode(request.params.code);
    if (!room) return reply.code(404).send({ error: "room_not_found" });
    if (room.phase !== "rematch") {
      return reply.code(409).send({ error: "room_not_rematch" });
    }
    const cookies = parseCookies(typeof request.headers.cookie === "string" ? request.headers.cookie : undefined);
    const seatToken = cookies[SEAT_COOKIE];
    const holder = seatToken ? registry.findSeatByCredential(room.code, hashToken(seatToken)) : null;
    if (!holder || holder.kind !== "remote_human") {
      return reply.code(403).send({ error: "seat_credential_required" });
    }
    const declined = registry.declineRematchSeat(room.code, holder.seatId);
    if (!declined.ok) {
      return reply.code(409).send({ error: declined.reason });
    }
    persistActiveRoom();
    return reply.send({ seats: publicSeats(declined.room) });
  });

  return {
    moduleId: module.id,
    dissolve: (code: string) => dissolveRoom(code),
  };
}
