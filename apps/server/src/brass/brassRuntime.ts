import { randomUUID } from "node:crypto";
import type { BrassCommand, BrassState, LogEntry } from "@coup/brass-domain";
import { applyCommand, createMatch, projectForSeat } from "@coup/brass-domain";

/**
 * Brass 对局运行时：与 coup 的 matchRuntime 同构，但投影直接使用 brass-domain
 * 的 projectForSeat（隐藏他人手牌与牌库顺序），命令即 BrassCommand。
 */

export type ActiveBrassMatch = {
  state: BrassState;
  events: LogEntry[];
  /** 房主座位（seatId '1' → player 0）。 */
  humanSeatId: string;
  displayNames: Record<string, string>;
};

export type BrassMatchPersistence = {
  onCreated(match: ActiveBrassMatch, roomCode?: string): void;
  onCommitted(match: ActiveBrassMatch, newEvents: LogEntry[]): void;
};

export const BRASS_PROTOCOL_VERSION = 1;

export function seatIdToPlayer(seatId: string): number | null {
  const n = Number(seatId);
  if (!Number.isInteger(n) || n < 1 || n > 4) return null;
  return n - 1;
}

export function playerToSeatId(player: number): string {
  return String(player + 1);
}

export type BrassSeatView = {
  protocolVersion: 1;
  requestId: string;
  matchId: string;
  stateVersion: number;
  seatId: string;
  game: "brass";
  spectator: boolean;
  state: BrassState;
  hand: string[];
  othersHandCount: Record<number, number>;
  /** 当前欠决策座位的 seatId（供回合计时显示）。 */
  decidingSeatId: string | null;
  isYourTurn: boolean;
  displayName: string | null;
  displayNames: Record<string, string>;
};

export function toBrassSeatView(
  match: ActiveBrassMatch,
  seatId: string,
  requestId = `req-${match.state.stateVersion}-${seatId}`,
): BrassSeatView {
  const projection = projectForSeat(match.state, seatIdToPlayer(seatId) ?? 0);
  const player = seatIdToPlayer(seatId);
  const decidingPlayer = activeDecidingPlayerOf(match.state);
  return {
    protocolVersion: BRASS_PROTOCOL_VERSION,
    requestId,
    matchId: match.state.matchId,
    stateVersion: match.state.stateVersion,
    seatId,
    game: "brass",
    spectator: false,
    state: projection.state,
    hand: projection.hand,
    othersHandCount: projection.othersHandCount,
    decidingSeatId: decidingPlayer === null ? null : playerToSeatId(decidingPlayer),
    isYourTurn: decidingPlayer !== null && player === decidingPlayer,
    displayName: match.displayNames[seatId] ?? null,
    displayNames: match.displayNames,
  };
}

export function toBrassSpectatorView(
  match: ActiveBrassMatch,
  requestId = `spec-${match.state.stateVersion}`,
): BrassSeatView {
  const projection = projectForSeat(match.state, null);
  const decidingPlayer = activeDecidingPlayerOf(match.state);
  return {
    protocolVersion: BRASS_PROTOCOL_VERSION,
    requestId,
    matchId: match.state.matchId,
    stateVersion: match.state.stateVersion,
    seatId: "spectator",
    game: "brass",
    spectator: true,
    state: projection.state,
    hand: [],
    othersHandCount: projection.othersHandCount,
    decidingSeatId: decidingPlayer === null ? null : playerToSeatId(decidingPlayer),
    isYourTurn: false,
    displayName: null,
    displayNames: match.displayNames,
  };
}

/** 当前欠决策玩家（行动阶段=当前玩家；缺额拆板=缺额玩家）。 */
export function activeDecidingPlayerOf(state: BrassState): number | null {
  if (state.status === "finished") return null;
  if (state.phase === "await_shortfall_removal" && state.shortfall) return state.shortfall.player;
  return state.currentPlayer;
}

export function startBrassMatch(options: {
  matchId: string;
  seed: string;
  playerCount: 2 | 3 | 4;
  displayNames: Record<string, string>;
  persistence?: BrassMatchPersistence;
  roomCode?: string;
}): ActiveBrassMatch {
  const created = createMatch({
    matchId: options.matchId,
    seed: options.seed,
    playerCount: options.playerCount,
  });
  const match: ActiveBrassMatch = {
    state: created,
    events: [],
    humanSeatId: "1",
    displayNames: options.displayNames,
  };
  options.persistence?.onCreated(match, options.roomCode);
  return match;
}

export type BrassDecisionPayload = {
  protocolVersion: number;
  requestId: string;
  stateVersion: number;
  command: BrassCommand;
};

export function submitBrassDecision(
  match: ActiveBrassMatch,
  payload: BrassDecisionPayload,
  options: { persistence?: BrassMatchPersistence; actingSeatId?: string } = {},
): { ok: true; match: ActiveBrassMatch } | { ok: false; reason: string } {
  if (payload.protocolVersion !== BRASS_PROTOCOL_VERSION) {
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
  const next: ActiveBrassMatch = {
    ...match,
    state: result.state,
    events: [...match.events, ...result.events],
  };
  const newEvents = next.events.slice(match.events.length);
  options.persistence?.onCommitted(next, newEvents);
  return { ok: true, match: next };
}

export function newBrassMatchId(): string {
  return `brass-${randomUUID()}`;
}
