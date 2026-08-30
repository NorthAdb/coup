import type {
  ApplyResult,
  BeerSource,
  BrassCommand,
  BrassState,
  CoalSource,
  GoodsType,
  IndustryType,
  IronSource,
  PlacedMerchant,
  PlacedTile,
} from './types.js';
import { LOCATIONS, MERCHANTS, LINKS, linkEndpoints } from './data/board.js';
import { tileSpec } from './data/tiles.js';
import {
  COAL_MARKET_PRICES,
  COAL_MARKET_CAPACITY,
  COAL_FLOOR_PRICE,
  IRON_MARKET_PRICES,
  IRON_MARKET_CAPACITY,
  IRON_FLOOR_PRICE,
  buyPriceAt,
  sellableCount,
  sellRevenue,
} from './data/market.js';
import { advanceIncome, highestSpaceOfLevel, incomeLevelAt } from './data/income.js';
import { isConnected, isInNetwork, hasNothingOnBoard, distances } from './graph.js';
import { RuleError, err, log, cardFaceOf, afterActionConsumed, applyShortfallRemoval, flipTile } from './flow.js';

const MARKET_MERCHANTS = ['warrington', 'shrewsbury', 'nottingham', 'gloucester', 'oxford'];

function tileById(state: BrassState, tileId: string): PlacedTile {
  const tile = state.placedTiles.find((t) => t.id === tileId);
  if (!tile) err('tile_not_found');
  return tile;
}

function merchantBySlot(state: BrassState, slotId: string): PlacedMerchant {
  const m = state.merchantTiles.find((x) => x.slotId === slotId);
  if (!m) err('merchant_not_found');
  return m;
}

function requireOwnHand(state: BrassState, player: number, cardId: string): void {
  if (!state.players[player].hand.includes(cardId)) err('card_not_in_hand');
}

/** 弃牌：Wild 回抽牌区，其余进弃牌堆。 */
function discardCard(state: BrassState, player: number, cardId: string): void {
  const p = state.players[player];
  const idx = p.hand.indexOf(cardId);
  if (idx < 0) err('card_not_in_hand');
  p.hand.splice(idx, 1);
  if (cardId === 'wild-location') state.wildLocationArea += 1;
  else if (cardId === 'wild-industry') state.wildIndustryArea += 1;
  else p.discard.push(cardId);
}

/** 从面板取该产业最低级瓦片。 */
function takeLowestFromMat(state: BrassState, player: number, industry: IndustryType): number {
  const stack = state.players[player].mat[industry];
  if (!stack || stack.length === 0) err('no_tile_on_mat');
  const lowest = Math.min(...stack);
  stack.splice(stack.indexOf(lowest), 1);
  return lowest;
}

function lowestOnMat(state: BrassState, player: number, industry: IndustryType): number | null {
  const stack = state.players[player].mat[industry];
  if (!stack || stack.length === 0) return null;
  return Math.min(...stack);
}

// ---------------------------------------------------------------------------
// 资源消耗（在克隆态上边校验边应用；失败整体丢弃）
// ---------------------------------------------------------------------------

/**
 * 煤：最近连通未翻面煤矿优先（免费；距离分层强制——更近的全耗尽才能取更远）；
 * 市场购买仅在无任何连通未翻面煤矿时可用，且须连通任一商人位；市场空按 £8 兜底。
 * atNodes：消耗点（建造地点 / 铁路 Link 的端点集合），距离取到各点的最小值。
 */
