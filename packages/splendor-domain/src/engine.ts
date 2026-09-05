import type {
  ApplyResult,
  DevCard,
  GemColor,
  GemCount,
  Noble,
  SplendorCommand,
  SplendorEvent,
  SplendorState,
  SplendorPlayer,
} from "./types.js";
import {
  GEM_COLORS,
  RESERVED_LIMIT,
  TABLE_SLOTS,
  TOKEN_LIMIT,
  WIN_SCORE,
} from "./types.js";

/**
 * 原子命令引擎：校验失败返回 {ok:false, reason}，成功返回全新状态 + 新事件。
 * 规则基准：官方规则书（Space Cowboys 2014）——
 * - 明牌被购买/预留后立即由同级牌库顶补位（牌库空则留空）；
 * - 15 分后打完当前轮（每人回合数相同）再结算，分高者胜，平局比已购卡数。
 */

function clone<T>(value: T): T {
  return structuredClone(value);
}

function emptyGems(): GemCount {
  return { white: 0, blue: 0, green: 0, red: 0, black: 0 };
}

function isGemCount(value: unknown): value is GemCount {
  if (!value || typeof value !== "object") return false;
  for (const color of GEM_COLORS) {
    const n = (value as Record<string, unknown>)[color];
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0) return false;
  }
  return true;
}

function totalTokens(player: SplendorPlayer): number {
  let sum = player.gold;
  for (const color of GEM_COLORS) sum += player.gems[color];
  return sum;
}

function isPlayerTurn(state: SplendorState, player: number): boolean {
  if (state.phase === "await_discard") return state.discardExcess === player;
  if (state.phase === "await_noble") return state.nobleChoice?.player === player;
  return state.currentPlayer === player;
}

export function totalTokensOf(player: SplendorPlayer): number {
  return totalTokens(player);
}

/** 购买某卡的缺口：各色还差多少（可用黄金抵充）。 */
export function paymentShortfall(
  player: SplendorPlayer,
  cost: GemCount,
): { shortfall: GemCount; goldNeeded: number; affordable: boolean } {
  const shortfall = emptyGems();
  let goldNeeded = 0;
  for (const color of GEM_COLORS) {
    const need = Math.max(0, cost[color] - player.cards[color]);
    const fromGems = Math.min(need, player.gems[color]);
    shortfall[color] = need - fromGems;
    goldNeeded += need - fromGems;
  }
  return { shortfall, goldNeeded, affordable: goldNeeded <= player.gold };
}

export function canAfford(player: SplendorPlayer, card: DevCard): boolean {
  return paymentShortfall(player, card.cost).affordable;
}

/** 贵族造访资格：只数发展卡加成，不数宝石。 */
export function qualifiesForNoble(player: SplendorPlayer, noble: Noble): boolean {
  for (const color of GEM_COLORS) {
    if (player.cards[color] < noble.requirements[color]) return false;
  }
  return true;
}

export function eligibleNobles(state: SplendorState, player: SplendorPlayer): Noble[] {
  return state.nobles.filter((noble) => qualifiesForNoble(player, noble));
}

function nextSeq(state: SplendorState): number {
  const last = state.log[state.log.length - 1];
  return (last?.seq ?? 0) + 1;
}

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
type EventInput = DistributiveOmit<SplendorEvent, "seq">;

function recordEvent(
  state: SplendorState,
  events: SplendorEvent[],
  event: EventInput,
): void {
  const full = { ...event, seq: nextSeq(state) } as SplendorEvent;
  state.log.push(full);
  if (state.log.length > 60) state.log.splice(0, state.log.length - 60);
  events.push(full);
}

function refillSlot(state: SplendorState, level: 1 | 2 | 3, slot: number): void {
  const next = state.decks[level].pop() ?? null;
  state.table[level][slot] = next;
  state.deckCounts[level] = state.decks[level].length;
}

function grantNoble(state: SplendorState, player: SplendorPlayer, noble: Noble, events: SplendorEvent[]): void {
  player.nobles.push(noble.id);
  player.points += noble.points;
  state.nobles = state.nobles.filter((entry) => entry.id !== noble.id);
  recordEvent(state, events, { kind: "noble_visits", player: player.index, noble });
}

/** 回合收束：超 10 筹码先弃 → 贵族造访 → 轮转/终局。 */
function endTurn(state: SplendorState, player: SplendorPlayer, events: SplendorEvent[]): void {
  const excess = totalTokens(player) - TOKEN_LIMIT;
  if (excess > 0) {
    state.phase = "await_discard";
    state.discardExcess = player.index;
    return;
  }

  const eligible = eligibleNobles(state, player);
  if (eligible.length === 1) {
    grantNoble(state, player, eligible[0]!, events);
  } else if (eligible.length > 1) {
    state.phase = "await_noble";
    state.nobleChoice = { player: player.index, candidates: eligible.map((n) => n.id) };
    return;
  }

  advanceTurn(state, player, events);
}

