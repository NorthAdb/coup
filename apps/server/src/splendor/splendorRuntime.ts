import { randomUUID } from "node:crypto";
import type {
  SplendorCommand,
  SplendorDecisionPayload,
  SplendorEvent,
  SplendorPublicState,
  SplendorState,
} from "@coup/splendor-domain";
import { applyCommand, createMatch, planAutoDecision, projectForSeat } from "@coup/splendor-domain";

/**
 * Splendor 对局运行时：与 coup 的 matchRuntime、brass 的 brassRuntime 同构。
 * 投影使用 splendor-domain 的 projectForSeat（隐藏牌库顺序与他人预留牌）。
 */

export type ActiveSplendorMatch = {
  state: SplendorState;
  events: SplendorEvent[];
  /** 房主座位（seatId '1' → player 0）。 */
  humanSeatId: string;
  displayNames: Record<string, string>;
};

export type SplendorMatchPersistence = {
  onCreated(match: ActiveSplendorMatch, roomCode?: string): void;
  onCommitted(match: ActiveSplendorMatch, newEvents: SplendorEvent[]): void;
};

export const SPLENDOR_PROTOCOL_VERSION = 1;

export function seatIdToPlayer(seatId: string): number | null {
  const n = Number(seatId);
  if (!Number.isInteger(n) || n < 1 || n > 4) return null;
  return n - 1;
}

export function playerToSeatId(player: number): string {
  return String(player + 1);
}

export type SplendorSeatView = {
  protocolVersion: number;
  requestId: string;
  matchId: string;
  stateVersion: number;
  seatId: string;
  game: "splendor";
  spectator: boolean;
  state: SplendorPublicState;
  /** 自己的预留牌（观战为 null）。 */
  yourReserved: SplendorSeatProjection["yourReserved"];
  /** 每位玩家预留张数。 */
  reservedCounts: number[];
  /** 当前欠决策座位的 seatId（供回合计时显示）。 */
  decidingSeatId: string | null;
  isYourTurn: boolean;
  displayName: string | null;
  displayNames: Record<string, string>;
};

type SplendorSeatProjection = ReturnType<typeof projectForSeat>;

export function toSplendorSeatView(
  match: ActiveSplendorMatch,
  seatId: string,
  requestId = `req-${match.state.stateVersion}-${seatId}`,
): SplendorSeatView {
  const projection = projectForSeat(match.state, seatIdToPlayer(seatId) ?? 0);
  const player = seatIdToPlayer(seatId);
  const decidingPlayer = activeDecidingPlayerOf(match.state);
  return {
    protocolVersion: SPLENDOR_PROTOCOL_VERSION,
    requestId,
    matchId: match.state.matchId,
    stateVersion: match.state.stateVersion,
    seatId,
    game: "splendor",
    spectator: false,
    state: projection.state,
    yourReserved: projection.yourReserved,
    reservedCounts: projection.reservedCounts,
    decidingSeatId: decidingPlayer === null ? null : playerToSeatId(decidingPlayer),
    isYourTurn: decidingPlayer !== null && player === decidingPlayer,
    displayName: match.displayNames[seatId] ?? null,
    displayNames: match.displayNames,
  };
}

export function toSplendorSpectatorView(
  match: ActiveSplendorMatch,
  requestId = `spec-${match.state.stateVersion}`,
): SplendorSeatView {
  const projection = projectForSeat(match.state, null);
  const decidingPlayer = activeDecidingPlayerOf(match.state);
  return {
    protocolVersion: SPLENDOR_PROTOCOL_VERSION,
    requestId,
    matchId: match.state.matchId,
    stateVersion: match.state.stateVersion,
    seatId: "spectator",
    game: "splendor",
    spectator: true,
    state: projection.state,
    yourReserved: null,
    reservedCounts: projection.reservedCounts,
    decidingSeatId: decidingPlayer === null ? null : playerToSeatId(decidingPlayer),
    isYourTurn: false,
    displayName: null,
    displayNames: match.displayNames,
  };
}

/** 当前欠决策玩家（行动阶段=当前玩家；弃筹码/选贵族=待决玩家）。 */
export function activeDecidingPlayerOf(state: SplendorState): number | null {
  if (state.status === "finished") return null;
  if (state.phase === "await_discard" && state.discardExcess !== null) return state.discardExcess;
  if (state.phase === "await_noble" && state.nobleChoice) return state.nobleChoice.player;
  return state.currentPlayer;
}

export function startSplendorMatch(options: {
  matchId: string;
  seed: string;
  playerCount: 2 | 3 | 4;
  displayNames: Record<string, string>;
  persistence?: SplendorMatchPersistence;
  roomCode?: string;
}): ActiveSplendorMatch {
  const created = createMatch({
    matchId: options.matchId,
    seed: options.seed,
    playerCount: options.playerCount,
  });
  const match: ActiveSplendorMatch = {
    state: created,
    events: [],
    humanSeatId: "1",
    displayNames: options.displayNames,
  };
  options.persistence?.onCreated(match, options.roomCode);
  return match;
}

export type SplendorDecisionPayloadLike = {
  protocolVersion: number;
  requestId: string;
  stateVersion: number;
  command: SplendorCommand;
};

export function submitSplendorDecision(
  match: ActiveSplendorMatch,
  payload: SplendorDecisionPayloadLike,
  options: { persistence?: SplendorMatchPersistence; actingSeatId?: string } = {},
): { ok: true; match: ActiveSplendorMatch } | { ok: false; reason: string } {
  if (payload.protocolVersion !== SPLENDOR_PROTOCOL_VERSION) {
    return { ok: false, reason: "unsupported_protocol" };
  }
  if (!payload.requestId) {
    return { ok: false, reason: "missing_request_id" };
  }
  if (payload.stateVersion !== match.state.stateVersion) {
    return { ok: false, reason: "version_mismatch" };
  }
  const actingSeatId = options.actingSeatId ?? match.humanSeatId;
  const player = seatIdToPlayer(actingSeatId);
  if (player === null) {
    return { ok: false, reason: "not_human_seat" };
  }
  const command = payload.command;
  if (!command || typeof command !== "object") {
    return { ok: false, reason: "invalid_command" };
  }
  // 座位身份强制：不能替别人提交。
  if (command.player !== player) {
    return { ok: false, reason: "not_your_turn" };
  }
  const result = applyCommand(match.state, command);
  if (!result.ok) {
    return result;
  }
  const next: ActiveSplendorMatch = {
    ...match,
    state: result.state,
    events: [...match.events, ...result.events],
  };
  const newEvents = next.events.slice(match.events.length);
  options.persistence?.onCommitted(next, newEvents);
  return { ok: true, match: next };
}

export function newSplendorMatchId(): string {
  return `splendor-${randomUUID()}`;
}

/** 供 GameModule.planAutoDecision 使用。 */
export function planSplendorAuto(
  state: SplendorState,
  seatId: string,
): { payload: SplendorDecisionPayload; kind: string } | null {
  const player = seatIdToPlayer(seatId);
  if (player === null) return null;
  const command = planAutoDecision(state, player, state.stateVersion);
  if (!command) return null;
  return {
    payload: {
      protocolVersion: SPLENDOR_PROTOCOL_VERSION,
      requestId: `auto-${state.stateVersion}-${seatId}`,
      stateVersion: state.stateVersion,
      command,
    },
    kind: command.type,
  };
}