function applyCoalConsumption(state: BrassState, atNodes: string[], sources: CoalSource[]): number {
  const distMaps = atNodes.map((n) => distances(state, n));
  const distTo = (node: string): number => Math.min(...distMaps.map((m) => m.get(node) ?? Infinity));

  const connectedMines = state.placedTiles.filter(
    (t) => t.industry === 'coal' && !t.flipped && t.coal > 0 && distTo(t.location) < Infinity,
  );
  const connectedTotal = connectedMines.reduce((sum, t) => sum + t.coal, 0);

  let cost = 0;
  const drawnPerMine = new Map<string, number>();
  for (const source of sources) {
    if (source.kind === 'mine') {
      const tile = tileById(state, source.tileId);
      if (tile.industry !== 'coal' || tile.flipped) err('coal_source_invalid');
      if (distTo(tile.location) === Infinity) err('coal_source_not_connected');
      const drawn = drawnPerMine.get(source.tileId) ?? 0;
      if (tile.coal - drawn <= 0) err('coal_source_empty');
      // 距离分层：本块取自距离 d 的矿，要求距离 < d 的连通煤矿煤量全为 0
      //（本命令中已计划从更近矿取的块计入已耗）。
      const d = distTo(tile.location);
      const closerAvailable = connectedMines
        .filter((t) => distTo(t.location) < d)
        .reduce((sum, t) => sum + t.coal, 0);
      const plannedFromCloser = sources.reduce((sum, s) => {
        if (s.kind !== 'mine' || s.tileId === source.tileId) return sum;
        const t = tileById(state, s.tileId);
        return sum + (distTo(t.location) < d ? 1 : 0);
      }, 0);
      if (closerAvailable - plannedFromCloser > 0) err('closer_coal_available');
      drawnPerMine.set(source.tileId, drawn + 1);
    } else {
      if (connectedTotal > 0) err('connected_mine_exists');
      if (!MARKET_MERCHANTS.some((m) => atNodes.some((n) => isConnected(state, n, m)))) {
        err('coal_market_not_connected');
      }
      cost += buyPriceAt(COAL_MARKET_PRICES, COAL_MARKET_CAPACITY, state.coalMarket, 0, COAL_FLOOR_PRICE);
      if (state.coalMarket > 0) state.coalMarket -= 1;
    }
  }
  for (const [tileId, drawn] of drawnPerMine) {
    const tile = tileById(state, tileId);
    tile.coal -= drawn;
    if (tile.coal === 0) flipTile(state, tileId);
  }
  return cost;
}

/** 铁：任意未翻面铁厂（无需连通）；市场仅当场上无任何未翻面铁厂；市场空按 £6 兜底。 */
function applyIronConsumption(state: BrassState, sources: IronSource[]): number {
  const anyWorks = state.placedTiles.some((t) => t.industry === 'iron' && !t.flipped && t.iron > 0);
  let cost = 0;
  const drawnPerWorks = new Map<string, number>();
  for (const source of sources) {
    if (source.kind === 'works') {
      const tile = tileById(state, source.tileId);
      if (tile.industry !== 'iron' || tile.flipped) err('iron_source_invalid');
      const drawn = drawnPerWorks.get(source.tileId) ?? 0;
      if (tile.iron - drawn <= 0) err('iron_source_empty');
      drawnPerWorks.set(source.tileId, drawn + 1);
    } else {
      if (anyWorks) err('iron_works_exist');
      cost += buyPriceAt(IRON_MARKET_PRICES, IRON_MARKET_CAPACITY, state.ironMarket, 0, IRON_FLOOR_PRICE);
      if (state.ironMarket > 0) state.ironMarket -= 1;
    }
  }
  for (const [tileId, drawn] of drawnPerWorks) {
    const tile = tileById(state, tileId);
    tile.iron -= drawn;
    if (tile.iron === 0) flipTile(state, tileId);
  }
  return cost;
}

/**
 * 啤酒：自己未翻面酒厂（全图任意）/ 对手未翻面酒厂（须与用酒处连通）/ 商人啤酒（仅限所卖向的那块板）。
 * opts.secondLinkEndpoints：双轨铁路的啤酒——对手酒厂须与第二条铁路（放置后）连通。
 */
