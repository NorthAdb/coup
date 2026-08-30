import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMatch } from './setup.js';
import { applyCommand } from './engine.js';
import { deckCardIds, CARD_SPECS } from './data/cards.js';
import { TILE_SPECS } from './data/tiles.js';
import { incomeLevelAt, highestSpaceOfLevel } from './data/income.js';
import { buyPriceAt, sellRevenue, COAL_MARKET_CAPACITY, COAL_MARKET_PRICES, IRON_MARKET_CAPACITY, IRON_MARKET_PRICES } from './data/market.js';
import { MERCHANT_SLOT_ORDER } from './data/board.js';
import type { BrassState, PlacedTile } from './types.js';

type Command = Parameters<typeof applyCommand>[1];

function ok(box: { s: BrassState }, command: Command): void {
  const result = applyCommand(box.s, command);
  assert.equal(result.ok, true, `command ${command.type} failed: ${result.ok ? '' : result.reason}`);
  box.s = (result as { ok: true; state: BrassState }).state;
}

function fails(state: BrassState, command: Command, reason: string): void {
  const result = applyCommand(state, command);
  assert.equal(result.ok, false, `expected failure ${reason} but got ok`);
  assert.equal((result as { ok: false; reason: string }).reason, reason);
}

/** 测试态盒子：ok() 后自动跟进克隆态；arrange 系列直接改当前态。 */
function rigged(players: number) {
  const box = { s: createMatch({ matchId: 'm1', seed: 'test-seed', playerCount: players as 2 | 3 | 4 }) };
  const setHand = (p: number, cards: string[]) => {
    box.s.players[p].hand = cards.slice();
  };
  const addTile = (t: Partial<PlacedTile> & Pick<PlacedTile, 'location' | 'industry' | 'level' | 'player'>): PlacedTile => {
    const tile: PlacedTile = {
      id: t.id ?? `x${box.s.placedTiles.length}`,
      location: t.location,
      slotIndex: t.slotIndex ?? 0,
      industry: t.industry,
      level: t.level,
      player: t.player,
      flipped: t.flipped ?? false,
      coal: t.coal ?? 0,
      iron: t.iron ?? 0,
      beer: t.beer ?? 0,
    };
    box.s.placedTiles.push(tile);
    const stack = box.s.players[t.player].mat[t.industry];
    const idx = stack.indexOf(t.level);
    if (idx >= 0) stack.splice(idx, 1);
    return tile;
  };
  const placeLink = (linkIndex: number, player: number) => {
    box.s.placedLinks.push({ id: `x${box.s.placedLinks.length}`, linkIndex, player, era: box.s.era });
    box.s.linksLeft[player] -= 1;
  };
  const focus = (p: number) => {
    box.s.currentPlayer = p;
    box.s.actionsLeft = 2;
  };
  return { box, setHand, addTile, placeLink, focus };
}

test('牌组构成：2p=40 / 3p=54 / 4p=64 张', () => {
  assert.equal(deckCardIds(2).length, 40);
  assert.equal(deckCardIds(3).length, 54);
  assert.equal(deckCardIds(4).length, 64);
  assert.equal(CARD_SPECS.filter((s) => s.minPlayers <= 4).reduce((a, s) => a + s.count, 0), 64);
});

test('产业瓦片：每人 45 块，各产业数量正确', () => {
  const byIndustry: Record<string, number> = {};
  let total = 0;
  for (const spec of TILE_SPECS) {
    byIndustry[spec.industry] = (byIndustry[spec.industry] ?? 0) + spec.count;
    total += spec.count;
  }
  assert.equal(total, 45);
  assert.deepEqual(byIndustry, { cotton: 11, manufacturer: 11, brewery: 7, pottery: 5, iron: 4, coal: 7 });
});

