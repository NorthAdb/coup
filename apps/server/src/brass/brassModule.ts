import { randomUUID } from "node:crypto";
import type { BrassCommand, BrassState } from "@coup/brass-domain";
import { planAutoDecision as planBrassAutoDecision } from "@coup/brass-domain";
import type {
  GameMatchStore,
  GameModule,
  GameSeatFact,
} from "../platform/gameModule.js";
import { publicSeats, type RoomRecord, type RoomRegistry } from "../roomRegistry.js";
import { effectiveLobbySeats } from "../lobbyStart.js";
import {
  activeDecidingPlayerOf,
  newBrassMatchId,
  planBrassBot,
  playerToSeatId,
  seatIdToPlayer,
  startBrassMatch,
  submitBrassDecision,
  toBrassSeatView,
  toBrassSpectatorView,
  type ActiveBrassMatch,
  type BrassDecisionPayload,
} from "./brassRuntime.js";
import type { BrassStore } from "./brassStore.js";

/**
 * Brass 游戏模块（ADR-0010）：把 @coup/brass-domain + brassRuntime + brassStore
 * 适配到平台栈的 GameModule 接口。原先 900 行的 brassRoutes 平行栈由此收敛。
 */

export function brassGameStore(store: BrassStore): GameMatchStore<BrassState> {
  return {
    createRun: (input) =>
      store.createRun({ ...input, events: input.events as Parameters<BrassStore["createRun"]>[0]["events"] }),
    commitCommand: (matchId, state, newEvents) =>
      store.commitCommand(matchId, state, newEvents as Parameters<BrassStore["commitCommand"]>[2]),
    getRun: (matchId) => store.getRun(matchId),
    technicalAbort: (matchId, reason) => {
      store.technicalAbort(matchId, reason);
    },
    userAbort: (matchId) => {
      store.userAbort(matchId);
    },
  };
}

export const brassModule: GameModule<ActiveBrassMatch> = {
  id: "brass",
  apiPrefix: "brass",
  seatCount: 4,
  maxRooms: 10,
  createRequiresLanHost: false,
  // 公网部署：未知房号查询按 IP 限速，防止 4 位房号被快速穷举（与 coup 一致）。
  throttleRoomLookup: true,
  recoveryListKey: "items",

  newMatchId: newBrassMatchId,

  startMatch({ matchId, roomCode, seats, store }) {
    return startBrassMatch({
      matchId,
      seed: `brass-${randomUUID()}`,
      playerCount: playerCountFor(seats.length),
      displayNames: Object.fromEntries(seats.map((seat) => [seat.seatId, seat.displayName])),
      botPlayers: botPlayersFor(seats),
      persistence: {
        onCreated(match, code) {
          if (!code) throw new Error("room_code_required");
          store.createRun({
            matchId: match.state.matchId,
            roomCode: code,
            humanSeatId: match.humanSeatId,
            displayNames: match.displayNames,
            state: match.state,
            events: match.events,
          });
        },
        onCommitted(match, newEvents) {
          if (newEvents.length === 0) return;
          store.commitCommand(
            match.state.matchId,
            match.state,
            newEvents as Parameters<BrassStore["commitCommand"]>[2],
          );
        },
      },
      roomCode,
    });
  },

  matchFromRun(run) {
    return {
      state: run.state,
      events: run.events as ActiveBrassMatch["events"],
      humanSeatId: run.humanSeatId,
      displayNames: run.displayNames,
    };
  },

  seatFacts(state): GameSeatFact[] {
    // 1 号=房主（本地）；botPlayers 中的座位=服务器机器人；其余=远程客人。
    return Array.from({ length: state.playerCount }, (_, player) => ({
      seatId: playerToSeatId(player),
      controller:
        player === 0
          ? "local_human"
          : (state.botPlayers ?? []).includes(player)
            ? "other"
            : "remote_human",
      eliminated: false,
    }));
  },

  activeDecidingSeatId(state) {
    const player = activeDecidingPlayerOf(state);
    return player === null ? null : playerToSeatId(player);
  },

  planAutoDecision(state, seatId) {
    const player = seatIdToPlayer(seatId);
    if (player === null) return null;
    const command = planBrassAutoDecision(state, player, state.stateVersion);
    if (!command) return null;
    return {
      payload: {
        protocolVersion: 1,
        requestId: `auto-${state.stateVersion}-${seatId}`,
        stateVersion: state.stateVersion,
        command,
      } satisfies BrassDecisionPayload,
      kind: command.type,
    };
  },

  planBotDecision(state, seatId) {
    return planBrassBot(state, seatId);
  },

  submitDecision(match, payload, options) {
    if (!payload || typeof payload !== "object") {
      return { ok: false, reason: "invalid_command" };
    }
    // 校验失败返回 ok:false；持久化故障抛错，由平台栈折算成
    // technical_abort + 502（与 coup 的提交通路语义一致）。
    // 旧 brassRoutes 曾漏传 persistence，导致开局后决策不落库、重启回滚——
    // 平台栈强制把 store 传进来，逐命令提交（brassStore.commitCommand）。
    return submitBrassDecision(match, payload as BrassDecisionPayload, {
      persistence: {
        onCommitted(next, newEvents) {
          if (newEvents.length === 0) return;
          options.store.commitCommand(next.state.matchId, next.state, newEvents);
        },
        onCreated() {},
      },
      actingSeatId: options.actingSeatId,
    });
  },

  seatView(match, seatId, requestId) {
    return { view: toBrassSeatView(match, seatId, requestId) };
  },

  spectatorView(match) {
    return { view: toBrassSpectatorView(match) };
  },

  beforeStart(room: RoomRecord, registry: RoomRegistry) {
    // 大厅开局：剩余空位自动关闭（brass 2-4 人即可开局）。
    if (room.phase === "lobby" && effectiveLobbySeats(room).length >= 2) {
      for (const seat of room.seats) {
        if (seat.kind === "open") {
          registry.configureSeat(room.code, seat.seatId, { kind: "closed" });
        }
      }
    }
    // 对局座位号必须与玩家序号一一对应（前端以 seatId = 玩家序号+1 渲染），
    // 非连续占座（如关闭 2 号后占 3、4 号）会错位绑定，直接拒绝开局。
    const effective = effectiveLobbySeats(room);
    const contiguous = effective.every((seat, index) => seat.seatId === String(index + 1));
    if (!contiguous) return "seats_not_contiguous";
    return null;
  },

  invitePayload(room: RoomRecord, host) {
    const lanHost = host.lanHost;
    return {
      code: room.code,
      phase: room.phase,
      game: "brass" as const,
      seats: publicSeats(room),
      turnTimeLimitSec: room.turnTimeLimitSec,
      joinUrl: lanHost ? `http://${lanHost}:${host.port}/brass/join?code=${room.code}` : null,
      lanOrigin: lanHost ? `http://${lanHost}:${host.port}` : null,
      bindMode: host.bindMode,
      error: lanHost ? null : ("no_lan_ipv4" as const),
    };
  },
};

function playerCountFor(effectiveSeatCount: number): 2 | 3 | 4 {
  return Math.min(4, Math.max(2, effectiveSeatCount)) as 2 | 3 | 4;
}

/** 开局座位里的 bot 座位 → player 下标（brass 座位号 = 序号 + 1）。 */
function botPlayersFor(seats: Array<{ seatId: string; kind: string }>): number[] {
  return seats
    .filter((seat) => seat.kind === "bot")
    .map((seat) => seatIdToPlayer(seat.seatId))
    .filter((player): player is number => player !== null);
}
