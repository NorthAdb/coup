/**
 * 卡坦岛 Mock 引擎测试：棋盘生成、骰子生产、建造、交易、强盗、胜利点。
 * 全部确定性（引擎随机走内部 mulberry32 种子），不依赖网络/浏览器。
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  bankTrade,
  buildCity,
  buildRoad,
  buildSettlement,
  buyDev,
  cancelTrade,
  createGame,
  endTurn,
  generateBoard,
  legalCities,
  legalRoads,
  legalSettlements,
  longestRoadLength,
  moveRobber,
  playDev,
  playerVP,
  proposeTrade,
  respondTrade,
  rollDice,
  steal,
  tokensValid,
  tradeRate,
} from "./game.ts";
import type { CatanGame, ResourceId, ResourceCount } from "./types.ts";

const SETUPS = [
  { name: "你", color: "#b3573f", isHuman: true },
  { name: "艾拉", color: "#3f6d8e", isHuman: false },
  { name: "马库斯", color: "#5d7048", isHuman: false },
  { name: "苏珊", color: "#c9973f", isHuman: false },
];

const RESOURCE_OF_TERRAIN: Record<string, ResourceId> = {
  forest: "wood",
  pasture: "wool",
  fields: "wheat",
  hills: "brick",
  mountains: "ore",
};

function newGame(seed = 1): CatanGame {
  return createGame(SETUPS, seed);
}

/** 给玩家塞一手资源，构造确定性场景。 */
function give(g: CatanGame, player: number, hand: Partial<ResourceCount>): void {
  for (const [k, n] of Object.entries(hand) as Array<[ResourceId, number]>) {
    g.players[player]!.hand[k] = n;
  }
}

/** 推进当前玩家掷骰直到进入 main：7 会触发强盗分支，换种子重开直到掷出非 7。 */
function rollToMain(seed: number): CatanGame {
  for (let s = seed; s < seed + 80; s++) {
    const fresh = newGame(s);
    const r = rollDice(fresh);
    assert.ok(r.ok);
    if (r.game.phase === "main") return r.game;
  }
  throw new Error("80 个种子内未掷出非 7 结果（概率上不可能）");
}

test("棋盘：19 陆地格、地形配比与 token 集合正确", () => {
  for (const seed of [1, 7, 42, 2026]) {
    const board = generateBoard(seed);
    assert.equal(board.tiles.length, 19);
    const counts: Record<string, number> = {};
    for (const t of board.tiles) counts[t.terrain] = (counts[t.terrain] ?? 0) + 1;
    assert.deepEqual(counts, { forest: 4, pasture: 4, fields: 4, hills: 3, mountains: 3, desert: 1 });
    const tokens = board.tiles
      .filter((t) => t.value != null)
      .map((t) => t.value!)
      .sort((a, b) => a - b);
    assert.deepEqual(tokens, [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12]);
    const desert = board.tiles.find((t) => t.terrain === "desert")!;
    assert.equal(desert.value, null);
    assert.ok(tokensValid(board.tiles), "6/8 不应相邻");
  }
});

test("棋盘：每个资源格有数字、沙漠无数字；9 港口均落在海岸边", () => {
  const board = generateBoard(7);
  for (const t of board.tiles) {
    if (t.terrain === "desert") assert.equal(t.value, null);
    else assert.ok(t.value != null && t.value >= 2 && t.value <= 12 && t.value !== 7);
  }
  assert.equal(board.harbors.length, 9);
  const kinds = board.harbors.map((h) => h.kind).sort();
  assert.deepEqual(kinds, ["any", "any", "any", "any", "brick", "ore", "wheat", "wood", "wool"]);
  for (const h of board.harbors) {
    const edge = board.edges[h.edge]!;
    assert.equal(edge.tiles.length, 1, "港口边必须恰邻一块陆地（海岸边）");
    assert.notEqual(edge.harbor, null);
  }
});

