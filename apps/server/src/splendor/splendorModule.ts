import { randomUUID } from "node:crypto";
import type { SplendorState } from "@coup/splendor-domain";
import type { GameMatchStore, GameModule, GameSeatFact } from "../platform/gameModule.js";
import { publicSeats, type RoomRecord, type RoomRegistry } from "../roomRegistry.js";
import { effectiveLobbySeats } from "../lobbyStart.js";
import {
  activeDecidingPlayerOf,
  newSplendorMatchId,
  planSplendorAuto,
  playerToSeatId,
  seatIdToPlayer,
  startSplendorMatch,
  submitSplendorDecision,
  toSplendorSeatView,
  toSplendorSpectatorView,
  type ActiveSplendorMatch,
  type SplendorDecisionPayloadLike,
} from "./splendorRuntime.js";
import type { SplendorStore } from "./splendorStore.js";

/**
 * Splendor 游戏模块（ADR-0010）：把 @coup/splendor-domain + splendorRuntime +
 * splendorStore 适配到平台栈的 GameModule 接口。
 */

export function splendorGameStore(store: SplendorStore): GameMatchStore<SplendorState> {
  return {
    createRun: (input) =>
      store.createRun({
        ...input,
        events: input.events as Parameters<SplendorStore["createRun"]>[0]["events"],
      }),
    commitCommand: (matchId, state, newEvents) =>
      store.commitCommand(matchId, state, newEvents as Parameters<SplendorStore["commitCommand"]>[2]),
    getRun: (matchId) => store.getRun(matchId),
    technicalAbort: (matchId, reason) => {
      store.technicalAbort(matchId, reason);
    },
    userAbort: (matchId) => {
      store.userAbort(matchId);
    },
  };
}

export const splendorModule: GameModule<ActiveSplendorMatch> = {
  id: "splendor",
  apiPrefix: "splendor",
  seatCount: 4,
  maxRooms: 10,
  createRequiresLanHost: false,
  // 公网部署：未知房号查询按 IP 限速，防止 4 位房号被快速穷举（与 coup 一致）。
  throttleRoomLookup: true,
  recoveryListKey: "items",

  newMatchId: newSplendorMatchId,

  startMatch({ matchId, roomCode, seats, store }) {
    return startSplendorMatch({
      matchId,
      seed: `splendor-${randomUUID()}`,
      playerCount: playerCountFor(seats.length),
      displayNames: Object.fromEntries(seats.map((seat) => [seat.seatId, seat.displayName])),
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
            newEvents as Parameters<SplendorStore["commitCommand"]>[2],
          );
        },
      },
      roomCode,
    });
  },

  matchFromRun(run) {
    return {
      state: run.state,
      events: run.events as ActiveSplendorMatch["events"],
      humanSeatId: run.humanSeatId,
      displayNames: run.displayNames,
    };
  },

  seatFacts(state): GameSeatFact[] {
    // 网络版 splendor 全部是人类座位：1 号=房主（本地），其余=远程客人。
    return Array.from({ length: state.playerCount }, (_, player) => ({
      seatId: playerToSeatId(player),
      controller: player === 0 ? "local_human" : "remote_human",
      eliminated: false,
    }));
  },

  activeDecidingSeatId(state) {
    const player = activeDecidingPlayerOf(state);
    return player === null ? null : playerToSeatId(player);
  },

  planAutoDecision(state, seatId) {
    return planSplendorAuto(state, seatId);
  },

  submitDecision(match, payload, options) {
    if (!payload || typeof payload !== "object") {
      return { ok: false, reason: "invalid_command" };
    }
    // 校验失败返回 ok:false；持久化故障抛错，由平台栈折算成
    // technical_abort + 502。store 逐命令提交（见 brass 模块的回归教训）。
    return submitSplendorDecision(match, payload as SplendorDecisionPayloadLike, {
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
    return { view: toSplendorSeatView(match, seatId, requestId) };
  },

  spectatorView(match) {
    return { view: toSplendorSpectatorView(match) };
  },

  beforeStart(room: RoomRecord, registry: RoomRegistry) {
    // 大厅开局：剩余空位自动关闭（splendor 2-4 人即可开局）。
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
      game: "splendor" as const,
      seats: publicSeats(room),
      turnTimeLimitSec: room.turnTimeLimitSec,
      joinUrl: lanHost ? `http://${lanHost}:${host.port}/splendor/join?code=${room.code}` : null,
      lanOrigin: lanHost ? `http://${lanHost}:${host.port}` : null,
      bindMode: host.bindMode,
      error: lanHost ? null : ("no_lan_ipv4" as const),
    };
  },
};

function playerCountFor(effectiveSeatCount: number): 2 | 3 | 4 {
  return Math.min(4, Math.max(2, effectiveSeatCount)) as 2 | 3 | 4;
}
