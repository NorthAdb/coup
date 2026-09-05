import { randomUUID } from "node:crypto";
import type {
  CatanDecisionPayload,
  CatanGame,
  CatanProjection,
  DevCardKind,
  GameEvent,
  ResourceCount,
} from "@coup/catan-domain";
import {
  applyCommand,
  createGame,
  planAutoDecision,
  planBotDecision,
  PLAYER_COLORS,
  projectForSeat,
} from "@coup/catan-domain";

/**
 * Catan 对局运行时：与 coup/brass/splendor 的 runtime 同构。
 * 投影使用 catan-domain 的 projectForSeat（隐藏他人手牌/发展卡身份与牌库顺序）。
 */

export type ActiveCatanMatch = {
  state: CatanGame;
  events: GameEvent[];
  /** 房主座位（seatId '1' → player 0）。 */
  humanSeatId: string;
  displayNames: Record<string, string>;
};

export type CatanMatchPersistence = {
  onCreated(match: ActiveCatanMatch, roomCode?: string): void;
  onCommitted(match: ActiveCatanMatch, newEvents: GameEvent[]): void;
};

export const CATAN_PROTOCOL_VERSION = 1;

export function seatIdToPlayer(seatId: string): number | null {
  const n = Number(seatId);
  if (!Number.isInteger(n) || n < 1 || n > 4) return null;
  return n - 1;
}

export function playerToSeatId(player: number): string {
  return String(player + 1);
}

export type CatanSeatView = {
  protocolVersion: number;
  requestId: string;
  matchId: string;
  stateVersion: number;
  seatId: string;
  game: "catan";
  spectator: boolean;
  state: CatanGame;
  /** 自己的手牌（观战为全零）。 */
  hand: ResourceCount;
  /** 自己未打出的发展卡（观战为空）。 */
  devCards: DevCardKind[];
  /** 牌库剩余张数（顺序不外泄）。 */
  devDeckCount: number;
  /** 他人公开信息（handCount/devCount 已填进投影后的 players）。 */
  others: CatanProjection["others"];
  /** 全程事件流（追加式；客户端按长度差值做动画）。 */
  events: GameEvent[];
  /** 当前欠决策座位的 seatId（供回合计时显示）。 */
  decidingSeatId: string | null;
  isYourTurn: boolean;
  displayName: string | null;
  displayNames: Record<string, string>;
};

/**
 * 当前欠决策玩家：有待回应交易且对象是机器人时 = 该机器人（由 bot 驱动回应）；
 * 对象是人类时不阻塞行动方（人类可随时异步回应），仍按当前行动玩家算。
 */
export function activeDecidingPlayerOf(state: CatanGame): number | null {
  if (state.status === "finished") return null;
  if (state.pendingTrade && state.players[state.pendingTrade.to]?.isHuman === false) {
    return state.pendingTrade.to;
  }
  return state.turn;
}

export function toCatanSeatView(
  match: ActiveCatanMatch,
  seatId: string,
  requestId = `req-${match.state.stateVersion}-${seatId}`,
): CatanSeatView {
  const player = seatIdToPlayer(seatId) ?? 0;
  const projection = projectForSeat(match.state, player);
  const decidingPlayer = activeDecidingPlayerOf(match.state);
  return {
    protocolVersion: CATAN_PROTOCOL_VERSION,
    requestId,
    matchId: match.state.matchId,
    stateVersion: match.state.stateVersion,
    seatId,
    game: "catan",
    spectator: false,
    state: projection.state,
    hand: projection.hand,
    devCards: projection.devCards,
    devDeckCount: projection.devDeckCount,
    others: projection.others,
    events: match.events,
    decidingSeatId: decidingPlayer === null ? null : playerToSeatId(decidingPlayer),
    isYourTurn: decidingPlayer !== null && player === decidingPlayer,
    displayName: match.displayNames[seatId] ?? null,
    displayNames: match.displayNames,
  };
}