function applyBeerConsumption(
  state: BrassState,
  player: number,
  count: number,
  sources: BeerSource[],
  opts: { soldTileLocation?: string; merchantSlotId?: string; secondLinkEndpoints?: string[] },
): { merchantBonuses: string[] } {
  if (sources.length !== count) err('beer_count_mismatch');
  const drawnPerBrewery = new Map<string, number>();
  const merchantBonuses: string[] = [];
  for (const source of sources) {
    if (source.kind === 'brewery') {
      const tile = tileById(state, source.tileId);
      if (tile.industry !== 'brewery' || tile.flipped) err('beer_source_invalid');
      const drawn = drawnPerBrewery.get(source.tileId) ?? 0;
      if (tile.beer - drawn <= 0) err('beer_source_empty');
      if (tile.player !== player) {
        const connectedOk = opts.secondLinkEndpoints
          ? opts.secondLinkEndpoints.some((e) => isConnected(state, tile.location, e))
          : opts.soldTileLocation
            ? isConnected(state, tile.location, opts.soldTileLocation)
            : false;
        if (!connectedOk) err('beer_brewery_not_connected');
      }
      drawnPerBrewery.set(source.tileId, drawn + 1);
    } else {
      if (!opts.merchantSlotId || source.merchantSlotId !== opts.merchantSlotId) err('merchant_beer_wrong_merchant');
      const m = merchantBySlot(state, source.merchantSlotId);
      if (m.blank || !m.beer) err('merchant_beer_unavailable');
      m.beer = false;
      merchantBonuses.push(m.location);
    }
  }
  for (const [tileId, drawn] of drawnPerBrewery) {
    const tile = tileById(state, tileId);
    tile.beer -= drawn;
    if (tile.beer === 0) flipTile(state, tileId);
  }
  return { merchantBonuses };
}

// ---------------------------------------------------------------------------
// 卡牌建造校验
// ---------------------------------------------------------------------------

