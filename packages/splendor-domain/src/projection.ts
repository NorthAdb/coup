import type {
  DevCard,
  SplendorPublicState,
  SplendorState,
} from "./types.js";

/**
 * 座位视角投影：隐藏牌库顺序与他人预留的私有牌；
 * 观战（player=null）看不到任何预留牌内容，只看得到张数。
 */

export type SplendorSeatProjection = {
  state: SplendorPublicState;
  /** 自己的预留牌（观战为 null）。 */
  yourReserved: DevCard[] | null;
  /** 每位玩家的预留张数（公开信息）。 */
  reservedCounts: number[];
};

export function projectForSeat(state: SplendorState, player: number | null): SplendorSeatProjection {
  const players = state.players.map((entry) => ({
    index: entry.index,
    gems: { ...entry.gems },
    gold: entry.gold,
    cards: { ...entry.cards },
    purchasedCount: entry.purchasedCount,
    nobles: [...entry.nobles],
    points: entry.points,
  }));

  const reservedCounts = state.players.map((entry) => entry.reserved.length);
  const yourReserved = player === null ? null : state.players[player]!.reserved.map((card) => ({ ...card }));

  return {
    state: {
      matchId: state.matchId,
      playerCount: state.playerCount,
      stateVersion: state.stateVersion,
      status: state.status,
      phase: state.phase,
      currentPlayer: state.currentPlayer,
      table: {
        1: state.table[1].map((card) => (card ? { ...card } : null)),
        2: state.table[2].map((card) => (card ? { ...card } : null)),
        3: state.table[3].map((card) => (card ? { ...card } : null)),
      },
      deckCounts: { ...state.deckCounts },
      pool: { ...state.pool },
      gold: state.gold,
      players,
      nobles: state.nobles.map((noble) => ({ ...noble })),
      finalRound: state.finalRound,
      endTriggerPlayer: state.endTriggerPlayer,
      discardExcess: state.discardExcess,
      nobleChoice: state.nobleChoice ? { ...state.nobleChoice } : null,
      winners: [...state.winners],
      log: state.log.map((entry) => ({ ...entry })),
      botPlayers: state.botPlayers ? [...state.botPlayers] : undefined,
    },
    yourReserved,
    reservedCounts,
  };
}