function advanceTurn(state: SplendorState, player: SplendorPlayer, events: SplendorEvent[]): void {
  if (!state.finalRound && player.points >= WIN_SCORE) {
    state.finalRound = true;
    state.endTriggerPlayer = player.index;
    recordEvent(state, events, { kind: "final_round", player: player.index, points: player.points });
  }

  const nextPlayer = (state.currentPlayer + 1) % state.playerCount;
  if (state.finalRound && nextPlayer === state.endTriggerPlayer) {
    finishMatch(state, events);
    return;
  }
  state.currentPlayer = nextPlayer;
  state.phase = "action";
}

function finishMatch(state: SplendorState, events: SplendorEvent[]): void {
  const standings = [...state.players]
    .sort((a, b) => b.points - a.points || a.purchasedCount - b.purchasedCount || a.index - b.index);
  const best = standings[0]!;
  const winners = state.players
    .filter((p) => p.points === best.points && p.purchasedCount === best.purchasedCount)
    .map((p) => p.index);
  state.status = "finished";
  state.phase = "finished";
  state.winners = winners;
  state.discardExcess = null;
  state.nobleChoice = null;
  recordEvent(state, events, {
    kind: "match_finished",
    winners,
    standings: standings.map((p) => ({ player: p.index, points: p.points, cards: p.purchasedCount })),
  });
}

