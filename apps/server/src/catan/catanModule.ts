import { randomUUID } from "node:crypto";
import type { CatanGame, GameEvent } from "@coup/catan-domain";
import type {
  GameMatchStore,
  GameModule,
  GameSeatFact,
} from "../platform/gameModule.js";
import { publicSeats, type RoomRecord, type RoomRegistry } from "../roomRegistry.js";
import { effectiveLobbySeats } from "../lobbyStart.js";
import {
  activeDecidingPlayerOf,
  newCatanMatchId,
  planCatanAuto,
  planCatanBot,
  playerToSeatId,
  startCatanMatch,
  submitCatanDecision,
  toCatanSeatView,
  toCatanSpectatorView,
  type ActiveCatanMatch,
  type CatanSubmitPayload,
} from "./catanRuntime.js";
import type { CatanStore } from "./catanStore.js";

/**
 * Catan 游戏模块（ADR-0010）：把 @coup/catan-domain + catanRuntime + catanStore
 * 适配到平台栈的 GameModule 接口。规则之外的一切（房间、心跳、计时、续局、
 * 恢复、AI 座位驱动）都由 platform/gameRoomStack 提供。
 */

export function catanGameStore(store: CatanStore): GameMatchStore<CatanGame> {
  return {
    createRun: (input) =>
      store.createRun({
        ...input,
        events: input.events as Parameters<CatanStore["createRun"]>[0]["events"],
      }),
    commitCommand: (matchId, state, newEvents) =>
      store.commitCommand(matchId, state, newEvents as Parameters<CatanStore["commitCommand"]>[2]),
    getRun: (matchId) => store.getRun(matchId),
    technicalAbort: (matchId, reason) => {
      store.technicalAbort(matchId, reason);
    },
    userAbort: (matchId) => {
      store.userAbort(matchId);
    },
  };
}

export const catanModule: GameModule<ActiveCatanMatch> = {
  id: "catan",
  apiPrefix: "catan",
  seatCount: 4,
  maxRooms: 10,
  createRequiresLanHost: false,
  // 公网部署：未知房号查询按 IP 限速，防止 4 位房号被快速穷举（与 coup 一致）。
  throttleRoomLookup: true,
  recoveryListKey: "items",

  newMatchId: newCatanMatchId,

  startMatch({ matchId, roomCode, seats, store }) {
    return startCatanMatch({
      matchId,
      seed: `catan-${randomUUID()}`,
      seats,
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
        onCommitted(match) {
          store.commitCommand(match.state.matchId, match.state, []);
        },
      },
      roomCode,
    });
  },

  matchFromRun(run) {
    return {
      state: run.state,
      events: run.events as ActiveCatanMatch["events"],
      humanSeatId: run.humanSeatId,
      displayNames: run.displayNames,
    };
  },

  seatFacts(state): GameSeatFact[] {
    // 1 号=房主（本地）；机器人座位（isHuman=false）=other；其余=远程客人。
    return state.players.map((player) => ({
      seatId: playerToSeatId(player.id),
      controller: player.id === 0 ? "local_human" : player.isHuman ? "remote_human" : "other",
      eliminated: false,
    }));
  },

  activeDecidingSeatId(state) {
    const player = activeDecidingPlayerOf(state);
    return player === null ? null : playerToSeatId(player);
  },

  planAutoDecision(state, seatId) {
    return planCatanAuto(state, seatId);
  },

  planBotDecision(state, seatId) {
    return planCatanBot(state, seatId);
  },

  submitDecision(match, payload, options) {
    if (!payload || typeof payload !== "object") {
      return { ok: false, reason: "invalid_command" };
    }
    // 校验失败返回 ok:false；持久化故障抛错，由平台栈折算成
    // technical_abort + 502。store 逐命令提交（见 brass 模块的回归教训）。
    return submitCatanDecision(match, payload as CatanSubmitPayload, {
      persistence: {
        // 注意：不能以「无新事件」跳过落库——婉拒交易/结束挪强盗等命令
        // 状态有变但不产生事件（stateVersion 已递增），漏提交会让重启回滚。
        onCommitted(next) {
          options.store.commitCommand(next.state.matchId, next.state, []);
        },
        onCreated() {},
      },
      actingSeatId: options.actingSeatId,
    });
  },

  seatView(match, seatId, requestId) {
    return { view: toCatanSeatView(match, seatId, requestId) };
  },

  spectatorView(match) {
    return { view: toCatanSpectatorView(match) };
  },

  beforeStart(room: RoomRecord, registry: RoomRegistry) {
    // 大厅开局：剩余空位自动关闭（catan 2-4 人即可开局）。
    if (room.phase === "lobby" && effectiveLobbySeats(room).length >= 2) {
      for (const seat of room.seats) {
        if (seat.kind === "open") {
          registry.configureSeat(room.code, seat.seatId, { kind: "closed" });
        }
      }
    }
    // 对局座位号必须与玩家序号一一对应（前端以 seatId = 玩家序号+1 渲染），
    // 非连续占座会错位绑定，直接拒绝开局。
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
      game: "catan" as const,
      seats: publicSeats(room),
      turnTimeLimitSec: room.turnTimeLimitSec,
      joinUrl: lanHost ? `http://${lanHost}:${host.port}/catan/join?code=${room.code}` : null,
      lanOrigin: lanHost ? `http://${lanHost}:${host.port}` : null,
      bindMode: host.bindMode,
      error: lanHost ? null : ("no_lan_ipv4" as const),
    };
  },
};
