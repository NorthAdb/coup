/**
 * 卡坦岛决策规划：超时代打（破坏最小）与机器人启发式。
 *
 * planAutoDecision —— 回合计时器超时以人类座位名义提交的稳妥命令。
 * planBotDecision  —— 服务器机器人座位的完整启发式（城→村→路→发展卡→银行），
 *                     每次调用只返回「一条」命令；平台栈驱动循环会按新状态续链。
 * 全部确定性（不依赖 Math.random），同一种子同局面同决策。
 */

import { canAfford, pipScore } from "./engine.js";
import {
  BUILD_COSTS,
  type CatanCommand,
  type CatanGame,
  type ResourceId,
} from "./types.js";

/** 超时代打：响应窗口放弃、强盗必动、主阶段直接结束回合。 */
export function planAutoDecision(g: CatanGame, player: number): CatanCommand | null {
  if (g.status !== "in_progress") return null;

  // 欠交易回应：婉拒（最稳妥）。
  if (g.pendingTrade && g.pendingTrade.to === player) {
    return { type: "respond_trade", player, accept: false };
  }
  if (g.pendingTrade && g.pendingTrade.from === player && g.turn !== player) {
    return { type: "cancel_trade", player };
  }
  if (g.turn !== player) return null;

  if (g.phase === "roll") return { type: "roll", player };

  if (g.phase === "robber") {
    if (!g.robberMoved) {
      const tile = quietestTile(g);
      if (tile != null) return { type: "move_robber", player, tileId: tile };
    }
    if (robberTargets(g, player).length > 0) {
      return { type: "steal", player, victim: robberTargets(g, player)[0]! };
    }
    return { type: "end_robber_move", player };
  }

  if (g.phase === "main") return { type: "end_turn", player };
  return null;
}

/** 机器人启发式：一条命令；平台栈按结果状态续链。 */
export function planBotDecision(g: CatanGame, player: number): CatanCommand | null {
  if (g.status !== "in_progress") return null;

  // 他人发来的交易提议：按富余度启发出回应。
  if (g.pendingTrade && g.pendingTrade.to === player) {
    return { type: "respond_trade", player, accept: acceptTrade(g, player) };
  }
  if (g.turn !== player) return null;

  if (g.phase === "roll") return { type: "roll", player };

  if (g.phase === "robber") {
    if (!g.robberMoved) {
      const tile = bestRobberTile(g, player);
      if (tile != null) return { type: "move_robber", player, tileId: tile };
    }
    const targets = robberTargets(g, player);
    if (targets.length > 0) {
      // 抽最富的受害者（公开手牌数）。
      const richest = [...targets].sort(
        (a, b) => (g.players[b]!.handCount ?? 0) - (g.players[a]!.handCount ?? 0),
      );
      return { type: "steal", player, victim: richest[0]! };
    }
    return { type: "end_robber_move", player };
  }

  if (g.phase !== "main") return null;
  const me = g.players[player]!;

  // 骑士：第 3 回合起有机会就打（顺带驱强盗）。
  if (me.dev.includes("knight") && g.turnNo > 2) {
    return { type: "play_dev", player, card: "knight" };
  }

  // 城市（收益最高）。
  if (canAfford(me.hand, BUILD_COSTS.city)) {
    const spots = citySpots(g, player);
    if (spots.length > 0) return { type: "build_city", player, vertexId: spots[0]! };
  }

  // 村庄。
  if (canAfford(me.hand, BUILD_COSTS.settlement)) {
    const spots = settlementSpots(g, player);
    if (spots.length > 0) return { type: "build_settlement", player, vertexId: spots[0]! };
  }

  // 道路（免费道路优先消耗；朝高产出方向延伸）。
  const roadCost = BUILD_COSTS.road;
  const canPayRoad = g.freeRoads > 0 || canAfford(me.hand, roadCost);
  if (canPayRoad) {
    const edge = bestRoad(g, player);
    if (edge != null) {
      return { type: "build_road", player, edgeId: edge, free: g.freeRoads > 0 };
    }
  }

  // 发展卡。
  if (g.devDeck.length > 0 && canAfford(me.hand, BUILD_COSTS.dev)) {
    return { type: "buy_dev", player };
  }

  // 手头单一资源积压 ≥4 时航海换缺的资源。
  const clogged = (Object.entries(me.hand) as Array<[ResourceId, number]>).find(([, n]) => n >= 4);
  if (clogged) {
    const give = clogged[0];
    const want = (Object.keys(me.hand) as ResourceId[])
      .filter((k) => k !== give && me.hand[k] === 0)
      .sort((a, b) => scarcity(g, a) - scarcity(g, b))[0];
    if (want) return { type: "bank_trade", player, give, want };
  }

  return { type: "end_turn", player };
}

/* ------------------------------------------------------------------ */
/* 启发式内部件                                                        */
/* ------------------------------------------------------------------ */

function robberTargets(g: CatanGame, player: number): number[] {
  const tile = g.tiles.find((t) => t.id === g.robberTile)!;
  const victims = new Set<number>();
  for (const b of g.buildings) {
    if (b.owner === player) continue;
    const v = g.vertices[b.vertex]!;
    const held = g.players[b.owner]!.handCount ?? Object.values(g.players[b.owner]!.hand).reduce((a, c) => a + c, 0);
    if (v.tiles.includes(tile.id) && held > 0) victims.add(b.owner);
  }
  return [...victims];
}

