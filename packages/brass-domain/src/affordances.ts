import type { BrassState, GoodsType, IndustryType, PlacedTile } from './types.js';
import { LOCATIONS, MERCHANTS, LINKS, linkEndpoints } from './data/board.js';
import { TILE_SPECS, tileSpec } from './data/tiles.js';
import { COAL_MARKET_CAPACITY, COAL_MARKET_PRICES, COAL_FLOOR_PRICE, IRON_MARKET_CAPACITY, IRON_MARKET_PRICES, IRON_FLOOR_PRICE, buyPriceAt } from './data/market.js';
import { incomeLevelAt } from './data/income.js';
import { distances, isConnected, isInNetwork, hasNothingOnBoard } from './graph.js';

/**
 * UI 可行项枚举（在投影态上运行，只依赖公开信息 + 本人手牌）。
 * 结果仅供交互引导；权威校验仍在 applyCommand。
 */

export interface BuildSpot {
  location: string;
  industry: IndustryType;
  tileLevel: number;
  costMoney: number;
  costCoal: number;
  costIron: number;
  emptySlots: number[];
  /** 需要优先放专属槽的空槽（其它空槽被禁用）。 */
  dedicatedOnly: boolean;
  overbuildTileIds: string[];
}

export interface CardBuildInfo {
  spots: BuildSpot[];
}

export function buildOptionsForCard(state: BrassState, player: number, cardId: string): CardBuildInfo {
  const face = cardId === 'wild-location' ? { kind: 'wild-location' as const }
    : cardId === 'wild-industry' ? { kind: 'wild-industry' as const }
    : (() => {
      const hash = cardId.lastIndexOf('#');
      const base = hash >= 0 ? cardId.slice(0, hash) : cardId;
      if (base.startsWith('loc-')) return { kind: 'location' as const, location: base.slice(4) };
      return { kind: 'industry' as const, industries: base.slice(4).split('_') as IndustryType[] };
    })();

  const anyIndustry: IndustryType[] = ['cotton', 'manufacturer', 'pottery', 'coal', 'iron', 'brewery'];
  const spots: BuildSpot[] = [];
  const loose = hasNothingOnBoard(state, player);

  const consider = (location: string, industries: IndustryType[], skipNetworkCheck: boolean) => {
    const locDef = LOCATIONS[location];
    if (!locDef) return;
    for (const industry of industries) {
      const stack = state.players[player].mat[industry];
      if (!stack || stack.length === 0) continue;
      const tileLevel = Math.min(...stack);
      const spec = tileSpec(industry, tileLevel);
      if (spec.eras === 'canalOnly' && state.era === 'rail') continue;
      if (spec.eras === 'railOnly' && state.era === 'canal') continue;
      if (!skipNetworkCheck && !loose && !isInNetwork(state, player, location)) continue;
      const emptySlots: number[] = [];
      locDef.slots.forEach((slot, i) => {
        if (slot.industries.includes(industry) && !state.placedTiles.some((t) => t.location === location && t.slotIndex === i)) {
          emptySlots.push(i);
        }
      });
      // 运河时代每地点限 1 块自己的板块。
      const canalBlocked = state.era === 'canal' && state.placedTiles.some((t) => t.location === location && t.player === player);
      if (emptySlots.length === 0 || canalBlocked) {
        // 无空槽或运河受限 → 只考虑覆盖。
      } else {
        const dedicatedEmpty = emptySlots.some((i) => locDef.slots[i].industries.length === 1);
        spots.push({
          location,
          industry,
          tileLevel,
          costMoney: spec.costMoney,
          costCoal: spec.costCoal,
          costIron: spec.costIron,
          // 存在空专属槽时共享槽不可用。
          emptySlots: dedicatedEmpty ? emptySlots.filter((i) => locDef.slots[i].industries.length === 1) : emptySlots,
          dedicatedOnly: dedicatedEmpty,
          overbuildTileIds: [],
        });
      }
      // 覆盖目标：同产业更高等级。
      const overbuildTileIds = state.placedTiles
        .filter((t) => {
          if (t.location !== location || t.industry !== industry || t.level >= tileLevel) return false;
          if (t.player === player) return true;
          if (industry !== 'coal' && industry !== 'iron') return false;
          const cubes = state.placedTiles
            .filter((x) => x.industry === industry)
            .reduce((sum, x) => sum + (industry === 'coal' ? x.coal : x.iron), 0);
          const market = industry === 'coal' ? state.coalMarket : state.ironMarket;
          return cubes + market === 0;
        })
        .map((t) => t.id);
      if (overbuildTileIds.length > 0) {
        const existing = spots.find((s) => s.location === location && s.industry === industry);
        if (existing) existing.overbuildTileIds = overbuildTileIds;
        else {
          spots.push({
            location,
            industry,
            tileLevel,
            costMoney: spec.costMoney,
            costCoal: spec.costCoal,
            costIron: spec.costIron,
            emptySlots: [],
            dedicatedOnly: false,
            overbuildTileIds,
          });
        }
      }
    }
  };

  if (face.kind === 'location') {
    consider(face.location, anyIndustry, true);
  } else if (face.kind === 'wild-location') {
    for (const location of Object.keys(LOCATIONS)) {
      if (LOCATIONS[location].farm) continue;
      consider(location, anyIndustry, true);
    }
  } else {
    const industries = face.kind === 'industry' ? face.industries : anyIndustry;
    for (const location of Object.keys(LOCATIONS)) {
      consider(location, industries, false);
    }
  }
  return { spots };
}

