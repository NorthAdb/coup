import type { GemCount, PlayerCount, SplendorState, SplendorPlayer } from "./types.js";
import { GEM_COLORS, TABLE_SLOTS } from "./types.js";
import { LEVEL1_CARDS, LEVEL2_CARDS, LEVEL3_CARDS, ALL_NOBLES } from "./data/cards.js";
import { hashSeed, mulberry32, shuffled } from "./rng.js";

/** 每人数的宝石筹码供给（不含黄金，黄金恒 5 枚）。 */
export function gemSupplyFor(playerCount: PlayerCount): number {
  return playerCount === 2 ? 4 : playerCount === 3 ? 5 : 7;
}

function emptyGems(): GemCount {
  return { white: 0, blue: 0, green: 0, red: 0, black: 0 };
}

function freshPlayer(index: number): SplendorPlayer {
  return {
    index,
    gems: emptyGems(),
    gold: 0,
    reserved: [],
    cards: emptyGems(),
    purchasedCount: 0,
    nobles: [],
    points: 0,
  };
}

export function createMatch(options: {
  matchId: string;
  seed: string;
  playerCount: PlayerCount;
}): SplendorState {
  const rand = mulberry32(hashSeed(options.seed));
  const decks = {
    1: shuffled(LEVEL1_CARDS, rand),
    2: shuffled(LEVEL2_CARDS, rand),
    3: shuffled(LEVEL3_CARDS, rand),
  } as SplendorState["decks"];

  const table = { 1: [], 2: [], 3: [] } as SplendorState["table"];
  for (const level of [1, 2, 3] as const) {
    for (let slot = 0; slot < TABLE_SLOTS; slot += 1) {
      table[level].push(decks[level].pop() ?? null);
    }
  }

  // 官方设置：贵族数 = 玩家数 + 1，随机选用。
  const nobles = shuffled(ALL_NOBLES, rand).slice(0, options.playerCount + 1);
  const supply = gemSupplyFor(options.playerCount);
  const pool = emptyGems();
  for (const color of GEM_COLORS) pool[color] = supply;

  return {
    matchId: options.matchId,
    playerCount: options.playerCount,
    stateVersion: 1,
    status: "in_progress",
    phase: "action",
    currentPlayer: 0,
    decks,
    table,
    deckCounts: { 1: decks[1].length, 2: decks[2].length, 3: decks[3].length },
    pool,
    gold: 5,
    players: Array.from({ length: options.playerCount }, (_, i) => freshPlayer(i)),
    nobles,
    finalRound: false,
    endTriggerPlayer: null,
    discardExcess: null,
    nobleChoice: null,
    winners: [],
    log: [{ seq: 1, kind: "match_started", playerCount: options.playerCount }],
  };
}