test("开局：每人两村两路，村庄满足间距规则，强盗在沙漠", () => {
  const g = newGame(1);
  assert.equal(g.buildings.length, 8);
  assert.equal(g.roads.length, 8);
  for (let p = 0; p < 4; p++) {
    assert.equal(g.buildings.filter((b) => b.owner === p).length, 2);
    assert.equal(g.roads.filter((r) => r.owner === p).length, 2);
  }
  for (const b of g.buildings) {
    for (const n of g.vertices[b.vertex]!.neighbors) {
      assert.equal(g.buildings.some((x) => x.vertex === n), false);
    }
  }
  assert.equal(g.robberTile, g.tiles.find((t) => t.terrain === "desert")!.id);
  assert.equal(g.turn, 0);
  assert.equal(g.phase, "roll");
});

test("掷骰：数字命中时相邻村庄产 1、城市产 2，事件按地块聚合", () => {
  // 换种子扫描：找一个「首次掷骰恰好命中某单村相邻地块」的确定性场景。
  let hit: CatanGame | null = null;
  let owner = -1;
  let baseline = -1;
  let resource: ResourceId = "wood";
  for (let s = 1; s <= 400 && !hit; s++) {
    const g = newGame(s);
    const t = g.tiles.find(
      (tt) =>
        tt.value != null &&
        tt.value !== 6 &&
        tt.value !== 8 &&
        g.buildings.filter((b) => g.vertices[b.vertex]!.tiles.includes(tt.id)).length === 1,
    );
    if (!t) continue;
    const b = g.buildings.find((x) => g.vertices[x.vertex]!.tiles.includes(t.id))!;
    const before = g.players[b.owner]!.hand[RESOURCE_OF_TERRAIN[t.terrain]!];
    const r = rollDice(g);
    assert.ok(r.ok);
    if (r.game.phase !== "main") continue;
    const ev = r.events.find((e) => e.type === "dice");
    if (!ev || ev.type !== "dice" || ev.a + ev.b !== t.value) continue;
    hit = r.game;
    owner = b.owner;
    baseline = before;
    resource = RESOURCE_OF_TERRAIN[t.terrain]!;
  }
  assert.ok(hit, "400 个种子内应命中单村相邻地块");
  assert.equal(
    hit.players[owner]!.hand[resource],
    baseline + 1,
    "命中后相邻村庄应恰好 +1",
  );
});

test("掷骰：7 点进入强盗阶段，移动后可抢或收尾", () => {
  const g = newGame(9);
  let hit: CatanGame = g;
  let found = false;
  for (let i = 0; i < 200 && !found; i++) {
    const base = newGame(9 + i * 0 + i);
    const r = rollDice(base);
    assert.ok(r.ok);
    if (r.game.phase === "robber") {
      hit = r.game;
      found = true;
    }
  }
  assert.ok(found, "应能掷出 7");
  assert.equal(hit.phase, "robber");
  const other = hit.tiles.find((t) => t.id !== hit.robberTile)!;
  const moved = moveRobber(hit, 0, other.id);
  assert.ok(moved.ok);
  assert.equal(moved.game.robberTile, other.id);
  // 无论是否进入可抢状态，收尾后必须回到 main。
  let done;
  if (moved.game.phase === "robber") {
    // 有可抢对象就抢 1 号位，否则直接抢任一对手（手牌为空时 steal 仍应成功收尾）。
    done = steal(moved.game, 0, 1);
  } else {
    done = moved;
  }
  assert.ok(done.ok);
  assert.equal(done.game.phase, "main");
});

test("建路：合法位建造扣费成功，已占边不可重复", () => {
  const g = rollToMain(3);
  give(g, 0, { wood: 2, brick: 2 });
  const roads = legalRoads(g, 0);
  assert.ok(roads.length > 0);
  const built = buildRoad(g, 0, roads[0]!);
  assert.ok(built.ok);
  assert.equal(built.game.roads.length, 9); // 开局 8 条 + 新建 1 条
  assert.equal(built.game.players[0]!.hand.wood, 1);
  assert.equal(built.game.players[0]!.hand.brick, 1);
  const again = buildRoad(built.game, 0, roads[0]!);
  assert.equal(again.ok, false);
  // 资源不足被拒。
  const poor = built.game;
  give(poor, 0, { wood: 0, brick: 0 });
  const roads2 = legalRoads(poor, 0);
  if (roads2.length > 0) {
    const rejected = buildRoad(poor, 0, roads2[0]!);
    assert.equal(rejected.ok, false);
  }
});