// ---------------------------------------------------------------------------
// 资源来源候选
// ---------------------------------------------------------------------------

export type CoalCandidate =
  | { kind: 'mine'; tileId: string; location: string; distance: number; available: number }
  | { kind: 'market'; available: number; priceEach: number };

export function coalCandidates(state: BrassState, atNodes: string[]): CoalCandidate[] {
  const distMaps = atNodes.map((n) => distances(state, n));
  const distTo = (node: string): number => Math.min(...distMaps.map((m) => m.get(node) ?? Infinity));
  const mines = state.placedTiles
    .filter((t) => t.industry === 'coal' && !t.flipped && t.coal > 0 && distTo(t.location) < Infinity)
    .map((t) => ({ kind: 'mine' as const, tileId: t.id, location: t.location, distance: distTo(t.location), available: t.coal }))
    .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
  if (mines.length > 0) return mines;
  const marketConnected = ['warrington', 'shrewsbury', 'nottingham', 'gloucester', 'oxford'].some((m) =>
    atNodes.some((n) => isConnected(state, n, m)),
  );
  if (!marketConnected) return [];
  const priceEach = state.coalMarket > 0 ? COAL_MARKET_PRICES[COAL_MARKET_CAPACITY - state.coalMarket] : COAL_FLOOR_PRICE;
  return [{ kind: 'market' as const, available: state.coalMarket > 0 ? state.coalMarket : Infinity, priceEach }];
}

export type IronCandidate =
  | { kind: 'works'; tileId: string; location: string; available: number }
  | { kind: 'market'; available: number; priceEach: number };

export function ironCandidates(state: BrassState): IronCandidate[] {
  const works = state.placedTiles
    .filter((t) => t.industry === 'iron' && !t.flipped && t.iron > 0)
    .map((t) => ({ kind: 'works' as const, tileId: t.id, location: t.location, available: t.iron }));
  if (works.length > 0) return works;
  const priceEach = state.ironMarket > 0 ? IRON_MARKET_PRICES[IRON_MARKET_CAPACITY - state.ironMarket] : IRON_FLOOR_PRICE;
  return [{ kind: 'market' as const, available: state.ironMarket > 0 ? state.ironMarket : Infinity, priceEach }];
}

export type BeerCandidate =
  | { kind: 'brewery'; tileId: string; location: string; owner: number; available: number }
  | { kind: 'merchant'; merchantSlotId: string; location: string; available: number; bonus: string };