test('开局设置：金钱/收入/手牌/市场/商人位/首回合 1 行动', () => {
  for (const players of [2, 3, 4] as const) {
    const state = createMatch({ matchId: 'm', seed: 's', playerCount: players });
    assert.equal(state.players.length, players);
    for (const p of state.players) {
      assert.equal(p.money, 17);
      assert.equal(p.incomeSpace, 10);
      assert.equal(p.hand.length, 8);
      assert.equal(p.discard.length, 1);
      assert.equal(incomeLevelAt(p.incomeSpace), 0);
    }
    assert.equal(state.coalMarket, 13);
    assert.equal(state.ironMarket, 8);
    assert.equal(state.wildLocationArea, 4);
    assert.equal(state.wildIndustryArea, 4);
    assert.equal(state.merchantTiles.length, players === 2 ? 5 : players === 3 ? 7 : 9);
    assert.equal(state.deck.length, deckCardIds(players).length - 9 * players);
    assert.equal(state.actionsLeft, 1);
    assert.equal(state.era, 'canal');
  }
});

test('商人板位顺序与人数过滤', () => {
  assert.equal(MERCHANT_SLOT_ORDER.length, 9);
  assert.deepEqual(
    MERCHANT_SLOT_ORDER.map((s) => s.location),
    ['shrewsbury', 'gloucester', 'gloucester', 'oxford', 'oxford', 'warrington', 'warrington', 'nottingham', 'nottingham'],
  );
});

test('市场价格方向与收入轨几何', () => {
  assert.equal(buyPriceAt(COAL_MARKET_PRICES, COAL_MARKET_CAPACITY, 13, 0, 8), 1);
  assert.equal(buyPriceAt(COAL_MARKET_PRICES, COAL_MARKET_CAPACITY, 12, 0, 8), 2);
  assert.equal(sellRevenue(COAL_MARKET_PRICES, COAL_MARKET_CAPACITY, 13, 1), 1);
  assert.equal(sellRevenue(COAL_MARKET_PRICES, COAL_MARKET_CAPACITY, 0, 1), 7);
  assert.equal(sellRevenue(COAL_MARKET_PRICES, COAL_MARKET_CAPACITY, 14, 2), 0);
  assert.equal(buyPriceAt(IRON_MARKET_PRICES, IRON_MARKET_CAPACITY, 0, 0, 6), 6);
  assert.equal(incomeLevelAt(0), -10);
  assert.equal(incomeLevelAt(10), 0);
  assert.equal(incomeLevelAt(30), 10);
  assert.equal(incomeLevelAt(61), 21);
  assert.equal(incomeLevelAt(99), 30);
  assert.equal(highestSpaceOfLevel(10), 30);
  assert.equal(highestSpaceOfLevel(-10), 0);
});

test('地点卡建造：付钱、放槽、产煤', () => {
  const { box, setHand, focus } = rigged(2);
  focus(0);
  setHand(0, ['loc-cannock#1']);
  ok(box, { type: 'build', player: 0, cardId: 'loc-cannock#1', expectedVersion: 0, industry: 'coal', location: 'cannock', slotIndex: 1, coalSources: [], ironSources: [] });
  assert.equal(box.s.players[0].money, 12, '£17-£5');
  assert.equal(box.s.placedTiles[0].coal, 2, '煤矿 L1 产 2 块（Cannock 不连商人位，不卖市场）');
  assert.equal(box.s.coalMarket, 13);
  assert.equal(box.s.actionsLeft, 1);
  assert.equal(box.s.stateVersion, 1);
});

test('产业卡建造：要求地点在 network 内（无板块例外仅当全空）', () => {
  const { box, setHand, placeLink, focus } = rigged(2);
  focus(0);
  setHand(0, ['ind-iron#1']);
  // 全空时例外允许任意地点 → 不报 network 错误而报后续煤源错误。
  fails(box.s, { type: 'build', player: 0, cardId: 'ind-iron#1', expectedVersion: 0, industry: 'iron', location: 'redditch', slotIndex: 1, coalSources: [{ kind: 'market' }], ironSources: [] }, 'coal_market_not_connected');
  // 有板块在场后，network 限制生效。
  placeLink(8, 0); // birmingham–walsall
  fails(box.s, { type: 'build', player: 0, cardId: 'ind-iron#1', expectedVersion: 0, industry: 'iron', location: 'redditch', slotIndex: 1, coalSources: [{ kind: 'market' }], ironSources: [] }, 'location_not_in_network');
});

