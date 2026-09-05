import type { Card, IndustryType, NodeId, PlayerCount } from '../types.js';

/**
 * 牌组构成（64 张全量 + 每张标注适用人数；2p=40 / 3p=54 / 4p=64）。
 * 总量与「每时代 10/9/8 回合 × 人数 × 2 行动 + 初始弃牌」精确吻合。
 * Wild 卡（4+4）不进牌堆。
 */

interface CardSpec {
  minPlayers: PlayerCount;
  count: number;
  face: Card;
}

function loc(location: NodeId, count: number, minPlayers: PlayerCount): CardSpec {
  return { minPlayers, count, face: { id: '', kind: 'location', location } };
}
function ind(industries: IndustryType[], count: number, minPlayers: PlayerCount): CardSpec {
  return { minPlayers, count, face: { id: '', kind: 'industry', industries } };
}

export const CARD_SPECS: CardSpec[] = [
  loc('birmingham', 3, 2),
  loc('coventry', 3, 2),
  loc('coalbrookdale', 3, 2),
  loc('derby', 3, 4),
  loc('stoke-on-trent', 3, 3),
  loc('belper', 2, 4),
  loc('leek', 2, 3),
  loc('stone', 2, 3),
  loc('uttoxeter', 1, 4),
  loc('uttoxeter', 1, 3),
  loc('stafford', 2, 2),
  loc('burton-on-trent', 2, 2),
  loc('cannock', 2, 2),
  loc('dudley', 2, 2),
  loc('kidderminster', 2, 2),
  loc('wolverhampton', 2, 2),
  loc('worcester', 2, 2),
  loc('tamworth', 1, 2),
  loc('walsall', 1, 2),
  loc('nuneaton', 1, 2),
  loc('redditch', 1, 2),
  ind(['iron'], 4, 2),
  ind(['coal'], 2, 2),
  ind(['coal'], 1, 4),
  ind(['pottery'], 2, 2),
  ind(['pottery'], 1, 4),
  ind(['brewery'], 5, 2),
  ind(['cotton', 'manufacturer'], 6, 3),
  ind(['cotton', 'manufacturer'], 2, 4),
];

export const WILD_LOCATION_COUNT = 4;
export const WILD_INDUSTRY_COUNT = 4;
export const HAND_SIZE = 8;

/** 生成某人数的全量牌 id 列表（未洗牌）。 */
export function deckCardIds(playerCount: PlayerCount): string[] {
  const ids: string[] = [];
  const seen = new Map<string, number>();
  for (const spec of CARD_SPECS) {
    if (spec.minPlayers > playerCount) continue;
    for (let i = 0; i < spec.count; i++) {
      const face = spec.face;
      let base: string;
      if (face.kind === 'location') base = `loc-${face.location}`;
      else if (face.kind === 'industry') base = `ind-${face.industries.join('_')}`;
      else base = face.kind;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      ids.push(`${base}#${n}`);
    }
  }
  return ids;
}