function quietestTile(g: CatanGame): number | null {
  const candidates = g.tiles.filter((t) => t.id !== g.robberTile && t.terrain !== "desert");
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => pipScore(a.value) - pipScore(b.value) || a.id - b.id)[0]!.id;
}

/** 把强盗挪到产出分最高、且压到对手（非自己）建筑的地块。 */
function bestRobberTile(g: CatanGame, player: number): number | null {
  const candidates = g.tiles.filter((t) => t.id !== g.robberTile && t.terrain !== "desert");
  if (candidates.length === 0) return null;
  const score = (tileId: number): number => {
    let s = 0;
    for (const b of g.buildings) {
      if (b.owner === player) continue;
      if (g.vertices[b.vertex]!.tiles.includes(tileId)) s += pipScore(g.tiles.find((t) => t.id === tileId)!.value) + (b.city ? 1 : 0);
    }
    return s;
  };
  return [...candidates].sort((a, b) => score(b.id) - score(a.id) || a.id - b.id)[0]!.id;
}

/** 交易启发出回应：换来的越缺越愿意成交，付出要留有余量。 */
function acceptTrade(g: CatanGame, player: number): boolean {
  const pending = g.pendingTrade!;
  const me = g.players[player]!;
  const wantTotal = Object.values(pending.want).reduce((a, b) => a + b, 0);
  const giveTotal = Object.values(pending.give).reduce((a, b) => a + b, 0);
  if (!canAfford(me.hand, pending.want)) return false;
  const surplus = (Object.keys(me.hand) as ResourceId[]).some(
    (k) => pending.want[k] > 0 && me.hand[k] - pending.want[k] >= 2,
  );
  if (surplus) return true;
  const wantKey = (Object.entries(pending.want) as Array<[ResourceId, number]>).find(([, n]) => n > 0)?.[0];
  if (!wantKey) return false;
  const desired = me.hand[wantKey] === 0;
  return desired && giveTotal >= wantTotal;
}

function citySpots(g: CatanGame, player: number): number[] {
  return g.buildings
    .filter((b) => b.owner === player && !b.city)
    .map((b) => ({ v: b.vertex, s: spotScore(g, b.vertex) }))
    .sort((a, b) => b.s - a.s || a.v - b.v)
    .map((x) => x.v);
}

function settlementSpots(g: CatanGame, player: number): number[] {
  const taken = new Set(g.buildings.map((b) => b.vertex));
  const myRoadEdges = new Set(g.roads.filter((r) => r.owner === player).map((r) => r.edge));
  return g.vertices
    .filter(
      (v) =>
        !taken.has(v.id) &&
        v.neighbors.every((n) => !taken.has(n)) &&
        g.edges.some((e) => (e.a === v.id || e.b === v.id) && myRoadEdges.has(e.id)),
    )
    .map((v) => ({ v: v.id, s: spotScore(g, v.id) + (v.harbor != null ? 1.5 : 0) }))
    .sort((a, b) => b.s - a.s || a.v - b.v)
    .map((x) => x.v);
}

/** 挑一条朝高产出空顶点延伸的路（免费道路时必须可修）。 */
function bestRoad(g: CatanGame, player: number): number | null {
  const legal = g.edges.filter((e) => {
    if (g.roads.some((r) => r.edge === e.id)) return false;
    const net = new Set<number>();
    for (const b of g.buildings) if (b.owner === player) net.add(b.vertex);
    for (const r of g.roads) {
      if (r.owner !== player) continue;
      const ed = g.edges[r.edge]!;
      net.add(ed.a);
      net.add(ed.b);
    }
    return net.has(e.a) || net.has(e.b);
  });
  if (legal.length === 0) return null;
  const taken = new Set(g.buildings.map((b) => b.vertex));
  const farScore = (e: { a: number; b: number }): number => {
    const far = [e.a, e.b]
      .filter((v) => !taken.has(v) && g.vertices[v]!.neighbors.every((n) => !taken.has(n)));
    if (far.length === 0) return 0;
    return Math.max(...far.map((v) => spotScore(g, v)));
  };
  return [...legal]
    .sort((a, b) => farScore(b) - farScore(a) || a.id - b.id)[0]!.id;
}

/** 顶点产出分：三邻地块 pip 之和 + 港口微弱加成。 */
function spotScore(g: CatanGame, vertexId: number): number {
  const v = g.vertices[vertexId]!;
  return v.tiles.reduce((sum, id) => sum + pipScore(g.tiles.find((t) => t.id === id)!.value), 0);
}

/** 全场玩家对某资源的建筑覆盖率（越小越稀缺）。 */
function scarcity(g: CatanGame, resource: ResourceId): number {
  let count = 0;
  for (const b of g.buildings) {
    const v = g.vertices[b.vertex]!;
    for (const tileId of v.tiles) {
      const tile = g.tiles.find((t) => t.id === tileId)!;
      if (tile.terrain === terrainOf(resource)) count += 1;
    }
  }
  return count;
}

function terrainOf(resource: ResourceId): string {
  switch (resource) {
    case "wood":
      return "forest";
    case "brick":
      return "hills";
    case "wool":
      return "pasture";
    case "wheat":
      return "fields";
    case "ore":
      return "mountains";
  }
}