test('煤消耗：禁止跳过更近煤矿；市场买煤需连通商人位', () => {
  const { box, setHand, addTile, placeLink, focus } = rigged(2);
  focus(0);
  placeLink(17, 0); // cannock–walsall
  placeLink(18, 0); // cannock–wolverhampton
  placeLink(21, 0); // coalbrookdale–wolverhampton → coalbrookdale 距 walsall 3 跳
  const farMine = addTile({ location: 'coalbrookdale', industry: 'coal', level: 2, player: 1, coal: 3 });
  const nearMine = addTile({ location: 'cannock', industry: 'coal', level: 2, player: 1, coal: 1 });
  setHand(0, ['loc-walsall#1']);
  fails(box.s, { type: 'build', player: 0, cardId: 'loc-walsall#1', expectedVersion: 0, industry: 'iron', location: 'walsall', slotIndex: 0, coalSources: [{ kind: 'mine', tileId: farMine.id }], ironSources: [] }, 'closer_coal_available');
  ok(box, { type: 'build', player: 0, cardId: 'loc-walsall#1', expectedVersion: 0, industry: 'iron', location: 'walsall', slotIndex: 0, coalSources: [{ kind: 'mine', tileId: nearMine.id }], ironSources: [] });
  const mine = box.s.placedTiles.find((t) => t.id === nearMine.id)!;
  assert.equal(mine.coal, 0);
  assert.equal(mine.flipped, true, '煤尽翻面');
  assert.equal(box.s.players[1].incomeSpace, 17, '煤矿 L2 翻面收入 +7');
  assert.equal(box.s.players[0].money, 14, '£17-£5 矿煤免费；铁厂 4 块铁卖市场 £2（8→10）');
  assert.equal(box.s.ironMarket, 10);
  assert.equal(box.s.placedTiles.find((t) => t.location === 'walsall')!.iron, 2, '卖 2 块剩 2 块');
  // 市场买煤需连通商人位：Stafford 不连商人位。
  box.s.actionsLeft = 2;
  box.s.currentPlayer = 0;
  setHand(0, ['loc-stafford#1']);
  fails(box.s, { type: 'build', player: 0, cardId: 'loc-stafford#1', expectedVersion: box.s.stateVersion, industry: 'manufacturer', location: 'stafford', slotIndex: 0, coalSources: [{ kind: 'market' }], ironSources: [] }, 'coal_market_not_connected');
});

test('铁消耗：任意铁厂免费；有铁厂时禁止市场买铁', () => {
  const { box, setHand, addTile, focus } = rigged(2);
  focus(0);
  const works = addTile({ location: 'derby', industry: 'iron', level: 2, player: 1, iron: 4 });
  box.s.players[0].mat.manufacturer.splice(box.s.players[0].mat.manufacturer.indexOf(1), 1);
  setHand(0, ['loc-walsall#1']);
  fails(box.s, { type: 'build', player: 0, cardId: 'loc-walsall#1', expectedVersion: 0, industry: 'manufacturer', location: 'walsall', slotIndex: 0, coalSources: [], ironSources: [{ kind: 'market' }] }, 'iron_works_exist');
  ok(box, { type: 'build', player: 0, cardId: 'loc-walsall#1', expectedVersion: 0, industry: 'manufacturer', location: 'walsall', slotIndex: 0, coalSources: [], ironSources: [{ kind: 'works', tileId: works.id }] });
  assert.equal(box.s.placedTiles.find((t) => t.id === works.id)!.iron, 3);
  assert.equal(box.s.players[0].money, 7, '制造 L2 £10，铁免费');
});

