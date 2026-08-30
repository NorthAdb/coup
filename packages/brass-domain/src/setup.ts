import type { BrassState, CreateMatchInput, PlayerCount, PlacedMerchant, PlacedTile } from './types.js';
import { deckCardIds, HAND_SIZE } from './data/cards.js';
import { COAL_MARKET_INITIAL, IRON_MARKET_INITIAL } from './data/market.js';
import { INCOME_START_SPACE } from './data/income.js';
import { TILE_SPECS } from './data/tiles.js';
import { MERCHANT_TILE_FACES, merchantSlotsFor } from './data/board.js';
import { hashSeed, mulberry32, shuffled } from './rng.js';

export const LINKS_PER_PLAYER_PER_ERA = 14;

export function emptyMat(): Record<string, number[]> {
  const mat: Record<string, number[]> = {};
  for (const spec of TILE_SPECS) {
    for (let i = 0; i < spec.count; i++) {
      const arr = mat[spec.industry] ?? (mat[spec.industry] = []);
      arr.push(spec.level);
    }
  }
  return mat;
}

export function createMatch(input: CreateMatchInput): BrassState {
  const playerCount = input.playerCount;
  const rand = mulberry32(hashSeed(input.seed));

  const players = Array.from({ length: playerCount }, () => ({
    money: 17,
    incomeSpace: INCOME_START_SPACE,
    vp: 0,
    spent: 0,
    hand: [] as string[],
    discard: [] as string[],
    mat: emptyMat(),
  }));

  // 牌库与初始手牌：每人 8 张手牌 + 1 张面朝下弃牌堆底。
  const deck = shuffled(deckCardIds(playerCount as PlayerCount), rand);
  for (const p of players) {
    p.hand = deck.splice(0, HAND_SIZE);
    p.discard = deck.splice(0, 1);
  }

  // 商人板块：按人数过滤板位，板块洗混随机放置。
  const slots = merchantSlotsFor(playerCount);
  const faces = shuffled(MERCHANT_TILE_FACES, rand).slice(0, slots.length);
  const merchantTiles: PlacedMerchant[] = slots.map((slot, i) => {
    const face = faces[i];
    return {
      slotId: slot.slotId,
      location: slot.location,
      goods: face.goods as PlacedMerchant['goods'],
      blank: face.blank,
      beer: !face.blank,
    };
  });

  const randomOrder = shuffled(
    Array.from({ length: playerCount }, (_, i) => i),
    rand,
  );

  const state: BrassState = {
    matchId: input.matchId,
    seed: input.seed,
    status: 'in_progress',
    stateVersion: 0,
    phase: 'await_action',
    playerCount,
    era: 'canal',
    round: 1,
    currentPlayer: randomOrder[0],
    actionsLeft: 1, // 运河时代第 1 回合每人 1 个行动
    turnOrder: randomOrder,
    players,
    placedTiles: [] as PlacedTile[],
    placedLinks: [],
    merchantTiles,
    coalMarket: COAL_MARKET_INITIAL,
    ironMarket: IRON_MARKET_INITIAL,
    deck,
    wildLocationArea: 4,
    wildIndustryArea: 4,
    shortfall: null,
    shortfallQueue: [],
    log: [],
    linksLeft: players.map(() => LINKS_PER_PLAYER_PER_ERA),
    winner: null,
    finalScores: null,
  };
  return state;
}