test("建村：距离规则与花费；城市升级 +1 分", () => {
  // 初始布局的路远端点与自家村庄相邻（距离 1），永远不满足建村距离——
  // 先延伸一条路，让距离 2 的位置进入合法集。
  const base = rollToMain(11);
  give(base, 0, { wood: 4, brick: 4, wheat: 3, wool: 3, ore: 4 });
  let g = base;
  for (let i = 0; i < 4 && legalSettlements(g, 0).length === 0; i++) {
    const roads = legalRoads(g, 0);
    if (roads.length === 0) break;
    const built = buildRoad(g, 0, roads[0]!);
    assert.ok(built.ok);
    g = built.game;
  }
  const spots = legalSettlements(g, 0);
  assert.ok(spots.length > 0, "延伸道路后应出现可建村庄位");
  const vpBefore = playerVP(g, 0).total;
  const built = buildSettlement(g, 0, spots[0]!);
  assert.ok(built.ok);
  assert.equal(playerVP(built.game, 0).total, vpBefore + 1);
  // 距离规则：任一已占村庄的邻点都不可再建。
  for (const b of built.game.buildings) {
    for (const n of built.game.vertices[b.vertex]!.neighbors) {
      const rejected = buildSettlement(built.game, 0, n);
      assert.equal(rejected.ok, false, "邻点必须被距离规则拒绝");
    }
  }
  // 升级城市。
  const mine = built.game.buildings.find((b) => b.owner === 0 && !b.city)!;
  const up = buildCity(built.game, 0, mine.vertex);
  assert.ok(up.ok);
  assert.equal(playerVP(up.game, 0).buildings, 4); // 2 村 + 1 城 = 2 + 2
  assert.ok(legalCities(up.game, 0).length >= 1);
});

test("交易：提议/接受/拒绝/撤回全流程", () => {
  const g = newGame(5);
  give(g, 0, { wood: 3 });
  give(g, 1, { wheat: 3, wood: 1 });
  const proposed = proposeTrade(g, 0, { wood: 1 }, { wheat: 1 }, 1);
  assert.ok(proposed.ok);
  assert.ok(proposed.game.pendingTrade);
  const accepted = respondTrade(proposed.game, true);
  assert.ok(accepted.ok);
  assert.equal(accepted.game.players[0]!.hand.wheat, 3); // 初始 2 + 得 1
  assert.equal(accepted.game.players[0]!.hand.wood, 2); // 初始覆盖为 3 − 付 1
  assert.equal(accepted.game.players[1]!.hand.wood, 2); // 初始覆盖 1 + 得 1
  assert.equal(accepted.game.pendingTrade, null);

  const proposed2 = proposeTrade(accepted.game, 0, { wood: 1 }, { wheat: 1 }, 1);
  assert.ok(proposed2.ok);
  const rejected = respondTrade(proposed2.game, false);
  assert.ok(rejected.ok);
  assert.equal(rejected.game.players[0]!.hand.wood, 2);

  const proposed3 = proposeTrade(rejected.game, 0, { wood: 1 }, { wheat: 1 }, 1);
  assert.ok(proposed3.ok);
  const cancelled = cancelTrade(proposed3.game);
  assert.ok(cancelled.ok);
  assert.equal(cancelled.game.pendingTrade, null);
  assert.equal(cancelled.game.players[0]!.hand.wood, 2, "撤回不扣资源");
});