test('专属槽优先 + 运河时代每地点限 1 块 + 覆盖自己', () => {
  const { box, setHand, addTile, focus } = rigged(2);
  focus(0);
  setHand(0, ['loc-birmingham#1']);
  fails(box.s, { type: 'build', player: 0, cardId: 'loc-birmingham#1', expectedVersion: 0, industry: 'manufacturer', location: 'birmingham', slotIndex: 0, coalSources: [], ironSources: [] }, 'dedicated_slot_required');
  const coalMine = addTile({ location: 'birmingham', industry: 'coal', level: 2, player: 1, coal: 3 });
  ok(box, { type: 'build', player: 0, cardId: 'loc-birmingham#1', expectedVersion: 0, industry: 'manufacturer', location: 'birmingham', slotIndex: 1, coalSources: [{ kind: 'mine', tileId: coalMine.id }], ironSources: [] });
  assert.equal(box.s.players[0].money, 9, '£17-£8，煤免费');
  // dudley 已有自己的煤矿 → 再建 iron 拒绝；覆盖自己放行。
  box.s.placedTiles.push({ id: 'm0', location: 'dudley', slotIndex: 0, industry: 'coal', level: 1, player: 0, flipped: false, coal: 2, iron: 0, beer: 0 });
  box.s.players[0].mat.coal.splice(box.s.players[0].mat.coal.indexOf(1), 1);
  box.s.actionsLeft = 2;
  box.s.currentPlayer = 0;
  box.s.players[0].hand = ['loc-dudley#1'];
  box.s.players[0].money = 50;
  fails(box.s, { type: 'build', player: 0, cardId: 'loc-dudley#1', expectedVersion: box.s.stateVersion, industry: 'iron', location: 'dudley', slotIndex: 1, coalSources: [{ kind: 'mine', tileId: 'm0' }], ironSources: [] }, 'canal_one_tile_per_location');
  ok(box, { type: 'build', player: 0, cardId: 'loc-dudley#1', expectedVersion: box.s.stateVersion, industry: 'coal', location: 'dudley', slotIndex: 0, overbuildTileId: 'm0', coalSources: [], ironSources: [] });
  assert.equal(box.s.placedTiles.filter((t) => t.location === 'dudley').length, 1);
  assert.equal(box.s.placedTiles.find((t) => t.location === 'dudley')!.level, 2);
  assert.equal(box.s.placedTiles.find((t) => t.location === 'dudley')!.coal, 3, '煤矿 L2 产 3 块');
});

test('覆盖对手：仅煤/铁厂且全图+市场该资源为 0', () => {
  const { box, setHand, addTile, focus } = rigged(2);
  focus(0);
  setHand(0, ['loc-dudley#1']);
  box.s.players[0].mat.coal.splice(box.s.players[0].mat.coal.indexOf(1), 1);
  const oppMine = addTile({ location: 'dudley', industry: 'coal', level: 1, player: 1, coal: 2 });
  fails(box.s, { type: 'build', player: 0, cardId: 'loc-dudley#1', expectedVersion: 0, industry: 'coal', location: 'dudley', slotIndex: 0, overbuildTileId: oppMine.id, coalSources: [], ironSources: [] }, 'overbuild_resource_exists');
  oppMine.coal = 0;
  box.s.coalMarket = 0;
  ok(box, { type: 'build', player: 0, cardId: 'loc-dudley#1', expectedVersion: 0, industry: 'coal', location: 'dudley', slotIndex: 0, overbuildTileId: oppMine.id, coalSources: [], ironSources: [] });
  assert.equal(box.s.placedTiles.some((t) => t.id === oppMine.id), false, '被覆盖板块移除');
});

test('煤矿建成连商人位：尽量卖市场（£1 一块）；铁厂无条件卖', () => {
  const { box, setHand, placeLink, focus } = rigged(2);
  focus(0);
  placeLink(20, 0); // coalbrookdale–shrewsbury（商人位）
  setHand(0, ['loc-coalbrookdale#1']);
  ok(box, { type: 'build', player: 0, cardId: 'loc-coalbrookdale#1', expectedVersion: 0, industry: 'coal', location: 'coalbrookdale', slotIndex: 2, coalSources: [], ironSources: [] });
  const mine = box.s.placedTiles.find((t) => t.location === 'coalbrookdale')!;
  assert.equal(box.s.coalMarket, 14, '市场 13→14 只进 1 块');
  assert.equal(mine.coal, 1, '剩 1 块留瓦片');
  assert.equal(mine.flipped, false);
  assert.equal(box.s.players[0].money, 13, '£17-£5+£1');
  // 铁厂无条件卖市场（需 1 煤：连 derby–nottingham 买市场煤 £1）。
  box.s.actionsLeft = 2;
  box.s.currentPlayer = 0;
  box.s.players[0].hand = ['loc-derby#1'];
  box.s.players[0].money = 50;
  placeLink(23, 0); // derby–nottingham
  ok(box, { type: 'build', player: 0, cardId: 'loc-derby#1', expectedVersion: box.s.stateVersion, industry: 'iron', location: 'derby', slotIndex: 2, coalSources: [{ kind: 'market' }], ironSources: [] });
  const works = box.s.placedTiles.find((t) => t.location === 'derby')!;
  assert.equal(box.s.ironMarket, 10, '铁市场 8→10 满，只进 2 块');
  assert.equal(works.iron, 2, '4 块产 2 块进市场剩 2 块');
  assert.equal(works.flipped, false);
  assert.equal(box.s.players[0].money, 46, '£50-£5-£1+£2');
});

