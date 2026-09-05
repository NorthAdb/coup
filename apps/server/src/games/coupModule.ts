import { randomUUID } from "node:crypto";
import type { DomainEvent, MatchState } from "@coup/domain";
import { activeDecidingSeatId, forceEliminateForHostAbsence } from "@coup/domain";
import type { SeatDecision } from "@coup/protocol";
import type {
  GameMatchStore,
  GameModule,
  GameRoomPersistence,
  GameRunRecord,
  GameSeatFact,
} from "../platform/gameModule.js";
import { MAX_ROOMS } from "../roomLifecycle.js";
import { roomInvitePayload, type RoomRecord } from "../roomRegistry.js";
import type { RoomStore } from "../roomStore.js";
import {
  startMatch as startCoupMatch,
  submitAgentDecision,
  submitHumanDecision,
  toSeatView,
  type ActiveMatch,
  type MatchPersistence,
} from "../matchRuntime.js";
import type { MatchStore } from "../matchStore.js";
import { planAutoDecision } from "../autoDecision.js";
import { planCoupBotDecision } from "./coupBot.js";

/**
 * Coup 游戏模块（ADR-0010）：把 @coup/domain + matchRuntime + matchStore
 * 适配到平台栈的 GameModule 接口。规则之外的一切（房间、心跳、计时、续局、
 * 恢复）都由 platform/gameRoomStack 提供。
 */

function matchPersistence(store: GameMatchStore<MatchState>): MatchPersistence {
  return {
    onCreated(match, roomCode) {
      if (!roomCode) throw new Error("room_code_required");
      store.createRun({
        matchId: match.state.matchId,
        roomCode,
        humanSeatId: match.humanSeatId,
        displayNames: match.displayNames,
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

export function coupGameStore(store: MatchStore): GameMatchStore<MatchState> {
  return {
    createRun(input) {
      // 联机版恒无 Agent 座位；seat_agents_json 列为兼容旧库保留。
      store.createRun({ ...input, events: input.events as DomainEvent[], seatAgents: {} });
    },
    commitCommand(matchId, state, newEvents) {
      store.commitCommand(matchId, state, newEvents as DomainEvent[]);
    },
    getRun: (matchId) => store.getRun(matchId),
    technicalAbort: (matchId, reason) => {
      store.technicalAbort(matchId, reason);
    },
    userAbort: (matchId) => {
      store.userAbort(matchId);
    },
  };
}

export function coupRoomPersistence(store: RoomStore): GameRoomPersistence {
  return {
    saveRoom: (room) => store.saveRoom(room),
    clearRoom: (code) => store.clearRoom(code),
    loadRooms: () => {
      const loaded = store.loadRooms();
      return {
        rooms: loaded.rooms,
        failures: loaded.failures.map((failure) => ({
          roomCode: failure.roomCode,
          reason: failure.reason,
        })),
      };
    },
  };
}

export function activeMatchFromRun(
  run: GameRunRecord<MatchState>,
): ActiveMatch {
  return {
    state: run.state,
    events: run.events as DomainEvent[],
    humanSeatId: run.humanSeatId,
    displayNames: run.displayNames,
  };
}

/** 兼容旧引用（matchStore.test 等）；本体的职责已收进 coupModule。 */
export function persistenceForStore(store: MatchStore): MatchPersistence {
  return matchPersistence(coupGameStore(store));
}

export const coupModule: GameModule<ActiveMatch> = {
  id: "coup",
  apiPrefix: "",
  seatCount: 6,
  maxRooms: MAX_ROOMS,
  createRequiresLanHost: true,
  throttleRoomLookup: true,
  recoveryListKey: "rooms",

  newMatchId() {
    return `match-${randomUUID()}`;
  },

  async startMatch({ matchId, roomCode, seats, store }) {
    return startCoupMatch({
      matchId,
      seats: seats.map((seat) => ({
        seatId: seat.seatId,
        controller: seat.kind === "bot" ? "stub_agent" : seat.kind,
        displayName: seat.displayName,
      })),
      persistence: matchPersistence(store),
      roomCode,
    });
  },

  matchFromRun: activeMatchFromRun,

  seatFacts(state): GameSeatFact[] {
    return state.seats.map((seat) => ({
      seatId: seat.seatId,
      controller:
        seat.controller === "local_human" || seat.controller === "remote_human"
          ? seat.controller
          : "other",
      eliminated: seat.eliminated,
    }));
  },

  activeDecidingSeatId: (state) => activeDecidingSeatId(state),

  planAutoDecision(state, seatId) {
    const plan = planAutoDecision(state, seatId);
    if (!plan) return null;
    return {
      payload: {
        protocolVersion: 1,
        requestId: `auto-${state.stateVersion}-${seatId}`,
        stateVersion: state.stateVersion,
        decision: plan.decision,
      } satisfies Partial<SeatDecision>,
      kind: plan.kind,
    };
  },

  planBotDecision(state, seatId) {
    const decision = planCoupBotDecision(state, seatId);
    if (!decision) return null;
    return {
      payload: {
        protocolVersion: 1,
        requestId: `bot-${state.stateVersion}-${seatId}`,
        stateVersion: state.stateVersion,
        decision,
      } satisfies Partial<SeatDecision>,
      kind: decision.type,
    };
  },

  async submitDecision(match, payload, options) {
    // 校验失败返回 ok:false；持久化故障抛错，由平台栈折算成
    // technical_abort + 502（与人类决策同通路）。
    // 机器人座位（stub_agent）走专用通路：HTTP 决策永远只认人类凭证，
    // 这里按 actingSeatId 的 controller 分流。
    const seat = match.state.seats.find(
      (entry) => entry.seatId === options.actingSeatId,
    );
    if (seat?.controller === "stub_agent") {
      return submitAgentDecision(
        match,
        payload as SeatDecision,
        { persistence: matchPersistence(options.store), actingSeatId: options.actingSeatId },
      );
    }
    return submitHumanDecision(match, payload as SeatDecision, {
      persistence: matchPersistence(options.store),
      actingSeatId: options.actingSeatId,
    });
  },

  seatView(match, seatId, requestId) {
    return {
      view: toSeatView(match, seatId, requestId),
      decisionRationales: {},
    };
  },

  spectatorView(match) {
    // 观战：剥离一切私有态与合法决策的只读投影。
    const firstSeatId = match.state.seats[0]?.seatId ?? "1";
    const projection = toSeatView(
      match,
      firstSeatId,
      `spec-${match.state.stateVersion}`,
    );
    return {
      view: {
        ...projection,
        seatId: "spectator",
        privateState: { hiddenCharacters: [], exchangeHand: null },
        legalDecisions: [],
        spectator: true,
      },
    };
  },

  hostForceEliminate(match, seatId) {
    return forceEliminateForHostAbsence(match.state, seatId);
  },

  invitePayload(room: RoomRecord, host) {
    return {
      ...roomInvitePayload({
        room,
        lanHost: host.lanHost,
        port: host.port,
        candidates: host.candidates,
      }),
      bindMode: host.bindMode,
      lanOrigin: host.lanHost ? `http://${host.lanHost}:${host.port}` : null,
    };
  },
};
