import type { BrassCommand, BrassState } from './types.js';
import { tileSpec } from './data/tiles.js';

/**
 * 超时代打策略（回合计时器超时以该玩家名义提交）。
 * 行动阶段：Pass（弃手牌第一张）——对局面破坏最小。
 * 缺额拆板阶段：拆半价价值最低的场上板块直至够付。
 */
export function planAutoDecision(state: BrassState, player: number, expectedVersion: number): BrassCommand | null {
  if (state.status === 'finished') return null;
  if (state.phase === 'await_shortfall_removal') {
    if (state.shortfall?.player !== player) return null;
    const tile = state.placedTiles
      .filter((t) => t.player === player)
      .sort((a, b) => Math.floor(tileSpec(a.industry, a.level).costMoney / 2) - Math.floor(tileSpec(b.industry, b.level).costMoney / 2))[0];
    if (!tile) return null;
    return { type: 'shortfall_removal', player, tileId: tile.id, expectedVersion };
  }
  if (state.currentPlayer !== player || state.actionsLeft <= 0) return null;
  const cardId = state.players[player].hand[0];
  if (!cardId) return null;
  return { type: 'pass', player, cardId, expectedVersion };
}