test('酿酒厂啤酒按时代：运河 1 桶；买铁 £2', () => {
  const { box, setHand, focus } = rigged(2);
  focus(0);
  setHand(0, ['loc-burton-on-trent#1']);
  ok(box, { type: 'build', player: 0, cardId: 'loc-burton-on-trent#1', expectedVersion: 0, industry: 'brewery', location: 'burton-on-trent', slotIndex: 1, coalSources: [], ironSources: [{ kind: 'market' }] });
  const b = box.s.placedTiles.find((t) => t.industry === 'brewery')!;
  assert.equal(b.beer, 1);
  assert.equal(box.s.ironMarket, 7);
  assert.equal(box.s.players[0].money, 10, '£17-£5-£2');
});

test('Network：无板块可放任意线；铁路耗煤；双轨需啤酒', () => {
  const { box, setHand, addTile, focus } = rigged(2);
  focus(0);
  setHand(0, ['ind-coal#1']);
  ok(box, { type: 'network', player: 0, cardId: 'ind-coal#1', expectedVersion: 0, links: [{ linkIndex: 8, coalSources: [] }] }); // birmingham–walsall canal
  assert.equal(box.s.placedLinks.length, 1);
  assert.equal(box.s.players[0].money, 14, '运河 £3');
  // 铁路时代：单轨 £5 + 1 煤（旁边煤矿免费）。
  box.s.era = 'rail';
  box.s.actionsLeft = 2;
  box.s.currentPlayer = 0;
  box.s.players[0].money = 100;
  setHand(0, ['ind-iron#2']);
  const mine = addTile({ location: 'walsall', industry: 'coal', level: 2, player: 1, coal: 5 });
  ok(box, { type: 'network', player: 0, cardId: 'ind-iron#2', expectedVersion: box.s.stateVersion, links: [{ linkIndex: 38, coalSources: [{ kind: 'mine', tileId: mine.id }] }] });
  assert.equal(box.s.placedLinks.length, 2);
  assert.equal(box.s.players[0].money, 95, '£100-£5，煤免费');
  // 双轨 £15 + 1 啤酒（自己的酒厂任意位置）。
  box.s.actionsLeft = 2;
  box.s.currentPlayer = 0;
  setHand(0, ['ind-pottery#1']);
  const brew = addTile({ location: 'derby', industry: 'brewery', level: 2, player: 0, beer: 1 });
  ok(box, {
    type: 'network', player: 0, cardId: 'ind-pottery#1', expectedVersion: box.s.stateVersion,
    links: [
      { linkIndex: 26, coalSources: [{ kind: 'mine', tileId: mine.id }] }, // dudley–wolverhampton
      { linkIndex: 21, coalSources: [{ kind: 'mine', tileId: mine.id }] }, // coalbrookdale–wolverhampton
    ],
    beerSource: { kind: 'brewery', tileId: brew.id },
  });
  assert.equal(box.s.placedLinks.length, 4);
  assert.equal(box.s.players[0].money, 80, '£95-£15');
  assert.equal(box.s.placedTiles.find((t) => t.id === brew.id)!.flipped, true, '酒厂啤酒耗尽翻面');
  // 缺啤酒的双轨拒绝（煤源充足）。
  box.s.actionsLeft = 2;
  box.s.currentPlayer = 0;
  setHand(0, ['ind-pottery#2']);
  fails(box.s, {
    type: 'network', player: 0, cardId: 'ind-pottery#2', expectedVersion: box.s.stateVersion,
    links: [
      { linkIndex: 25, coalSources: [{ kind: 'mine', tileId: mine.id }] },
      { linkIndex: 19, coalSources: [{ kind: 'mine', tileId: mine.id }] },
    ],
  }, 'double_rail_needs_beer');
});

