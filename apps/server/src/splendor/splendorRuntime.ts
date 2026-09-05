import { randomUUID } from "node:crypto";
import type {
  DevCard,
  GemColor,
  SplendorCommand,
  SplendorDecisionPayload,
  SplendorEvent,
  SplendorPublicState,
  SplendorState,
} from "@coup/splendor-domain";
import {
  applyCommand,
  canAfford,
  createMatch,
  GEM_COLORS,
  planAutoDecision,
  projectForSeat,
  RESERVED_LIMIT,
  TABLE_SLOTS,
} from "@coup/splendor-domain";

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
  /** AI 座位（player 下标）；空缺视为全人类。 */
  botPlayers?: number[];
  persistence?: SplendorMatchPersistence;
  roomCode?: string;
}): ActiveSplendorMatch {
  const created = createMatch({
    matchId: options.matchId,
    seed: options.seed,
    playerCount: options.playerCount,
  });
  if (options.botPlayers && options.botPlayers.length > 0) {
    created.botPlayers = [...options.botPlayers];
  }
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

/* ------------------------------------------------------------------ */
/* 机器人启发式（AI 队友）                                             */
/* ------------------------------------------------------------------ */

/**
 * Splendor 机器人：优先买分牌（分高、便宜者优先），其次按需求拿宝石，
 * 快凑齐的高分牌用预留锁住；弃筹码/选贵族等特殊阶段交给超时代打计划兜底。
 */
export function planSplendorBot(
  state: SplendorState,
  seatId: string,
): { payload: SplendorDecisionPayload; kind: string } | null {
  const player = seatIdToPlayer(seatId);
  if (player === null) return null;
  if (state.status !== "in_progress") return null;
  if (state.phase !== "action" || state.currentPlayer !== player) return null;

  const expectedVersion = state.stateVersion;
  const payload = (command: SplendorCommand): { payload: SplendorDecisionPayload; kind: string } => ({
    payload: {
      protocolVersion: SPLENDOR_PROTOCOL_VERSION,
      requestId: `bot-${expectedVersion}-${seatId}`,
      stateVersion: expectedVersion,
      command,
    },
    kind: command.type,
  });

  const self = state.players[player]!;
  const affordable = affordableCards(state, player);

  // 1) 买：能买得起的牌里分最高者，平分时取最便宜。
  if (affordable.length > 0) {
    const best = [...affordable].sort(
      (a, b) => b.card.points - a.card.points || totalCost(a.card) - totalCost(b.card),
    )[0]!;
    if (best.reserved) {
      return payload({ type: "purchase_reserved", player, expectedVersion, cardId: best.card.id });
    }
    return payload({ type: "purchase_table", player, expectedVersion, level: best.level, slot: best.slot });
  }

  // 2) 拿宝石：挑「离买得起最近」的卡需要的颜色（缺得少的优先），取 3 散色。
  const needOrder = needColors(state, player);
  const poolColors = GEM_COLORS.filter((color) => state.pool[color] > 0);
  const picks: GemColor[] = [];
  for (const color of needOrder) {
    if (picks.length >= 3) break;
    if (picks.includes(color)) continue;
    if (state.pool[color] > 0) picks.push(color);
  }
  for (const color of poolColors) {
    if (picks.length >= 3) break;
    if (!picks.includes(color)) picks.push(color);
  }
  if (picks.length === 3) {
    return payload({ type: "take_gems", player, expectedVersion, gems: picks });
  }
  // 池子不足 3 色：拿 2 同色（≥4 枚）或预留。
  const doubleColor = GEM_COLORS.find(
    (color) => state.pool[color] >= 4 && needOrder.includes(color),
  ) ?? GEM_COLORS.find((color) => state.pool[color] >= 4);
  if (doubleColor) {
    return payload({ type: "take_gems", player, expectedVersion, gems: [doubleColor, doubleColor] });
  }

  // 3) 预留：优先需求色在场的牌，其次 1 级明牌，再盲留。
  if (self.reserved.length < RESERVED_LIMIT) {
    for (const level of [1, 2, 3] as const) {
      for (let slot = 0; slot < TABLE_SLOTS; slot += 1) {
        const card = state.table[level][slot];
        if (!card) continue;
        if (needOrder.some((color) => card.cost[color] > 0 && self.gems[color] + self.cards[color] < card.cost[color])) {
          return payload({ type: "reserve_table", player, expectedVersion, level, slot });
        }
      }
    }
    for (const level of [1, 2, 3] as const) {
      if ((state.deckCounts[level] ?? 0) > 0) {
        return payload({ type: "reserve_deck", player, expectedVersion, level });
      }
    }
  }

  return null;
}

function totalCost(card: DevCard): number {
  return GEM_COLORS.reduce((sum, color) => sum + card.cost[color], 0);
}

type AffordableCard = {
  level: 1 | 2 | 3;
  slot: number;
  card: DevCard;
  reserved: boolean;
};

function affordableCards(state: SplendorState, player: number): AffordableCard[] {
  const self = state.players[player]!;
  const out: AffordableCard[] = [];
  for (const level of [1, 2, 3] as const) {
    for (let slot = 0; slot < TABLE_SLOTS; slot += 1) {
      const card = state.table[level][slot];
      if (card && canAfford(self, card)) {
        out.push({ level, slot, card, reserved: false });
      }
    }
  }
  for (const card of self.reserved) {
    if (canAfford(self, card)) out.push({ level: 1, slot: 0, card, reserved: true });
  }
  return out;
}

/** 各颜色「还缺多少」升序排（用 bonus 折算后）。 */
function needColors(state: SplendorState, player: number): GemColor[] {
  const self = state.players[player]!;
  const missing = new Map<GemColor, number>();
  for (const color of GEM_COLORS) missing.set(color, 0);
  for (const level of [1, 2, 3] as const) {
    for (let slot = 0; slot < TABLE_SLOTS; slot += 1) {
      const card = state.table[level][slot];
      if (!card) continue;
      let gap = 0;
      for (const color of GEM_COLORS) {
        gap += Math.max(0, card.cost[color] - self.gems[color] - self.cards[color]);
      }
      for (const color of GEM_COLORS) {
        const need = card.cost[color] - self.gems[color] - self.cards[color];
        if (need > 0) missing.set(color, (missing.get(color) ?? 0) + need * (1 + gap / 6));
      }
    }
  }
  return [...GEM_COLORS].sort(
    (a, b) => (missing.get(a) ?? 0) - (missing.get(b) ?? 0),
  );
}