export function applyCommand(state: SplendorState, command: SplendorCommand): ApplyResult {
  if (!command || typeof command !== "object") {
    return { ok: false, reason: "invalid_command" };
  }
  if (command.expectedVersion !== state.stateVersion) {
    return { ok: false, reason: "version_mismatch" };
  }
  if (state.status !== "in_progress") {
    return { ok: false, reason: "match_finished" };
  }

  const next = clone(state);
  const player = next.players[command.player];
  if (!player) return { ok: false, reason: "invalid_command" };
  const events: SplendorEvent[] = [];

  switch (command.type) {
    case "take_gems": {
      if (next.phase !== "action") return { ok: false, reason: phaseError(next) };
      if (!isPlayerTurn(next, command.player)) return { ok: false, reason: "not_your_turn" };
      const gems = command.gems;
      if (!Array.isArray(gems) || (gems.length !== 2 && gems.length !== 3)) {
        return { ok: false, reason: "invalid_gems" };
      }
      if (gems.length === 3) {
        const distinct = new Set(gems);
        if (distinct.size !== 3 || !gems.every((c) => GEM_COLORS.includes(c))) {
          return { ok: false, reason: "invalid_gems" };
        }
        if (gems.some((c) => next.pool[c] < 1)) return { ok: false, reason: "pool_insufficient" };
        for (const color of gems) {
          next.pool[color] -= 1;
          player.gems[color] += 1;
        }
      } else {
        const [a, b] = gems;
        if (a !== b || !GEM_COLORS.includes(a)) return { ok: false, reason: "invalid_gems" };
        if (next.pool[a] < 4) return { ok: false, reason: "two_same_requires_four" };
        next.pool[a] -= 2;
        player.gems[a] += 2;
      }
      const taken: GemCount = emptyGems();
      for (const color of gems) taken[color] += 1;
      recordEvent(next, events, { kind: "gems_taken", player: player.index, gems: taken });
      next.stateVersion += 1;
      endTurn(next, player, events);
      return { ok: true, state: next, events };
    }

    case "reserve_table": {
      if (next.phase !== "action") return { ok: false, reason: phaseError(next) };
      if (!isPlayerTurn(next, command.player)) return { ok: false, reason: "not_your_turn" };
      if (player.reserved.length >= RESERVED_LIMIT) return { ok: false, reason: "reserved_limit" };
      if (!isLevel(command.level)) return { ok: false, reason: "invalid_command" };
      const slot = command.slot;
      if (!Number.isInteger(slot) || slot < 0 || slot >= TABLE_SLOTS) {
        return { ok: false, reason: "invalid_command" };
      }
      const card = next.table[command.level][slot];
      if (!card) return { ok: false, reason: "slot_empty" };
      const goldTaken = next.gold > 0;
      if (goldTaken) {
        next.gold -= 1;
        player.gold += 1;
      }
      player.reserved.push(card);
      refillSlot(next, command.level, slot);
      recordEvent(next, events, { kind: "reserved", player: player.index, level: command.level, fromDeck: false, goldTaken });
      next.stateVersion += 1;
      endTurn(next, player, events);
      return { ok: true, state: next, events };
    }

    case "reserve_deck": {
      if (next.phase !== "action") return { ok: false, reason: phaseError(next) };
      if (!isPlayerTurn(next, command.player)) return { ok: false, reason: "not_your_turn" };
      if (player.reserved.length >= RESERVED_LIMIT) return { ok: false, reason: "reserved_limit" };
      if (!isLevel(command.level)) return { ok: false, reason: "invalid_command" };
      const card = next.decks[command.level].pop();
      if (!card) return { ok: false, reason: "deck_empty" };
      next.deckCounts[command.level] = next.decks[command.level].length;
      const goldTaken = next.gold > 0;
      if (goldTaken) {
        next.gold -= 1;
        player.gold += 1;
      }
      player.reserved.push(card);
      recordEvent(next, events, { kind: "reserved", player: player.index, level: command.level, fromDeck: true, goldTaken });
      next.stateVersion += 1;
      endTurn(next, player, events);
      return { ok: true, state: next, events };
    }

    case "purchase_table": {
      if (next.phase !== "action") return { ok: false, reason: phaseError(next) };
      if (!isPlayerTurn(next, command.player)) return { ok: false, reason: "not_your_turn" };
      if (!isLevel(command.level)) return { ok: false, reason: "invalid_command" };
      const slot = command.slot;
      if (!Number.isInteger(slot) || slot < 0 || slot >= TABLE_SLOTS) {
        return { ok: false, reason: "invalid_command" };
      }
      const card = next.table[command.level][slot];
      if (!card) return { ok: false, reason: "slot_empty" };
      const payment = paymentShortfall(player, card.cost);
      if (!payment.affordable) return { ok: false, reason: "insufficient_payment" };
      purchaseCard(next, player, card, payment.goldNeeded);
      refillSlot(next, command.level, slot);
      recordEvent(next, events, { kind: "purchased", player: player.index, card, from: "table", goldUsed: payment.goldNeeded });
      next.stateVersion += 1;
      endTurn(next, player, events);
      return { ok: true, state: next, events };
    }

    case "purchase_reserved": {
      if (next.phase !== "action") return { ok: false, reason: phaseError(next) };
      if (!isPlayerTurn(next, command.player)) return { ok: false, reason: "not_your_turn" };
      const index = player.reserved.findIndex((c) => c.id === command.cardId);
      if (index < 0) return { ok: false, reason: "card_not_reserved" };
      const card = player.reserved[index]!;
      const payment = paymentShortfall(player, card.cost);
      if (!payment.affordable) return { ok: false, reason: "insufficient_payment" };
      player.reserved.splice(index, 1);
      purchaseCard(next, player, card, payment.goldNeeded);
      recordEvent(next, events, { kind: "purchased", player: player.index, card, from: "hand", goldUsed: payment.goldNeeded });
      next.stateVersion += 1;
      endTurn(next, player, events);
      return { ok: true, state: next, events };
    }

    case "discard_gems": {
      if (next.phase !== "await_discard" || next.discardExcess !== command.player) {
        return { ok: false, reason: "not_discarding" };
      }
      if (!isGemCount(command.gems)) return { ok: false, reason: "invalid_discard" };
      const total = GEM_COLORS.reduce((sum, color) => sum + command.gems[color], 0);
      const mustDiscard = totalTokens(player) - TOKEN_LIMIT;
      if (total !== mustDiscard) return { ok: false, reason: "invalid_discard" };
      for (const color of GEM_COLORS) {
        if (command.gems[color] > player.gems[color]) return { ok: false, reason: "invalid_discard" };
      }
      for (const color of GEM_COLORS) {
        player.gems[color] -= command.gems[color];
        next.pool[color] += command.gems[color];
      }
      recordEvent(next, events, { kind: "gems_discarded", player: player.index, gems: { ...command.gems } });
      next.stateVersion += 1;
      next.phase = "action";
      next.discardExcess = null;
      // 弃完超额筹码后回合继续收束：贵族判定 → 轮转/终局。
      endTurn(next, player, events);
      return { ok: true, state: next, events };
    }

    case "choose_noble": {
      if (next.phase !== "await_noble" || next.nobleChoice?.player !== command.player) {
        return { ok: false, reason: "not_choosing_noble" };
      }
      if (!next.nobleChoice.candidates.includes(command.nobleId)) {
        return { ok: false, reason: "noble_not_eligible" };
      }
      const noble = next.nobles.find((n) => n.id === command.nobleId);
      if (!noble) return { ok: false, reason: "noble_not_eligible" };
      grantNoble(next, player, noble, events);
      next.stateVersion += 1;
      next.phase = "action";
      next.nobleChoice = null;
      advanceTurn(next, player, events);
      return { ok: true, state: next, events };
    }

    default:
      return { ok: false, reason: "invalid_command" };
  }
}

function purchaseCard(
  state: SplendorState,
  player: SplendorPlayer,
  card: DevCard,
  goldNeeded: number,
): void {
  for (const color of GEM_COLORS) {
    const need = Math.max(0, card.cost[color] - player.cards[color]);
    const fromGems = Math.min(need, player.gems[color]);
    player.gems[color] -= fromGems;
    state.pool[color] += fromGems;
  }
  player.gold -= goldNeeded;
  state.gold += goldNeeded;
  player.cards[card.color] += 1;
  player.purchasedCount += 1;
  player.points += card.points;
}

function phaseError(state: SplendorState): string {
  if (state.phase === "await_discard") return "await_discard_pending";
  if (state.phase === "await_noble") return "await_noble_pending";
  return "invalid_command";
}

function isLevel(value: unknown): value is 1 | 2 | 3 {
  return value === 1 || value === 2 || value === 3;
}