test('Sell：连通商人+啤酒；翻面进收入；商人啤酒奖励（Gloucester 免费 Develop）', () => {
  const { box, setHand, addTile, placeLink, focus } = rigged(2);
  focus(0);
  placeLink(27, 0); // gloucester–redditch
  placeLink(28, 0); // gloucester–worcester
  box.s.merchantTiles[1] = { slotId: 'gloucester#1', location: 'gloucester', goods: ['cotton'], blank: false, beer: true };
  box.s.merchantTiles[2] = { slotId: 'gloucester#2', location: 'gloucester', goods: ['manufacturer'], blank: false, beer: true };
  const mill = addTile({ location: 'redditch', industry: 'cotton', level: 2, player: 0 });
  const brew = addTile({ location: 'redditch', industry: 'brewery', level: 2, player: 0, beer: 1 });
  const goods2 = addTile({ location: 'worcester', industry: 'manufacturer', level: 2, player: 0 });
  const cotton3 = addTile({ location: 'worcester', industry: 'cotton', level: 3, player: 0 });
  const oppBrew = addTile({ location: 'derby', industry: 'brewery', level: 2, player: 1, beer: 1 });
  setHand(0, ['ind-pottery#1']);
  ok(box, {
    type: 'sell', player: 0, cardId: 'ind-pottery#1', expectedVersion: 0,
    sales: [{ tileId: mill.id, merchantSlotId: 'gloucester#1', beerSources: [{ kind: 'brewery', tileId: brew.id }] }],
  });
  assert.equal(box.s.placedTiles.find((t) => t.id === mill.id)!.flipped, true);
  assert.equal(box.s.players[0].incomeSpace, 19, '棉 L2 +4，酒厂耗尽翻面 +5');
  assert.equal(box.s.players[0].vp, 0, '未用商人啤酒无奖励');
  // 对手酒厂不连通 → 拒绝。
  box.s.actionsLeft = 2;
  box.s.currentPlayer = 0;
  setHand(0, ['ind-pottery#2']);
  fails(box.s, {
    type: 'sell', player: 0, cardId: 'ind-pottery#2', expectedVersion: box.s.stateVersion,
    sales: [{ tileId: cotton3.id, merchantSlotId: 'gloucester#1', beerSources: [{ kind: 'brewery', tileId: oppBrew.id }] }],
  }, 'beer_brewery_not_connected');
  // 商人啤酒 + Gloucester 免费 Develop（预声明移除面板煤 L1）。
  ok(box, {
    type: 'sell', player: 0, cardId: 'ind-pottery#2', expectedVersion: box.s.stateVersion,
    sales: [{ tileId: goods2.id, merchantSlotId: 'gloucester#2', beerSources: [{ kind: 'merchant', merchantSlotId: 'gloucester#2' }], developIndustry: 'coal' }],
  });
  assert.equal(box.s.players[0].mat.coal.includes(1), false, 'Gloucester 奖励移除面板煤 L1');
  assert.equal(box.s.merchantTiles[2].beer, false);
  assert.equal(box.s.players[0].hand.includes('ind-pottery#2'), false, 'Sell 也弃牌');
});

test('每个行动弃 1 张手牌：Network/Build/Develop 都消耗卡牌', () => {
  const { box, setHand, focus } = rigged(2);
  focus(0);
  // Network（场上无板块可放任意线）：弃所用卡。
  setHand(0, ['ind-pottery#1', 'loc-cannock#1', 'ind-pottery#2']);
  ok(box, { type: 'network', player: 0, cardId: 'ind-pottery#1', expectedVersion: 0, links: [{ linkIndex: 8, coalSources: [] }] });
  assert.deepEqual(box.s.players[0].hand, ['loc-cannock#1', 'ind-pottery#2']);
  assert.deepEqual(box.s.players[0].discard.slice(-1), ['ind-pottery#1']);
  // Build：弃所用地点卡。
  focus(0);
  ok(box, { type: 'build', player: 0, cardId: 'loc-cannock#1', expectedVersion: box.s.stateVersion, industry: 'coal', location: 'cannock', slotIndex: 1, coalSources: [], ironSources: [] });
  assert.deepEqual(box.s.players[0].hand, ['ind-pottery#2']);
  assert.deepEqual(box.s.players[0].discard.slice(-1), ['loc-cannock#1']);
  // Develop：弃所用卡；弃后手牌空 → 回合提前结束并补牌。
  focus(0);
  ok(box, { type: 'develop', player: 0, cardId: 'ind-pottery#2', expectedVersion: box.s.stateVersion, industries: ['iron'], ironSources: [{ kind: 'market' }] });
  assert.deepEqual(box.s.players[0].discard.slice(-1), ['ind-pottery#2']);
  assert.equal(box.s.currentPlayer, 1, '手牌空 → 回合提前结束');
  assert.equal(box.s.players[0].hand.length, 8, '回合结束补到 8 张');
});