export function beerCandidates(
  state: BrassState,
  player: number,
  count: number,
  opts: { soldTileLocation?: string; secondLinkEndpoints?: string[]; merchantSlotId?: string },
): BeerCandidate[] {
  if (count === 0) return [];
  const out: BeerCandidate[] = [];
  for (const tile of state.placedTiles) {
    if (tile.industry !== 'brewery' || tile.flipped || tile.beer <= 0) continue;
    if (tile.player === player) {
      out.push({ kind: 'brewery', tileId: tile.id, location: tile.location, owner: tile.player, available: tile.beer });
    } else {
      const ok = opts.secondLinkEndpoints
        ? opts.secondLinkEndpoints.some((e) => isConnected(state, tile.location, e))
        : opts.soldTileLocation
          ? isConnected(state, tile.location, opts.soldTileLocation)
          : false;
      if (ok) out.push({ kind: 'brewery', tileId: tile.id, location: tile.location, owner: tile.player, available: tile.beer });
    }
  }
  if (opts.merchantSlotId) {
    const m = state.merchantTiles.find((x) => x.slotId === opts.merchantSlotId);
    if (m && !m.blank && m.beer) {
      const bonus = MERCHANTS[m.location]?.bonus.type;
      out.push({ kind: 'merchant' as const, merchantSlotId: m.slotId, location: m.location, available: 1, bonus: bonus ?? '' });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 出售目标
// ---------------------------------------------------------------------------

export interface SellTarget {
  tileId: string;
  industry: IndustryType;
  level: number;
  location: string;
  beersToSell: number;
  incomeOnFlip: number;
  vp: number;
  merchants: { slotId: string; location: string; hasBeer: boolean; bonus: string }[];
}

export function sellTargets(state: BrassState, player: number): SellTarget[] {
  const targets: SellTarget[] = [];
  for (const tile of state.placedTiles) {
    if (tile.player !== player || tile.flipped) continue;
    if (tile.industry !== 'cotton' && tile.industry !== 'manufacturer' && tile.industry !== 'pottery') continue;
    const spec = tileSpec(tile.industry, tile.level);
    const merchants = state.merchantTiles
      .filter((m) => !m.blank && m.goods.includes(tile.industry as GoodsType) && isConnected(state, tile.location, m.location))
      .map((m) => ({
        slotId: m.slotId,
        location: m.location,
        hasBeer: m.beer,
        bonus: MERCHANTS[m.location] ? bonusLabel(MERCHANTS[m.location].bonus.type) : '',
      }));
    if (merchants.length === 0) continue;
    targets.push({
      tileId: tile.id,
      industry: tile.industry,
      level: tile.level,
      location: tile.location,
      beersToSell: spec.beersToSell,
      incomeOnFlip: spec.income,
      vp: spec.vp,
      merchants,
    });
  }
  return targets;
}

function bonusLabel(type: string): string {
  return type; // web 层本地化
}

// ---------------------------------------------------------------------------
// 其它
// ---------------------------------------------------------------------------

export interface NetworkOption {
  linkIndex: number;
  from: string;
  to: string;
  via?: string;
  cost: number;
  needsCoal: number;
  linkId: string;
}

export function networkOptions(state: BrassState, player: number): { options: NetworkOption[]; doubleAllowed: boolean; doubleCost: number } {
  const loose = hasNothingOnBoard(state, player);
  const options: NetworkOption[] = [];
  LINKS.forEach((def, linkIndex) => {
    const usable = state.era === 'canal' ? def.canal : def.rail;
    if (!usable) return;
    if (state.placedLinks.some((l) => l.linkIndex === linkIndex)) return;
    if (!loose && !linkEndpoints(def).some((n) => isInNetwork(state, player, n))) return;
    options.push({
      linkIndex,
      from: def.a,
      to: def.b,
      via: def.via,
      cost: state.era === 'canal' ? 3 : def.rail ? 5 : 0,
      needsCoal: state.era === 'rail' ? 1 : 0,
      linkId: def.id,
    });
  });
  return {
    options,
    doubleAllowed: state.era === 'rail',
    doubleCost: 15,
  };
}

export interface DevelopOption {
  industry: IndustryType;
  lowestLevel: number;
  lightbulb: boolean;
}

export function developOptions(state: BrassState, player: number): DevelopOption[] {
  const out: DevelopOption[] = [];
  for (const spec of TILE_SPECS) {
    const stack = state.players[player].mat[spec.industry];
    const lowest = stack && stack.length > 0 ? Math.min(...stack) : null;
    if (lowest === null) continue;
    out.push({ industry: spec.industry, lowestLevel: lowest, lightbulb: tileSpec(spec.industry, lowest).lightbulb });
  }
  // 按产业去重（每产业只关心当前最低级）。
  const seen = new Set<string>();
  return out.filter((o) => {
    const key = `${o.industry}:${o.lowestLevel}`;
    if (seen.has(o.industry)) return false;
    seen.add(o.industry);
    void key;
    return true;
  });
}

export function canScout(state: BrassState, player: number): boolean {
  const p = state.players[player];
  return (
    state.wildLocationArea > 0 &&
    state.wildIndustryArea > 0 &&
    !p.hand.includes('wild-location') &&
    !p.hand.includes('wild-industry') &&
    p.hand.length >= 3
  );
}

export function loanPreview(state: BrassState, player: number): { newLevel: number; allowed: boolean } {
  const level = incomeLevelAt(state.players[player].incomeSpace);
  return { newLevel: Math.max(-10, level - 3), allowed: level - 3 >= -10 };
}

export function ownedBoardTiles(state: BrassState, player: number): PlacedTile[] {
  return state.placedTiles.filter((t) => t.player === player);
}