export function toCatanSpectatorView(
  match: ActiveCatanMatch,
  requestId = `spec-${match.state.stateVersion}`,
): CatanSeatView {
  const projection = projectForSeat(match.state, null);
  const decidingPlayer = activeDecidingPlayerOf(match.state);
  return {
    protocolVersion: CATAN_PROTOCOL_VERSION,
    requestId,
    matchId: match.state.matchId,
    stateVersion: match.state.stateVersion,
    seatId: "spectator",
    game: "catan",
    spectator: true,
    state: projection.state,
    hand: projection.hand,
    devCards: [],
    devDeckCount: projection.devDeckCount,
    others: projection.others,
    events: match.events,
    decidingSeatId: decidingPlayer === null ? null : playerToSeatId(decidingPlayer),
    isYourTurn: false,
    displayName: null,
    displayNames: match.displayNames,
  };
}

/** 把字符串种子压成 uint32（mulberry32 输入）。 */
function seedToUint32(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function startCatanMatch(options: {
  matchId: string;
  seed: string;
  seats: Array<{ seatId: string; kind: "local_human" | "remote_human" | "bot"; displayName: string }>;
  persistence?: CatanMatchPersistence;
  roomCode?: string;
}): ActiveCatanMatch {
  const state = createGame(
    options.seats.map((seat, index) => ({
      name: seat.displayName,
      color: PLAYER_COLORS[index % PLAYER_COLORS.length]!,
      isHuman: seat.kind !== "bot",
    })),
    seedToUint32(options.seed),
    options.matchId,
  );
  const match: ActiveCatanMatch = {
    state,
    events: [],
    humanSeatId: "1",
    displayNames: Object.fromEntries(options.seats.map((seat) => [seat.seatId, seat.displayName])),
  };
  options.persistence?.onCreated(match, options.roomCode);
  return match;
}

export type CatanSubmitPayload = {
  protocolVersion: number;
  requestId: string;
  stateVersion: number;
  command: Parameters<typeof applyCommand>[1];
};

export function submitCatanDecision(
  match: ActiveCatanMatch,
  payload: CatanSubmitPayload,
  options: { persistence?: CatanMatchPersistence; actingSeatId?: string } = {},
): { ok: true; match: ActiveCatanMatch } | { ok: false; reason: string } {
  if (payload.protocolVersion !== CATAN_PROTOCOL_VERSION) {
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
    return { ok: false, reason: result.code };
  }
  const next: ActiveCatanMatch = {
    ...match,
    state: result.state,
    events: [...match.events, ...result.events],
  };
  const newEvents = next.events.slice(match.events.length);
  options.persistence?.onCommitted(next, newEvents);
  return { ok: true, match: next };
}

export function newCatanMatchId(): string {
  return `catan-${randomUUID()}`;
}

/** 供 GameModule.planAutoDecision 使用（超时代打）。 */
export function planCatanAuto(
  state: CatanGame,
  seatId: string,
): { payload: CatanDecisionPayload; kind: string } | null {
  const player = seatIdToPlayer(seatId);
  if (player === null) return null;
  const command = planAutoDecision(state, player);
  if (!command) return null;
  return {
    payload: {
      protocolVersion: CATAN_PROTOCOL_VERSION,
      requestId: `auto-${state.stateVersion}-${seatId}`,
      stateVersion: state.stateVersion,
      command,
    },
    kind: command.type,
  };
}

/** 供 GameModule.planBotDecision 使用（AI 队友）。 */
export function planCatanBot(
  state: CatanGame,
  seatId: string,
): { payload: CatanDecisionPayload; kind: string } | null {
  const player = seatIdToPlayer(seatId);
  if (player === null) return null;
  if (!state.players[player]) return null;
  const command = planBotDecision(state, player);
  if (!command) return null;
  return {
    payload: {
      protocolVersion: CATAN_PROTOCOL_VERSION,
      requestId: `bot-${state.stateVersion}-${seatId}`,
      stateVersion: state.stateVersion,
      command,
    },
    kind: command.type,
  };
}