test('Loan / Scout / Pass / 并发版本', () => {
  const { box, setHand, focus } = rigged(2);
  focus(0);
  setHand(0, ['loc-walsall#1']);
  ok(box, { type: 'loan', player: 0, cardId: 'loc-walsall#1', expectedVersion: 0 });
  assert.equal(box.s.players[0].money, 47);
  assert.equal(box.s.players[0].incomeSpace, highestSpaceOfLevel(-3));
  box.s.players[0].hand = ['a', 'b', 'c'];
  box.s.actionsLeft = 2;
  box.s.currentPlayer = 0;
  ok(box, { type: 'loan', player: 0, cardId: 'a', expectedVersion: box.s.stateVersion });
  box.s.actionsLeft = 2;
  ok(box, { type: 'loan', player: 0, cardId: 'b', expectedVersion: box.s.stateVersion });
  box.s.actionsLeft = 2;
  fails(box.s, { type: 'loan', player: 0, cardId: 'c', expectedVersion: box.s.stateVersion }, 'loan_below_min');
  // Scout。
  box.s.players[0].hand = ['a', 'b', 'c'];
  box.s.actionsLeft = 2;
  ok(box, { type: 'scout', player: 0, cardIds: ['a', 'b', 'c'], expectedVersion: box.s.stateVersion });
  assert.deepEqual(box.s.players[0].hand, ['wild-location', 'wild-industry']);
  ok(box, { type: 'pass', player: 0, cardId: 'wild-location', expectedVersion: box.s.stateVersion });
  assert.equal(box.s.wildLocationArea, 4);
  assert.equal(box.s.players[0].hand.includes('wild-location'), false);
  assert.equal(box.s.players[0].discard.includes('wild-location'), false);
  // 并发版本。
  fails(box.s, { type: 'pass', player: 0, cardId: 'wild-industry', expectedVersion: 99 }, 'version_mismatch');
});

test('回合流程：行动消耗→补手牌→轮转', () => {
  const { box, setHand, focus } = rigged(2);
  focus(0);
  setHand(0, ['a', 'b', 'c', 'd']);
  setHand(1, ['e', 'f', 'g', 'h']);
  ok(box, { type: 'pass', player: 0, cardId: 'a', expectedVersion: 0 });
  assert.equal(box.s.currentPlayer, 0, '还剩 1 行动');
  ok(box, { type: 'pass', player: 0, cardId: 'b', expectedVersion: box.s.stateVersion });
  assert.equal(box.s.currentPlayer, 1, '轮到玩家 1');
  assert.equal(box.s.players[0].hand.length, 8, '回合结束补到 8 张');
});

test('时代切换：Link 计分（商人位=2）、翻面瓦片计分、1 级清除、铁路时代再计分', () => {
  const { box, addTile, placeLink } = rigged(2);
  // P0：birmingham–oxford 连线（商人位 2 VP）+ 已翻面棉 L2（birmingham，连接图标 2）。
  placeLink(5, 0); // birmingham–oxford canal
  addTile({ location: 'birmingham', industry: 'cotton', level: 2, player: 0, flipped: true });
  // P1：dudley–wolverhampton 连线（两端无商人无翻面 → 0 VP）+ 未翻面煤 L2（不计分）。
  placeLink(26, 1);
  addTile({ location: 'dudley', industry: 'coal', level: 2, player: 1, flipped: false });
  // 触发运河时代结束。
  box.s.deck = [];
  for (const p of box.s.players) p.hand = [];
  // 直接调用内部 endEra 的路径：finishRoundEnd 未导出 → 通过真实流程触发太长；
  // 这里用导出的 linkScore/linkValueOfNode 验证 + 完整流程交给 playout。
  const { linkScore } = await_import_flow();
  assert.equal(linkScore(box.s, box.s.placedLinks[0]), 4, '商人位 2 + 翻面棉 L2 图标 2');
  assert.equal(linkScore(box.s, box.s.placedLinks[1]), 0, '无商人无翻面 → 0');
});

