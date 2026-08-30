import type { BrassState } from './types.js';

/**
 * 按座位投影：隐藏他人手牌（只留数量）与牌库顺序。
 * 观战（viewer=null）额外剥离所有手牌明细。
 */

export interface BrassSeatView {
  state: BrassState;
  viewer: number | null;
  hand: string[];
  othersHandCount: Record<number, number>;
}

export function projectForSeat(state: BrassState, viewer: number | null): BrassSeatView {
  const next: BrassState = structuredClone(state);
  next.deck = [];
  const othersHandCount: Record<number, number> = {};
  for (let i = 0; i < next.players.length; i++) {
    othersHandCount[i] = next.players[i].hand.length;
    if (i !== viewer) {
      next.players[i].hand = [];
    }
  }
  return {
    state: next,
    viewer,
    hand: viewer !== null ? state.players[viewer].hand.slice() : [],
    othersHandCount,
  };
}

/** 当前欠决策（欠行动/欠拆板）的座位；无则 null。供回合计时器使用。 */
export function activeDecidingPlayer(state: BrassState): number | null {
  if (state.status === 'finished') return null;
  if (state.phase === 'await_shortfall_removal' && state.shortfall) return state.shortfall.player;
  return state.currentPlayer;
}