function validateCardForBuild(state: BrassState, player: number, cardId: string, location: string, industry: IndustryType): void {
  const face = cardFaceOf(cardId);
  const locDef = LOCATIONS[location];
  if (!locDef) err('unknown_location');
  if (locDef.farm) {
    // 农场酒厂：只能用 Brewery 产业卡或 Wild Industry 卡；产业卡仍须满足 network 要求。
    const ok = (face.kind === 'industry' && face.industries.includes('brewery')) || face.kind === 'wild-industry';
    if (!ok) err('farm_needs_brewery_card');
    if (!isInNetwork(state, player, location) && !hasNothingOnBoard(state, player)) err('location_not_in_network');
    return;
  }
  if (face.kind === 'location') {
    if (face.location !== location) err('card_location_mismatch');
    return;
  }
  if (face.kind === 'wild-location') return;
  if (face.kind === 'industry' && !face.industries.includes(industry)) err('card_industry_mismatch');
  // 产业卡（含 Wild Industry）：地点须在 network 内；自己场上无任何板块时例外。
  if (!isInNetwork(state, player, location) && !hasNothingOnBoard(state, player)) {
    err('location_not_in_network');
  }
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function applyBuild(state: BrassState, command: Extract<BrassCommand, { type: 'build' }>): void {
  const { player, cardId, industry, location } = command;
  const locDef = LOCATIONS[location];
  if (!locDef) err('unknown_location');
  requireOwnHand(state, player, cardId);
  validateCardForBuild(state, player, cardId, location, industry);

  const lowestLevel = lowestOnMat(state, player, industry);
  if (lowestLevel === null) err('no_tile_on_mat');
  const spec = tileSpec(industry, lowestLevel);
  if (spec.eras === 'canalOnly' && state.era === 'rail') err('canal_only_tile');
  if (spec.eras === 'railOnly' && state.era === 'canal') err('rail_only_tile');

  let tile: PlacedTile;
  if (command.overbuildTileId) {
    const target = tileById(state, command.overbuildTileId);
    if (target.location !== location) err('overbuild_location_mismatch');
    if (target.industry !== industry) err('overbuild_industry_mismatch');
    if (target.level >= lowestLevel) err('overbuild_not_higher');
    if (target.player !== player) {
      if (industry !== 'coal' && industry !== 'iron') err('overbuild_opponent_limited');
      const cubes = state.placedTiles
        .filter((t) => t.industry === industry)
        .reduce((sum, t) => sum + (industry === 'coal' ? t.coal : t.iron), 0);
      const market = industry === 'coal' ? state.coalMarket : state.ironMarket;
      if (cubes + market > 0) err('overbuild_resource_exists');
    }
    // 被覆盖板块移出游戏（其资源退回公共供应）。
    state.placedTiles = state.placedTiles.filter((t) => t.id !== target.id);
    log(state, 'overbuild', player, {
      location,
      industry,
      level: lowestLevel,
      replaced: target.id,
      replacedOwner: target.player,
    });
    tile = {
      id: `t${state.stateVersion}b${player}-${industry}-${lowestLevel}-${target.slotIndex}`,
      location,
      slotIndex: target.slotIndex,
      industry,
      level: lowestLevel,
      player,
      flipped: false,
      coal: 0,
      iron: 0,
      beer: 0,
    };
    state.placedTiles.push(tile);
  } else {
    const slotIndex = command.slotIndex;
    const slot = locDef.slots[slotIndex];
    if (!slot || !slot.industries.includes(industry)) err('slot_mismatch');
    if (state.placedTiles.some((t) => t.location === location && t.slotIndex === slotIndex)) err('slot_occupied');
    // 放置优先级：存在空的专属槽（仅该产业图标）时必须放专属槽。
    const dedicatedEmpty = locDef.slots.some(
      (s, i) =>
        s.industries.length === 1 &&
        s.industries[0] === industry &&
        !state.placedTiles.some((t) => t.location === location && t.slotIndex === i),
    );
    if (dedicatedEmpty && slot.industries.length > 1) err('dedicated_slot_required');
    // 运河时代：每地点最多 1 块自己的板块。
    if (state.era === 'canal' && state.placedTiles.some((t) => t.location === location && t.player === player)) {
      err('canal_one_tile_per_location');
    }
    tile = {
      id: `t${state.stateVersion}b${player}-${industry}-${lowestLevel}-${slotIndex}`,
      location,
      slotIndex,
      industry,
      level: lowestLevel,
      player,
      flipped: false,
      coal: 0,
      iron: 0,
      beer: 0,
    };
    state.placedTiles.push(tile);
  }

  takeLowestFromMat(state, player, industry);

  let costs = 0;
  if (spec.costCoal > 0) {
    if (command.coalSources.length !== spec.costCoal) err('coal_count_mismatch');
    costs += applyCoalConsumption(state, [location], command.coalSources);
  } else if (command.coalSources.length > 0) {
    err('unexpected_coal');
  }
  if (spec.costIron > 0) {
    if (command.ironSources.length !== spec.costIron) err('iron_count_mismatch');
    costs += applyIronConsumption(state, command.ironSources);
  } else if (command.ironSources.length > 0) {
    err('unexpected_iron');
  }
  costs += spec.costMoney;
  const p = state.players[player];
  if (p.money < costs) err('insufficient_money');
  p.money -= costs;
  p.spent += costs;

  // 建成放置产出。
  if (industry === 'coal') tile.coal = spec.produces;
  if (industry === 'iron') tile.iron = spec.produces;
  if (industry === 'brewery') tile.beer = state.era === 'canal' ? 1 : 2;

  log(state, 'build', player, {
    location,
    industry,
    level: lowestLevel,
    money: spec.costMoney,
    overbuilt: command.overbuildTileId ? true : false,
  });

  // 建成即向市场卖（煤矿须连通任一商人位；铁厂无条件）；卖空立即翻面进收入。
  if (industry === 'coal' || industry === 'iron') {
    const connectedMerchant = industry === 'iron' || MARKET_MERCHANTS.some((m) => isConnected(state, location, m));
    if (connectedMerchant) {
      const onTile = industry === 'coal' ? tile.coal : tile.iron;
      const capacity = industry === 'coal' ? COAL_MARKET_CAPACITY : IRON_MARKET_CAPACITY;
      const count = industry === 'coal' ? state.coalMarket : state.ironMarket;
      const prices = industry === 'coal' ? COAL_MARKET_PRICES : IRON_MARKET_PRICES;
      const movable = sellableCount(capacity, count, onTile);
      if (movable > 0) {
        const revenue = sellRevenue(prices, capacity, count, onTile);
        if (industry === 'coal') {
          tile.coal -= movable;
          state.coalMarket += movable;
        } else {
          tile.iron -= movable;
          state.ironMarket += movable;
        }
        p.money += revenue;
        log(state, 'market_sell', player, { resource: industry, cubes: movable, revenue, location });
      }
      if ((industry === 'coal' ? tile.coal : tile.iron) === 0) flipTile(state, tile.id);
    }
  }

  discardCard(state, player, cardId);
  afterActionConsumed(state);
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

function applyNetwork(state: BrassState, command: Extract<BrassCommand, { type: 'network' }>): void {
  const { player, cardId } = command;
  requireOwnHand(state, player, cardId);
  if (state.linksLeft[player] < command.links.length) err('no_links_left');

  let costs = 0;
  if (state.era === 'canal') {
    if (command.links.length !== 1) err('canal_one_link');
    const def = LINKS[command.links[0].linkIndex];
    if (!def) err('unknown_link');
    if (!def.canal) err('not_a_canal_line');
    if (command.links[0].coalSources.length > 0) err('unexpected_coal');
    costs += 3;
  } else {
    if (command.links.length !== 1 && command.links.length !== 2) err('rail_link_count');
    for (const l of command.links) {
      const def = LINKS[l.linkIndex];
      if (!def) err('unknown_link');
      if (!def.rail) err('not_a_rail_line');
      if (l.coalSources.length !== 1) err('rail_needs_one_coal');
    }
    costs += command.links.length === 1 ? 5 : 15;
  }

  // 逐条放置（后一条的合法性依赖前一条已放置；煤在每条放置后判定连通）。
  const placedIds: number[] = [];
  let coalCost = 0;
  for (let i = 0; i < command.links.length; i++) {
    const { linkIndex, coalSources } = command.links[i];
    const def = LINKS[linkIndex];
    if (state.placedLinks.some((l) => l.linkIndex === linkIndex)) err('link_occupied');
    if (!hasNothingOnBoard(state, player)) {
      const eps = linkEndpoints(def);
      if (!eps.some((n) => isInNetwork(state, player, n))) err('link_not_adjacent_to_network');
    }
    state.placedLinks.push({ id: `l${state.stateVersion}n${player}-${linkIndex}`, linkIndex, player, era: state.era });
    state.linksLeft[player] -= 1;
    placedIds.push(linkIndex);
    if (state.era === 'rail') {
      coalCost += applyCoalConsumption(state, linkEndpoints(def), coalSources);
    }
  }

  // 铁路时代 2 条：£15 + 1 啤酒（必须酒厂；对手酒厂须与第二条放置后连通）。
  if (state.era === 'rail' && command.links.length === 2) {
    if (!command.beerSource) err('double_rail_needs_beer');
    const eps = linkEndpoints(LINKS[command.links[1].linkIndex]);
    applyBeerConsumption(state, player, 1, [command.beerSource], { secondLinkEndpoints: eps });
  } else if (command.beerSource) {
    err('unexpected_beer');
  }

  const p = state.players[player];
  if (p.money < costs + coalCost) err('insufficient_money');
  p.money -= costs + coalCost;
  p.spent += costs + coalCost;
  log(state, 'network', player, { links: placedIds.join(','), era: state.era, money: costs + coalCost });
  discardCard(state, player, cardId);
  afterActionConsumed(state);
}

// ---------------------------------------------------------------------------
// Develop
// ---------------------------------------------------------------------------

function applyDevelop(state: BrassState, command: Extract<BrassCommand, { type: 'develop' }>): void {
  const { player, cardId } = command;
  requireOwnHand(state, player, cardId);
  if (command.industries.length < 1 || command.industries.length > 2) err('develop_count');
  if (new Set(command.industries).size !== command.industries.length) err('develop_duplicate');

  const removed: string[] = [];
  for (const industry of command.industries) {
    const stack = state.players[player].mat[industry];
    if (!stack || stack.length === 0) err('no_tile_on_mat');
    const lowest = Math.min(...stack);
    if (tileSpec(industry, lowest).lightbulb) err('lightbulb_cannot_develop');
    removed.push(`${industry}:${lowest}`);
    stack.splice(stack.indexOf(lowest), 1);
  }
  if (command.ironSources.length !== command.industries.length) err('iron_count_mismatch');

  const ironCost = applyIronConsumption(state, command.ironSources);
  const p = state.players[player];
  if (p.money < ironCost) err('insufficient_money');
  p.money -= ironCost;
  p.spent += ironCost;
  log(state, 'develop', player, { removed: removed.join(','), iron: command.ironSources.length, money: ironCost });
  discardCard(state, player, cardId);
  afterActionConsumed(state);
}

// ---------------------------------------------------------------------------
// Sell
// ---------------------------------------------------------------------------

function applySell(state: BrassState, command: Extract<BrassCommand, { type: 'sell' }>): void {
  const { player, cardId } = command;
  requireOwnHand(state, player, cardId);
  if (command.sales.length < 1) err('sell_empty');

  const merchantBeerUsed = new Set<string>();
  for (const sale of command.sales) {
    const tile = tileById(state, sale.tileId);
    if (tile.player !== player) err('not_your_tile');
    if (tile.flipped) err('tile_already_flipped');
    if (tile.industry !== 'cotton' && tile.industry !== 'manufacturer' && tile.industry !== 'pottery') {
      err('not_sellable');
    }
    const m = merchantBySlot(state, sale.merchantSlotId);
    if (m.blank) err('merchant_blank');
    if (!m.goods.includes(tile.industry as GoodsType)) err('merchant_does_not_accept');
    if (!isConnected(state, tile.location, m.location)) err('merchant_not_connected');
    if (sale.beerSources.some((s) => s.kind === 'merchant')) {
      if (merchantBeerUsed.has(sale.merchantSlotId)) err('merchant_beer_reused');
      merchantBeerUsed.add(sale.merchantSlotId);
    }
    if (sale.developIndustry) {
      // 预声明的 Gloucester 免费研发目标必须合法。
      const lowest = lowestOnMat(state, player, sale.developIndustry);
      if (lowest === null) err('no_tile_on_mat');
      if (tileSpec(sale.developIndustry, lowest).lightbulb) err('lightbulb_cannot_develop');
    }
  }

  for (const sale of command.sales) {
    const tile = tileById(state, sale.tileId);
    const spec = tileSpec(tile.industry, tile.level);
    const { merchantBonuses } = applyBeerConsumption(state, player, spec.beersToSell, sale.beerSources, {
      soldTileLocation: tile.location,
      merchantSlotId: sale.merchantSlotId,
    });
    for (const merchantLoc of merchantBonuses) {
      applyMerchantBeerBonus(state, player, merchantLoc, sale.developIndustry);
    }
    flipTile(state, tile.id);
    log(state, 'sell', player, {
      tileId: tile.id,
      industry: tile.industry,
      level: tile.level,
      merchant: sale.merchantSlotId,
    });
  }

  discardCard(state, player, cardId);
  afterActionConsumed(state);
}

function applyMerchantBeerBonus(state: BrassState, player: number, merchantLoc: string, developIndustry?: IndustryType): void {
  const def = MERCHANTS[merchantLoc];
  if (!def) err('unknown_merchant');
  const p = state.players[player];
  switch (def.bonus.type) {
    case 'vp':
      p.vp += def.bonus.amount;
      break;
    case 'money':
      p.money += def.bonus.amount;
      break;
    case 'income':
      p.incomeSpace = advanceIncome(p.incomeSpace, def.bonus.amount);
      break;
    case 'develop': {
      if (!developIndustry) err('gloucester_develop_required');
      takeLowestFromMat(state, player, developIndustry);
      break;
    }
  }
  log(state, 'merchant_bonus', player, { merchant: merchantLoc, bonus: def.bonus.type, industry: developIndustry ?? '' });
}

// ---------------------------------------------------------------------------
// Loan / Scout / Pass
// ---------------------------------------------------------------------------

function applyLoan(state: BrassState, command: Extract<BrassCommand, { type: 'loan' }>): void {
  const { player, cardId } = command;
  requireOwnHand(state, player, cardId);
  const p = state.players[player];
  const level = incomeLevelAt(p.incomeSpace);
  if (level - 3 < -10) err('loan_below_min');
  p.money += 30;
  p.incomeSpace = highestSpaceOfLevel(level - 3);
  log(state, 'loan', player, { newLevel: level - 3 });
  discardCard(state, player, cardId);
  afterActionConsumed(state);
}

function applyScout(state: BrassState, command: Extract<BrassCommand, { type: 'scout' }>): void {
  const { player } = command;
  if (command.cardIds.length !== 3) err('scout_card_count');
  const p = state.players[player];
  if (p.hand.includes('wild-location') || p.hand.includes('wild-industry')) err('scout_with_wild');
  if (state.wildLocationArea < 1 || state.wildIndustryArea < 1) err('no_wild_cards');
  if (new Set(command.cardIds).size !== 3) err('scout_card_count');
  for (const cardId of command.cardIds) {
    if (!p.hand.includes(cardId)) err('card_not_in_hand');
  }
  for (const cardId of command.cardIds) discardCard(state, player, cardId);
  state.wildLocationArea -= 1;
  state.wildIndustryArea -= 1;
  p.hand.push('wild-location', 'wild-industry');
  log(state, 'scout', player, {});
  afterActionConsumed(state);
}

function applyPass(state: BrassState, command: Extract<BrassCommand, { type: 'pass' }>): void {
  requireOwnHand(state, command.player, command.cardId);
  discardCard(state, command.player, command.cardId);
  log(state, 'pass', command.player, {});
  afterActionConsumed(state);
}

// ---------------------------------------------------------------------------
// 入口：克隆-应用-回滚
// ---------------------------------------------------------------------------

export function applyCommand(state: BrassState, command: BrassCommand): ApplyResult {
  if (state.status === 'finished') return { ok: false, reason: 'match_finished' };
  if (command.expectedVersion !== state.stateVersion) return { ok: false, reason: 'version_mismatch' };
  const next: BrassState = structuredClone(state);
  try {
    dispatch(next, command);
  } catch (e) {
    if (e instanceof RuleError) return { ok: false, reason: e.reason };
    throw e;
  }
  next.stateVersion += 1;
  const events = next.log.slice(state.log.length);
  return { ok: true, state: next, events };
}

function dispatch(state: BrassState, command: BrassCommand): void {
  if (!Number.isInteger(command.player) || command.player < 0 || command.player >= state.playerCount) {
    err('unknown_player');
  }
  if (state.phase === 'await_shortfall_removal') {
    if (command.type !== 'shortfall_removal') err('phase_shortfall');
    if (command.player !== state.shortfall?.player) err('not_your_turn');
    applyShortfallRemoval(state, command.tileId);
    return;
  }
  if (command.type === 'shortfall_removal') err('phase_action');
  if (command.player !== state.currentPlayer) err('not_your_turn');
  if (state.actionsLeft <= 0) err('no_actions_left');
  switch (command.type) {
    case 'pass':
      applyPass(state, command);
      break;
    case 'build':
      applyBuild(state, command);
      break;
    case 'network':
      applyNetwork(state, command);
      break;
    case 'develop':
      applyDevelop(state, command);
      break;
    case 'sell':
      applySell(state, command);
      break;
    case 'loan':
      applyLoan(state, command);
      break;
    case 'scout':
      applyScout(state, command);
      break;
    default:
      err('unknown_command');
  }
}