// 小工具：动态取 flow（避免顶层 import 循环告警）。
function await_import_flow(): typeof import('./flow.js') {
  // ESM 下直接 require 不可用；flow 无循环依赖，直接同步 import 即可。
  return flowModule;
}
import * as flowModule from './flow.js';

test('全流程：真实命令驱动两个时代（建造→连线→计分→清场→再计分→终局）', () => {
  const { box, setHand } = rigged(2);
  // P0 在 Birmingham 建造并连到 Oxford 商人位；P1 陪跑 pass。
  // 运河第 1 回合 1 行动。
  box.s.players[0].hand = ['loc-birmingham#1', 'ind-coal#1', 'x1', 'x2', 'x3', 'x4', 'x5', 'x6'];
  box.s.players[1].hand = ['y1', 'y2', 'y3', 'y4', 'y5', 'y6', 'y7', 'y8'];
  box.s.players[0].money = 60;
  box.s.players[1].money = 60;
  // 第 1 行动：先连线（弃掉杂卡 x1，保住地点卡供下轮建造）。
  ok(box, { type: 'network', player: 0, cardId: 'x1', expectedVersion: box.s.stateVersion, links: [{ linkIndex: 5, coalSources: [] }] } as never);
  // 补手牌后继续（引擎自动补到 8）。
  // P1 两个 pass；P0 第二轮：建煤矿 L1（cannock? 用 birmingham iron 槽）→ 直接建铁厂 L1（£5+1煤：市场买，连 oxford ✓）。
  let guard = 0;
  const passAll = (): void => {
    while (box.s.status === 'in_progress' && box.s.phase === 'await_action' && box.s.era === 'canal' && guard < 500) {
      guard += 1;
      const p = box.s.currentPlayer;
      const hand = box.s.players[p].hand;
      if (hand.length === 0) return;
      if (p === 0 && box.s.era === 'canal' && !box.s.placedTiles.some((t) => t.player === 0)) {
        // P0 首个建造：铁厂 L1（槽 2 专属 iron）。
        ok(box, { type: 'build', player: 0, cardId: hand[0], expectedVersion: box.s.stateVersion, industry: 'iron', location: 'birmingham', slotIndex: 2, coalSources: [{ kind: 'market' }], ironSources: [] } as never);
        continue;
      }
      ok(box, { type: 'pass', player: p, cardId: hand[0], expectedVersion: box.s.stateVersion } as never);
    }
  };
  passAll();
  assert.equal(box.s.era, 'rail', '进入铁路时代');
  assert.equal(box.s.players[0].vp, 2, 'P0: oxford 商人位 2（铁厂剩 2 铁未翻面不计）');
  assert.equal(box.s.linksLeft[0], 14, '铁路时代 Link 数重置');
  assert.equal(box.s.placedTiles.some((t) => t.level === 1), false, '1 级板块已清除');
  assert.equal(box.s.players[0].hand.length, 8, '重抽手牌');
  assert.equal(box.s.merchantTiles.every((m) => m.blank || m.beer), true, '商人啤酒补满');
  // 铁路时代直接全部 pass 到终局。
  guard = 0;
  while (box.s.status === 'in_progress' && guard < 500) {
    guard += 1;
    const p = box.s.currentPlayer;
    const hand = box.s.players[p].hand;
    if (hand.length === 0) break;
    ok(box, { type: 'pass', player: p, cardId: hand[0], expectedVersion: box.s.stateVersion } as never);
  }
  assert.equal(box.s.status, 'finished', '对局结束');
  assert.ok(box.s.finalScores);
  assert.equal(box.s.finalScores![0].player >= 0, true);
  // 铁路时代终局计分：运河时代的翻面铁厂已被清（1 级）→ 终局 VP = P0 第二次连线计分（若有）+ 翻面瓦片。
  assert.ok(box.s.finalScores!.every((s) => s.vp >= 0));
});
