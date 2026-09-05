import type { GemColor, SplendorCommand, SplendorState } from "./types.js";
import { GEM_COLORS, TABLE_SLOTS, TOKEN_LIMIT } from "./types.js";
import { canAfford, totalTokensOf } from "./engine.js";

/**
 * 超时代打计划：为超时座位返回「破坏最小」的合法命令，
 * 与人类决策走同一 submitDecision 通路（ADR-0008）。
 * 优先级：弃超额筹码 > 选贵族 > 拿 3 散宝石 > 拿 2 同色 > 预留明牌 > 盲留。
 */

export function planAutoDecision(
  state: SplendorState,
  player: number,
  stateVersion: number,
): SplendorCommand | null {
  if (state.status !== "in_progress") return null;

  if (state.phase === "await_discard" && state.discardExcess === player) {
    const gems = planDiscard(state, player);
    if (!gems) return null;
    return { type: "discard_gems", player, expectedVersion: stateVersion, gems };
  }

  if (state.phase === "await_noble" && state.nobleChoice?.player === player) {
    const nobleId = state.nobleChoice.candidates[0];
    if (!nobleId) return null;
    return { type: "choose_noble", player, expectedVersion: stateVersion, nobleId };
  }

  if (state.phase !== "action" || state.currentPlayer !== player) return null;
  const self = state.players[player];
  if (!self) return null;

  // 拿 3 散宝石（前三种有货的颜色）。
  const available = GEM_COLORS.filter((color) => state.pool[color] > 0);
  if (available.length >= 3) {
    return { type: "take_gems", player, expectedVersion: stateVersion, gems: available.slice(0, 3) };
  }

  // 拿 2 同色。
  const doubleColor = GEM_COLORS.find((color) => state.pool[color] >= 4);
  if (doubleColor) {
    return { type: "take_gems", player, expectedVersion: stateVersion, gems: [doubleColor, doubleColor] };
  }

  // 若只剩少量颜色可拿且买得起明牌，直接买最便宜的（优于盲留）。
  const affordable = affordableTableCards(state, player);
  if (affordable.length > 0) {
    const pick = affordable.sort((a, b) => totalCost(a.card) - totalCost(b.card))[0]!;
    return {
      type: "purchase_table",
      player,
      expectedVersion: stateVersion,
      level: pick.level,
      slot: pick.slot,
    };
  }

  // 预留明牌（1 级优先），再盲留。
  for (const level of [1, 2, 3] as const) {
    if (self.reserved.length >= 3) break;
    for (let slot = 0; slot < TABLE_SLOTS; slot += 1) {
      if (state.table[level][slot]) {
        return { type: "reserve_table", player, expectedVersion: stateVersion, level, slot };
      }
    }
  }
  for (const level of [1, 2, 3] as const) {
    if (self.reserved.length >= 3) break;
    if ((state.deckCounts[level] ?? 0) > 0) {
      return { type: "reserve_deck", player, expectedVersion: stateVersion, level };
    }
  }

  return null;
}

/** 超限弃筹码：优先弃数量最多的颜色（破坏最小）。 */
function planDiscard(state: SplendorState, player: number): Record<GemColor, number> | null {
  const self = state.players[player];
  if (!self) return null;
  const excess = totalTokensOf(self) - TOKEN_LIMIT;
  if (excess <= 0) return null;
  const gems: Record<GemColor, number> = { white: 0, blue: 0, green: 0, red: 0, black: 0 };
  let remaining = excess;
  const order = [...GEM_COLORS].sort((a, b) => self.gems[b] - self.gems[a]);
  for (const color of order) {
    const take = Math.min(self.gems[color], remaining);
    if (take > 0) {
      gems[color] = take;
      remaining -= take;
    }
    if (remaining === 0) break;
  }
  return remaining === 0 ? gems : null;
}

function affordableTableCards(
  state: SplendorState,
  player: number,
): Array<{ level: 1 | 2 | 3; slot: number; card: NonNullable<SplendorState["table"][1][number]> }> {
  const self = state.players[player]!;
  const result: Array<{ level: 1 | 2 | 3; slot: number; card: NonNullable<SplendorState["table"][1][number]> }> = [];
  for (const level of [1, 2, 3] as const) {
    for (let slot = 0; slot < TABLE_SLOTS; slot += 1) {
      const card = state.table[level][slot];
      if (card && canAfford(self, card)) result.push({ level, slot, card });
    }
  }
  return result;
}

function totalCost(card: { cost: Record<GemColor, number> }): number {
  return GEM_COLORS.reduce((sum, color) => sum + card.cost[color], 0);
}