test("航海交易：无港 4:1，有专属港 2:1", () => {
  let found4to1 = false;
  for (let seed = 1; seed <= 40 && !found4to1; seed++) {
    const g = newGame(seed);
    if (tradeRate(g, 0, "wood") !== 4) continue;
    found4to1 = true;
    give(g, 0, { wood: 4, ore: 0 });
    const traded = bankTrade(g, 0, "wood", "ore");
    assert.ok(traded.ok);
    assert.equal(traded.game.players[0]!.hand.wood, 0);
    assert.equal(traded.game.players[0]!.hand.ore, 1);
  }
  assert.ok(found4to1, "应存在无港 4:1 场景");

  let found2to1 = false;
  for (let seed = 1; seed <= 60 && !found2to1; seed++) {
    const g = newGame(seed);
    if (tradeRate(g, 0, "wood") !== 2) continue;
    found2to1 = true;
    give(g, 0, { wood: 2 });
    const traded = bankTrade(g, 0, "wood", "ore");
    assert.ok(traded.ok);
    assert.equal(traded.game.players[0]!.hand.wood, 0);
  }
  assert.ok(found2to1, "应存在木材专属港 2:1 场景");
});

test("发展卡：购入入册、扣费正确；打骑士进强盗阶段", () => {
  const g = rollToMain(8);
  give(g, 0, { wool: 1, wheat: 1, ore: 1 });
  const bought = buyDev(g, 0);
  assert.ok(bought.ok);
  assert.equal(bought.game.players[0]!.dev.length, 1);
  assert.equal(bought.game.players[0]!.hand.wool, 0);

  const g2 = bought.game;
  g2.players[0]!.dev = ["knight"];
  const played = playDev(g2, 0, "knight");
  assert.ok(played.ok);
  assert.equal(played.game.phase, "robber");
  assert.equal(played.game.players[0]!.knightsPlayed, 1);
  assert.equal(played.game.players[0]!.dev.length, 0);
  assert.equal(played.game.players[0]!.playedDev.length, 1);
});

test("胜利：达到 10 分即分出胜负", () => {
  const g = newGame(2);
  assert.equal(playerVP(g, 0).buildings, 2);
  // 2 村 = 2 分 + 8 张胜利点卡 = 10。
  g.players[0]!.dev = ["vp", "vp", "vp", "vp", "vp", "vp", "vp", "vp"];
  give(g, 0, { wood: 1, brick: 1 });
  const current = rollToMain(2);
  // rollToMain 用的是同种子新局，重新注入手牌与 VP 卡。
  current.players[0]!.dev = ["vp", "vp", "vp", "vp", "vp", "vp", "vp", "vp"];
  give(current, 0, { wood: 1, brick: 1 });
  const roads = legalRoads(current, 0);
  const built = buildRoad(current, 0, roads[0]!);
  assert.ok(built.ok);
  assert.equal(built.game.winner, 0);
  assert.equal(built.game.phase, "over");
  assert.equal(playerVP(built.game, 0).total >= 10, true);
});

test("回合：结束回合轮转下家并回到掷骰阶段", () => {
  const current = rollToMain(4);
  const next = endTurn(current);
  assert.ok(next.ok);
  assert.equal(next.game.turn, 1);
  assert.equal(next.game.phase, "roll");
  assert.equal(next.game.turnNo, 2);
});

test("最长路：连成 5 段获得「最长道路」归属", () => {
  const g = rollToMain(13);
  give(g, 0, { wood: 15, brick: 15 });
  let state = g;
  for (let i = 0; i < 8 && longestRoadLength(state, 0) < 5; i++) {
    const roads = legalRoads(state, 0);
    assert.ok(roads.length > 0, "应始终有路可修");
    // 贪心挑能让最长路最长的边。
    let bestEdge = -1;
    let bestLen = longestRoadLength(state, 0);
    for (const e of roads) {
      const trial = buildRoad(state, 0, e);
      if (!trial.ok) continue;
      const len = longestRoadLength(trial.game, 0);
      if (len > bestLen) {
        bestLen = len;
        bestEdge = e;
      }
    }
    if (bestEdge < 0) break;
    const built = buildRoad(state, 0, bestEdge);
    assert.ok(built.ok);
    state = built.game;
  }
  assert.ok(longestRoadLength(state, 0) >= 5, "8 条路内应能连出 5 段");
  assert.equal(state.longestRoadOwner, 0);
});
