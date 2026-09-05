/**
 * 卡坦岛规则引擎 —— 纯函数实现。
 *
 * 所有随机性走内部 mulberry32（g.rngState），保证测试可复现；
 * 动作返回 { ok, game, events }，events 供 UI 做「行动 → 反馈 → 状态变化」动画。
 * 每次成功动作 stateVersion 递增（联机增量轮询依赖）。
 * 刻意最小化的规则：起始放置（预置落位）、7 点弃牌、出牌当轮限制等，见 spec。
 */

import {
  BUILD_COSTS,
  DEV_NAMES,
  RESOURCE_NAMES,
  TERRAIN_RESOURCE,
  emptyCount,
  type BuildingPiece,
  type CatanGame,
  type CatanProjection,
  type CatanTile,
  type DevCardKind,
  type Edge,
  type GameEvent,
  type GameResult,
  type Harbor,
  type HarborKind,
  type PlayerScore,
  type PlayerState,
  type ResourceCount,
  type ResourceId,
  type Terrain,
  type Vertex,
} from "./types.js";

const SQRT3 = Math.sqrt(3);
/** 六边形外接圆半径（布局单位）。 */
export const HEX_R = 1;

export interface Axial {
  q: number;
  r: number;
}

/** pointy-top axial → 布局坐标。 */
export function axialCenter(q: number, r: number): { x: number; y: number } {
  return { x: SQRT3 * (q + r / 2), y: 1.5 * r };
}

/** 第 i 个角点相对中心的偏移（pointy-top：角在正上/正下）。 */
export function hexCornerOffset(i: number): { x: number; y: number } {
  const angle = (Math.PI / 180) * (60 * i - 30);
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

/** 标准 19 陆地格 axial 坐标（行列 3-4-5-4-3）。 */
export const BOARD_AXIALS: readonly Axial[] = (() => {
  const list: Axial[] = [];
  for (let r = -2; r <= 2; r++) {
    const lo = Math.max(-2, -r - 2);
    const hi = Math.min(2, -r + 2);
    for (let q = lo; q <= hi; q++) list.push({ q, r });
  }
  return list;
})();

/* ------------------------------------------------------------------ */
/* 随机与工具                                                          */
/* ------------------------------------------------------------------ */

function nextRand(g: CatanGame): number {
  let t = (g.rngState += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function randInt(g: CatanGame, n: number): number {
  return Math.floor(nextRand(g) * n);
}

function shuffled<T>(g: CatanGame, arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(g, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pushLog(g: CatanGame, text: string, color?: string): void {
  g.seq += 1;
  g.log.push({ seq: g.seq, text, color });
  if (g.log.length > 60) g.log.splice(0, g.log.length - 60);
}

function ok(g: CatanGame, events: GameEvent[]): GameResult {
  g.stateVersion += 1;
  return { ok: true, game: g, events };
}

function fail(code: string): GameResult {
  return { ok: false, code };
}

function canAfford(hand: ResourceCount, cost: Partial<ResourceCount>): boolean {
  return (Object.keys(cost) as ResourceId[]).every((k) => hand[k] >= (cost[k] ?? 0));
}
export { canAfford };

function pay(hand: ResourceCount, cost: Partial<ResourceCount>): void {
  for (const k of Object.keys(cost) as ResourceId[]) hand[k] -= cost[k] ?? 0;
}

function countTotal(hand: ResourceCount): number {
  return (Object.values(hand) as number[]).reduce((a, b) => a + b, 0);
}

/* ------------------------------------------------------------------ */
/* 棋盘生成                                                            */
/* ------------------------------------------------------------------ */

function keyOf(x: number, y: number): string {
  // 两条计算路径的浮点尾数可能差 1 ulp，五位数取整足够稳。
  return `${Math.round(x * 1e5)}:${Math.round(y * 1e5)}`;
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

export interface BoardGeometry {
  tiles: CatanTile[];
  vertices: Vertex[];
  edges: Edge[];
  harbors: Harbor[];
}

const TOKEN_VALUES = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12] as const;

/** 数字 6/8（高概率）不相邻是实体版的经典摆放规则，用于校验 token 布局。 */
export function tokensValid(tiles: CatanTile[]): boolean {
  const byId = new Map(tiles.map((t) => [t.id, t]));
  const hot = tiles.filter((t) => t.value === 6 || t.value === 8);
  for (const t of hot) {
    for (const n of neighborTiles(t, byId)) {
      if (n.value === 6 || n.value === 8) return false;
    }
  }
  return true;
}

function neighborDirs(): Axial[] {
  return [
    { q: 1, r: 0 },
    { q: 1, r: -1 },
    { q: 0, r: -1 },
    { q: -1, r: 0 },
    { q: -1, r: 1 },
    { q: 0, r: 1 },
  ];
}

function neighborTiles(tile: CatanTile, byId: Map<number, CatanTile>): CatanTile[] {
  const out: CatanTile[] = [];
  for (const d of neighborDirs()) {
    const n = byId.get(tileIdOf(d.q + tile.q, d.r + tile.r));
    if (n) out.push(n);
  }
  return out;
}

function tileIdOf(q: number, r: number): number {
  return (q + 4) * 10 + (r + 4);
}

/** 生成 19 陆地格 + 顶点/边几何 + 9 港口（种机确定）。 */
export function generateBoard(seed: number): BoardGeometry & { rngState: number } {
  let rngState = seed >>> 0;
  const rand = (): number => {
    let t = (rngState += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rngShuffle = <T,>(arr: readonly T[]): T[] => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  // 地形：4 森林 / 4 草原 / 4 麦田 / 3 丘陵 / 3 山脉 / 1 沙漠。
  const terrains: Terrain[] = [
    ...Array<Terrain>(4).fill("forest"),
    ...Array<Terrain>(4).fill("pasture"),
    ...Array<Terrain>(4).fill("fields"),
    ...Array<Terrain>(3).fill("hills"),
    ...Array<Terrain>(3).fill("mountains"),
    "desert",
  ];

  const tiles: CatanTile[] = BOARD_AXIALS.map((a, i) => ({
    id: tileIdOf(a.q, a.r),
    q: a.q,
    r: a.r,
    terrain: terrains[i],
    value: null,
  }));
  const desert = tiles.find((t) => t.terrain === "desert")!;

  // token 布局：反复洗牌直到 6/8 不相邻（实测几乎必在前几次尝试内成功）。
  const resourceTiles = tiles.filter((t) => t.terrain !== "desert");
  for (let attempt = 0; attempt < 500; attempt++) {
    const values = rngShuffle(TOKEN_VALUES);
    resourceTiles.forEach((t, i) => {
      t.value = values[i];
    });
    if (tokensValid(tiles)) break;
  }

  // 顶点与边。
  const vMap = new Map<string, Vertex>();
  const vKeys: string[] = [];
  const eMap = new Map<string, Edge>();
  for (const tile of tiles) {
    const c = axialCenter(tile.q, tile.r);
    const cornerIds: number[] = [];
    for (let i = 0; i < 6; i++) {
      const off = hexCornerOffset(i);
      const x = c.x + off.x;
      const y = c.y + off.y;
      const key = keyOf(x, y);
      let v = vMap.get(key);
      if (!v) {
        v = { id: vMap.size, x, y, tiles: [], neighbors: [], harbor: null };
        vMap.set(key, v);
        vKeys.push(key);
      }
      v.tiles.push(tile.id);
      cornerIds.push(v.id);
    }
    for (let i = 0; i < 6; i++) {
      const a = cornerIds[i]!;
      const b = cornerIds[(i + 1) % 6]!;
      const key = edgeKey(a, b);
      let e = eMap.get(key);
      if (!e) {
        const va = vMap.get(vKeys[Math.min(a, b)]!)!;
        const vb = vMap.get(vKeys[Math.max(a, b)]!)!;
        e = {
          id: eMap.size,
          a: Math.min(a, b),
          b: Math.max(a, b),
          x1: va.x,
          y1: va.y,
          x2: vb.x,
          y2: vb.y,
          tiles: [],
          harbor: null,
        };
        eMap.set(key, e);
      }
      e.tiles.push(tile.id);
    }
  }

  const vertices = [...vMap.values()];
  const edges = [...eMap.values()];

  // 顶点邻接（经过边）。
  for (const e of edges) {
    if (!vertices[e.a]!.neighbors.includes(e.b)) vertices[e.a]!.neighbors.push(e.b);
    if (!vertices[e.b]!.neighbors.includes(e.a)) vertices[e.b]!.neighbors.push(e.a);
  }

  // 港口：海岸边（恰邻一块陆地）按极角排序后均匀取 9 个，类型洗牌。
  const coast = edges.filter((e) => e.tiles.length === 1);
  const withAngle = coast.map((e) => ({
    e,
    angle: Math.atan2((e.y1 + e.y2) / 2, (e.x1 + e.x2) / 2),
  }));
  withAngle.sort((p, q) => p.angle - q.angle);
  const kinds: HarborKind[] = rngShuffle([
    "any",
    "any",
    "any",
    "any",
    "wood",
    "brick",
    "wool",
    "wheat",
    "ore",
  ]);
  const step = withAngle.length / kinds.length;
  const harbors: Harbor[] = kinds.map((kind, i) => {
    const picked = withAngle[Math.floor(i * step)]!.e;
    const harbor: Harbor = { id: i, kind, edge: picked.id };
    picked.harbor = i;
    vertices[picked.a]!.harbor = i;
    vertices[picked.b]!.harbor = i;
    return harbor;
  });

  return { tiles, vertices, edges, harbors, rngState };
}

/* ------------------------------------------------------------------ */
/* 胜利点与最长路                                                       */
/* ------------------------------------------------------------------ */

export function playerVP(g: CatanGame, player: number): {
  total: number;
  buildings: number;
  vpCards: number;
  longestRoad: number;
  largestArmy: number;
} {
  const buildings = g.buildings
    .filter((b) => b.owner === player)
    .reduce((sum, b) => sum + (b.city ? 2 : 1), 0);
  const vpCards = g.players[player]!.dev.filter((c) => c === "vp").length;
  const longestRoad = g.longestRoadOwner === player ? 2 : 0;
  const largestArmy = g.largestArmyOwner === player ? 2 : 0;
  return { total: buildings + vpCards + longestRoad + largestArmy, buildings, vpCards, longestRoad, largestArmy };
}

/** 公开胜利点（不含未打出的发展卡）——他人视角的计分板用。 */
export function publicVP(g: CatanGame, player: number): number {
  const vp = playerVP(g, player);
  return vp.buildings + vp.longestRoad + vp.largestArmy;
}

/** 最长路（忽略对手建筑截断等细节，Trail DFS 足够 Mock）。 */
export function longestRoadLength(g: CatanGame, player: number): number {
  const mine = g.roads.filter((r) => r.owner === player);
  if (mine.length === 0) return 0;
  const blocked = new Set(g.buildings.filter((b) => b.owner !== player).map((b) => b.vertex));
  const adj = new Map<number, Array<{ to: number; edge: number }>>();
  for (const r of mine) {
    const e = g.edges[r.edge]!;
    for (const [from, to] of [
      [e.a, e.b],
      [e.b, e.a],
    ] as const) {
      if (blocked.has(from)) continue;
      const list = adj.get(from) ?? [];
      list.push({ to, edge: r.edge });
      adj.set(from, list);
    }
  }
  const used = new Set<number>();
  let best = 0;
  const walk = (v: number, len: number): void => {
    best = Math.max(best, len);
    for (const nxt of adj.get(v) ?? []) {
      if (used.has(nxt.edge)) continue;
      used.add(nxt.edge);
      walk(nxt.to, len + 1);
      used.delete(nxt.edge);
    }
  };
  for (const r of mine) {
    const e = g.edges[r.edge]!;
    walk(e.a, 0);
    walk(e.b, 0);
  }
  return best;
}

/** 重算最长路归属（≥5 才成立；易主时旧主失去加成）。 */
function updateLongestRoad(g: CatanGame): void {
  let bestOwner: number | null = null;
  let bestLen = 4;
  for (let p = 0; p < g.players.length; p++) {
    const len = longestRoadLength(g, p);
    if (len > bestLen) {
      bestLen = len;
      bestOwner = p;
    }
  }
  if (bestOwner !== g.longestRoadOwner) {
    if (bestOwner != null) {
      pushLog(g, `${g.players[bestOwner]!.name} 的道路达到 ${bestLen} 段，获得「最长道路」+2 分`, g.players[bestOwner]!.color);
    }
    g.longestRoadOwner = bestOwner;
  }
}

function updateLargestArmy(g: CatanGame, player: number): void {
  const me = g.players[player]!;
  if (me.knightsPlayed < 3) return;
  const current = g.largestArmyOwner;
  if (current == null || (current !== player && g.players[current]!.knightsPlayed < me.knightsPlayed)) {
    g.largestArmyOwner = player;
    pushLog(g, `${me.name} 率领 ${me.knightsPlayed} 名骑士，获得「最大骑士军团」+2 分`, me.color);
  }
}

function checkWin(g: CatanGame, events: GameEvent[]): void {
  if (g.phase === "over") return;
  for (let p = 0; p < g.players.length; p++) {
    if (playerVP(g, p).total >= 10) {
      g.winner = p;
      g.phase = "over";
      g.status = "finished";
      g.finalScores = g.players.map((_, i) => {
        const vp = playerVP(g, i);
        return {
          player: i,
          total: vp.total,
          buildings: vp.buildings,
          vpCards: vp.vpCards,
          longestRoad: vp.longestRoad,
          largestArmy: vp.largestArmy,
        } satisfies PlayerScore;
      });
      events.push({ type: "win", player: p });
      pushLog(g, `${g.players[p]!.name} 达到 10 分，赢得对局！`, g.players[p]!.color);
      return;
    }
  }
}

/* ------------------------------------------------------------------ */
/* 建局                                                                */
/* ------------------------------------------------------------------ */

export interface PlayerSetup {
  name: string;
  color: string;
  isHuman: boolean;
}/** 6/8=5 分、5/9=4 分…用于挑选像样的开局落位。 */
export function pipScore(value: number | null): number {
  if (value == null) return 0;
  if (value === 6 || value === 8) return 5;
  if (value === 5 || value === 9) return 4;
  if (value === 4 || value === 10) return 3;
  if (value === 3 || value === 11) return 2;
  return 1;
}

export function createGame(setups: PlayerSetup[], seed: number, matchId = "catan-local"): CatanGame {
  const board = generateBoard(seed);
  const g: CatanGame = {
    matchId,
    stateVersion: 1,
    status: "in_progress",
    tiles: board.tiles,
    vertices: board.vertices,
    edges: board.edges,
    harbors: board.harbors,
    robberTile: board.tiles.find((t) => t.terrain === "desert")!.id,
    players: setups.map(
      (s, i): PlayerState => ({
        id: i,
        name: s.name,
        color: s.color,
        isHuman: s.isHuman,
        hand: emptyCount(),
        dev: [],
        playedDev: [],
        knightsPlayed: 0,
      }),
    ),
    roads: [],
    buildings: [],
    turn: 0,
    turnNo: 1,
    phase: "roll",
    robberMoved: false,
    lastDice: null,
    freeRoads: 0,
    devDeck: [],
    longestRoadOwner: null,
    largestArmyOwner: null,
    pendingTrade: null,
    finalScores: null,
    log: [],
    seq: 0,
    winner: null,
    rngState: board.rngState,
  };

  g.devDeck = shuffled(
    g,
    [
      ...Array<DevCardKind>(14).fill("knight"),
      ...Array<DevCardKind>(5).fill("vp"),
      ...Array<DevCardKind>(2).fill("roadBuilding"),
      ...Array<DevCardKind>(2).fill("yearOfPlenty"),
      ...Array<DevCardKind>(2).fill("monopoly"),
    ],
  );

  // 预置落位：每人两村两路（模拟已完成初始布局的对局中盘）。
  const scored = g.vertices
    .map((v) => ({
      id: v.id,
      score: v.tiles.reduce((sum, id) => sum + pipScore(g.tiles.find((t) => t.id === id)!.value), 0) + nextRand(g) * 1.5,
    }))
    .sort((a, b) => b.score - a.score);
  const occupied = new Set<number>();
  const canPlace = (v: number): boolean => {
    if (occupied.has(v)) return false;
    return g.vertices[v]!.neighbors.every((n) => !occupied.has(n));
  };
  const placements: number[][] = g.players.map(() => []);
  // 蛇形序 0,1,2,3,3,2,1,0：每人两村，靠后者第二轮先选。
  const snake = [...g.players.keys(), ...[...g.players.keys()].reverse()];
  for (const p of snake) {
    const spot = scored.find((c) => canPlace(c.id))!.id;
    occupied.add(spot);
    placements[p]!.push(spot);
  }
  for (const p of g.players.keys()) {
    for (const spot of placements[p]!) {
      g.buildings.push({ vertex: spot, owner: p, city: false } satisfies BuildingPiece);
      // 每座村庄配一条路：朝远端点产出分最高的方向（路的远端点永远与自家村庄
      // 相邻、不满足建村距离，扩建位在第二条路之外，所以这里只管方向质量）。
      const v = g.vertices[spot]!;
      const incident = g.edges
        .filter((e) => e.a === v.id || e.b === v.id)
        .map((e) => {
          const other = e.a === v.id ? e.b : e.a;
          const ov = g.vertices[other]!;
          const score = ov.tiles.reduce((sum, id) => sum + pipScore(g.tiles.find((t) => t.id === id)!.value), 0);
          return { e, score };
        })
        .sort((a, b) => b.score - a.score);
      g.roads.push({ edge: incident[0]!.e.id, owner: p });
    }
  }

  // 起始手牌：人类玩家给一手可立刻行动的资源；AI 少量随机。
  g.players[0]!.hand = { wood: 2, brick: 2, wool: 2, wheat: 2, ore: 1 };
  for (let p = 1; p < g.players.length; p++) {
    for (let i = 0; i < 4; i++) {
      const res = (["wood", "brick", "wool", "wheat", "ore"] as const)[randInt(g, 5)]!;
      g.players[p]!.hand[res] += 1;
    }
  }

  pushLog(g, "对局开始 —— 各家村庄与道路已布置完毕");
  updateLongestRoad(g);
  return g;
}

/* ------------------------------------------------------------------ */
/* 查询                                                                */
/* ------------------------------------------------------------------ */

function myNetworkVertices(g: CatanGame, player: number): Set<number> {
  const s = new Set<number>();
  for (const b of g.buildings) if (b.owner === player) s.add(b.vertex);
  for (const r of g.roads) {
    if (r.owner !== player) continue;
    const e = g.edges[r.edge]!;
    s.add(e.a);
    s.add(e.b);
  }
  return s;
}

export function legalRoads(g: CatanGame, player: number): number[] {
  const taken = new Set(g.roads.map((r) => r.edge));
  const net = myNetworkVertices(g, player);
  return g.edges
    .filter((e) => !taken.has(e.id) && (net.has(e.a) || net.has(e.b)))
    .map((e) => e.id);
}

export function legalSettlements(g: CatanGame, player: number): number[] {
  const taken = new Set(g.buildings.map((b) => b.vertex));
  const myRoadEdges = new Set(g.roads.filter((r) => r.owner === player).map((r) => r.edge));
  return g.vertices
    .filter(
      (v) =>
        !taken.has(v.id) &&
        v.neighbors.every((n) => !taken.has(n)) &&
        g.edges.some(
          (e) => (e.a === v.id || e.b === v.id) && myRoadEdges.has(e.id),
        ),
    )
    .map((v) => v.id);
}

export function legalCities(g: CatanGame, player: number): number[] {
  return g.buildings.filter((b) => b.owner === player && !b.city).map((b) => b.vertex);
}

export function robberVictims(g: CatanGame, player: number): number[] {
  const tile = g.tiles.find((t) => t.id === g.robberTile)!;
  const victims = new Set<number>();
  for (const b of g.buildings) {
    if (b.owner === player) continue;
    const v = g.vertices[b.vertex]!;
    const held = g.players[b.owner]!.handCount ?? countTotal(g.players[b.owner]!.hand);
    if (v.tiles.includes(tile.id) && held > 0) victims.add(b.owner);
  }
  return [...victims];
}

export function legalRobberTiles(g: CatanGame): number[] {
  return g.tiles.filter((t) => t.id !== g.robberTile).map((t) => t.id);
}

/** 航海交易率：专属港 2:1 / 通用港 3:1 / 无港 4:1。 */
export function tradeRate(g: CatanGame, player: number, resource: ResourceId): 2 | 3 | 4 {
  const mine = g.buildings.filter((b) => b.owner === player).map((b) => b.vertex);
  let rate: 2 | 3 | 4 = 4;
  for (const v of mine) {
    const harborId = g.vertices[v]!.harbor;
    if (harborId == null) continue;
    const kind = g.harbors[harborId]!.kind;
    if (kind === resource) return 2;
    if (kind === "any") rate = Math.min(rate as number, 3) as 2 | 3 | 4;
  }
  return rate;
}

/* ------------------------------------------------------------------ */
/* 动作                                                                */
/* ------------------------------------------------------------------ */

export function rollDice(input: CatanGame): GameResult {
  const g = structuredClone(input);
  if (g.phase !== "roll") return fail("phase");
  const a = 1 + randInt(g, 6);
  const b = 1 + randInt(g, 6);
  const sum = a + b;
  g.lastDice = { a, b };
  const player = g.players[g.turn]!;
  const events: GameEvent[] = [{ type: "dice", a, b }];
  pushLog(g, `${player.name} 掷出 ${a} + ${b} = ${sum}`, player.color);

  if (sum === 7) {
    g.phase = "robber";
    g.robberMoved = false;
    pushLog(g, "强盗出没 —— 必须移动强盗");
    return ok(g, events);
  }

  for (const tile of g.tiles) {
    if (tile.value !== sum || tile.id === g.robberTile) continue;
    const resource = TERRAIN_RESOURCE[tile.terrain];
    if (!resource) continue;
    // 按（地块, 玩家）聚合产出，事件供 UI 从 token 处飘资源。
    const perPlayer = new Map<number, number>();
    for (const b of g.buildings) {
      if (!g.vertices[b.vertex]!.tiles.includes(tile.id)) continue;
      const n = b.city ? 2 : 1;
      perPlayer.set(b.owner, (perPlayer.get(b.owner) ?? 0) + n);
      g.players[b.owner]!.hand[resource] += n;
    }
    for (const [owner, n] of perPlayer) {
      events.push({ type: "produce", tileId: tile.id, player: owner, resource, n });
    }
  }
  g.phase = "main";
  return ok(g, events);
}

export function buildRoad(input: CatanGame, player: number, edgeId: number, opts: { free?: boolean } = {}): GameResult {
  const g = structuredClone(input);
  const p = g.players[player]!;
  const edge = g.edges[edgeId];
  if (!edge) return fail("no_edge");
  if (g.phase !== "main" && !(opts.free && g.freeRoads > 0)) return fail("phase");
  if (g.roads.some((r) => r.edge === edgeId)) return fail("occupied");
  const net = myNetworkVertices(g, player);
  if (!net.has(edge.a) && !net.has(edge.b)) return fail("disconnected");
  const free = opts.free === true && g.freeRoads > 0;
  if (!free) {
    if (!canAfford(p.hand, BUILD_COSTS.road)) return fail("cost");
    pay(p.hand, BUILD_COSTS.road);
  } else {
    g.freeRoads -= 1;
  }
  g.roads.push({ edge: edgeId, owner: player });
  pushLog(g, `${p.name} 修建了一条道路`, p.color);
  updateLongestRoad(g);
  const events: GameEvent[] = [{ type: "build", kind: "road", player, key: edgeId }];
  checkWin(g, events);
  return ok(g, events);
}

export function buildSettlement(
  input: CatanGame,
  player: number,
  vertexId: number,
  opts: { free?: boolean } = {},
): GameResult {
  const g = structuredClone(input);
  const p = g.players[player]!;
  const v = g.vertices[vertexId];
  if (!v) return fail("no_vertex");
  if (g.phase !== "main") return fail("phase");
  if (g.buildings.some((b) => b.vertex === vertexId)) return fail("occupied");
  if (!v.neighbors.every((n) => !g.buildings.some((b) => b.vertex === n))) return fail("too_close");
  const net = myNetworkVertices(g, player);
  const connected = g.edges.some(
    (e) => (e.a === vertexId || e.b === vertexId) && net.has(vertexId) && g.roads.some((r) => r.owner === player && r.edge === e.id),
  );
  if (!connected) return fail("disconnected");
  if (!opts.free) {
    if (!canAfford(p.hand, BUILD_COSTS.settlement)) return fail("cost");
    pay(p.hand, BUILD_COSTS.settlement);
  }
  g.buildings.push({ vertex: vertexId, owner: player, city: false });
  pushLog(g, `${p.name} 建起了一座村庄`, p.color);
  const events: GameEvent[] = [{ type: "build", kind: "settlement", player, key: vertexId }];
  checkWin(g, events);
  return ok(g, events);
}

export function buildCity(input: CatanGame, player: number, vertexId: number): GameResult {
  const g = structuredClone(input);
  const p = g.players[player]!;
  if (g.phase !== "main") return fail("phase");
  const b = g.buildings.find((x) => x.vertex === vertexId);
  if (!b || b.owner !== player || b.city) return fail("no_settlement");
  if (!canAfford(p.hand, BUILD_COSTS.city)) return fail("cost");
  pay(p.hand, BUILD_COSTS.city);
  b.city = true;
  pushLog(g, `${p.name} 将村庄升级为城市`, p.color);
  const events: GameEvent[] = [{ type: "build", kind: "city", player, key: vertexId }];
  checkWin(g, events);
  return ok(g, events);
}

export function buyDev(input: CatanGame, player: number): GameResult {
  const g = structuredClone(input);
  const p = g.players[player]!;
  if (g.phase !== "main") return fail("phase");
  if (g.devDeck.length === 0) return fail("empty_deck");
  if (!canAfford(p.hand, BUILD_COSTS.dev)) return fail("cost");
  pay(p.hand, BUILD_COSTS.dev);
  const card = g.devDeck.shift()!;
  p.dev.push(card);
  pushLog(g, `${p.name} 购入一张发展卡`, p.color);
  const events: GameEvent[] = [{ type: "dev", player, card }];
  checkWin(g, events);
  return ok(g, events);
}

export function playDev(
  input: CatanGame,
  player: number,
  card: DevCardKind,
  payload: { picks?: [ResourceId, ResourceId]; resource?: ResourceId } = {},
): GameResult {
  const g = structuredClone(input);
  const p = g.players[player]!;
  if (g.phase !== "main") return fail("phase");
  const idx = p.dev.indexOf(card);
  if (idx < 0) return fail("no_card");
  if (card === "vp") return fail("vp_not_playable");
  p.dev.splice(idx, 1);
  p.playedDev.push(card);
  const events: GameEvent[] = [];

  if (card === "knight") {
    p.knightsPlayed += 1;
    pushLog(g, `${p.name} 打出骑士（第 ${p.knightsPlayed} 名）`, p.color);
    updateLargestArmy(g, player);
    g.phase = "robber";
    g.robberMoved = false;
    pushLog(g, "骑士驱逐强盗 —— 选择新的落脚地块");
  } else if (card === "roadBuilding") {
    g.freeRoads += 2;
    pushLog(g, `${p.name} 打出「道路建设」，可免费修两条路`, p.color);
  } else if (card === "yearOfPlenty") {
    const picks = payload.picks ?? ["wheat", "wool"] as [ResourceId, ResourceId];
    for (const res of picks) p.hand[res] += 1;
    pushLog(g, `${p.name} 打出「丰收」，取得 ${RESOURCE_NAMES[picks[0]!]} 与 ${RESOURCE_NAMES[picks[1]!]}`, p.color);
  } else if (card === "monopoly") {
    const res = payload.resource ?? "wheat";
    let taken = 0;
    for (const other of g.players) {
      if (other.id === player) continue;
      taken += other.hand[res];
      other.hand[res] = 0;
    }
    p.hand[res] += taken;
    pushLog(g, `${p.name} 打出「垄断」，掠得 ${taken} 张${RESOURCE_NAMES[res]}`, p.color);
  }
  checkWin(g, events);
  return ok(g, events);
}

export function moveRobber(input: CatanGame, player: number, tileId: number): GameResult {
  const g = structuredClone(input);
  if (g.phase !== "robber") return fail("phase");
  if (g.robberMoved) return fail("robber_moved");
  const tile = g.tiles.find((t) => t.id === tileId);
  if (!tile) return fail("no_tile");
  if (tileId === g.robberTile) return fail("same_tile");
  g.robberTile = tileId;
  g.robberMoved = true;
  pushLog(g, `${g.players[player]!.name} 把强盗挪到了${tileName(g, tileId)}`, g.players[player]!.color);
  const events: GameEvent[] = [{ type: "robberMoved", tileId }];
  // 无人可抢则直接回到主阶段。
  if (robberVictims(g, player).length === 0) g.phase = "main";
  return ok(g, events);
}

export function steal(input: CatanGame, player: number, victim: number): GameResult {
  const g = structuredClone(input);
  if (g.phase !== "robber") return fail("phase");
  const p = g.players[player]!;
  const v = g.players[victim];
  if (!v || victim === player) return fail("no_victim");
  const pool: ResourceId[] = [];
  for (const res of Object.keys(v.hand) as ResourceId[]) {
    for (let i = 0; i < v.hand[res]; i++) pool.push(res);
  }
  if (pool.length > 0) {
    const res = pool[randInt(g, pool.length)]!;
    v.hand[res] -= 1;
    p.hand[res] += 1;
    pushLog(g, `${p.name} 从 ${v.name} 手中摸走 1 张${RESOURCE_NAMES[res]}`, p.color);
  }
  g.phase = "main";
  return ok(g, [{ type: "steal", from: victim, to: player }]);
}

/** 移动强盗后无人可抢（或放弃抢夺）时收尾。 */
export function endRobberMove(input: CatanGame): GameResult {
  const g = structuredClone(input);
  if (g.phase !== "robber") return fail("phase");
  g.phase = "main";
  return ok(g, []);
}

/* ------------------------------------------------------------------ */
/* 交易                                                                */
/* ------------------------------------------------------------------ */

export function proposeTrade(
  input: CatanGame,
  from: number,
  give: Partial<ResourceCount>,
  want: Partial<ResourceCount>,
  to: number,
): GameResult {
  const g = structuredClone(input);
  if (g.phase !== "roll" && g.phase !== "main") return fail("phase");
  if (g.pendingTrade) return fail("trade_pending");
  if (from === to) return fail("self");
  const payer = g.players[from]!;
  const filledGive = fillCount(give);
  const filledWant = fillCount(want);
  if (countTotal(filledGive) === 0 || countTotal(filledWant) === 0) return fail("empty_offer");
  if (!canAfford(payer.hand, filledGive)) return fail("cost");
  g.pendingTrade = { from, to, give: filledGive, want: filledWant };
  pushLog(
    g,
    `${payer.name} 提议：${countText(filledGive)} ⇄ ${countText(filledWant)}（向 ${g.players[to]!.name}）`,
    payer.color,
  );
  return ok(g, []);
}

export function respondTrade(input: CatanGame, accept: boolean): GameResult {
  const g = structuredClone(input);
  const pending = g.pendingTrade;
  if (!pending) return fail("no_trade");
  g.pendingTrade = null;
  const from = g.players[pending.from]!;
  const to = g.players[pending.to]!;
  if (accept) {
    if (!canAfford(from.hand, pending.give) || !canAfford(to.hand, pending.want)) {
      // 任何一方付不起：提议作废（状态已清，不回滚到挂起）。
      pushLog(g, `${to.name} 手头凑不齐资源，这笔提议作废了`);
      return ok(g, []);
    }
    pay(from.hand, pending.give);
    pay(to.hand, pending.want);
    for (const k of Object.keys(pending.give) as ResourceId[]) to.hand[k] += pending.give[k]!;
    for (const k of Object.keys(pending.want) as ResourceId[]) from.hand[k] += pending.want[k]!;
    pushLog(g, `${to.name} 接受了 ${from.name} 的提议`, to.color);
    return ok(g, [{ type: "tradeApplied", from: pending.from, to: pending.to }]);
  }
  pushLog(g, `${to.name} 婉拒了 ${from.name} 的提议`, to.color);
  return ok(g, []);
}

export function cancelTrade(input: CatanGame): GameResult {
  const g = structuredClone(input);
  if (!g.pendingTrade) return fail("no_trade");
  const pending = g.pendingTrade;
  g.pendingTrade = null;
  pushLog(g, `${g.players[pending.from]!.name} 撤回了交易提议`);
  return ok(g, []);
}

/** 与银行（港口）交易：按 tradeRate 用 n 张同种资源换 1 张目标资源。 */
export function bankTrade(input: CatanGame, player: number, give: ResourceId, want: ResourceId): GameResult {
  const g = structuredClone(input);
  if (g.phase !== "roll" && g.phase !== "main") return fail("phase");
  if (give === want) return fail("same_resource");
  const p = g.players[player]!;
  const rate = tradeRate(g, player, give);
  if (p.hand[give] < rate) return fail("cost");
  p.hand[give] -= rate;
  p.hand[want] += 1;
  pushLog(g, `${p.name} 以 ${rate} 张${RESOURCE_NAMES[give]}换得 1 张${RESOURCE_NAMES[want]}（${rate}:1）`, p.color);
  return ok(g, []);
}

export function endTurn(input: CatanGame): GameResult {
  const g = structuredClone(input);
  if (g.phase !== "roll" && g.phase !== "main") return fail("phase");
  const cur = g.players[g.turn]!;
  pushLog(g, `${cur.name} 结束回合`, cur.color);
  g.freeRoads = 0;
  g.robberMoved = false;
  g.turn = (g.turn + 1) % g.players.length;
  g.turnNo += 1;
  g.phase = "roll";
  return ok(g, []);
}

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

function fillCount(partial: Partial<ResourceCount>): ResourceCount {
  const full = emptyCount();
  for (const k of Object.keys(partial) as ResourceId[]) full[k] = partial[k] ?? 0;
  return full;
}

function countText(count: ResourceCount): string {
  const parts = (Object.keys(count) as ResourceId[]).filter((k) => count[k] > 0).map((k) => `${RESOURCE_NAMES[k]}×${count[k]}`);
  return parts.length > 0 ? parts.join(" + ") : "无";
}

export function tileName(g: CatanGame, tileId: number): string {
  const t = g.tiles.find((x) => x.id === tileId)!;
  return `${TERRAIN_RESOURCE[t.terrain] ? RESOURCE_NAMES[TERRAIN_RESOURCE[t.terrain]!] : "沙漠"}地块`;
}

/* ------------------------------------------------------------------ */
/* 座位投影（联机）：他人手牌/发展卡身份隐藏，牌库顺序剥离              */
/* ------------------------------------------------------------------ */

export function projectForSeat(g: CatanGame, player: number | null): CatanProjection {
  const state = structuredClone(g);
  const hand = player != null ? state.players[player]!.hand : emptyCount();
  const devCards = player != null ? [...state.players[player]!.dev] : [];
  const others: CatanProjection["others"] = {};
  for (const p of state.players) {
    if (p.id === player) {
      delete p.handCount;
      delete p.devCount;
      continue;
    }
    const handCount = countTotal(p.hand);
    const devCount = p.dev.length;
    others[p.id] = { handCount, devCount };
    p.hand = emptyCount();
    p.dev = [];
    p.handCount = handCount;
    p.devCount = devCount;
  }
  const devDeckCount = state.devDeck.length;
  state.devDeck = [];
  return { state, hand, devCards, devDeckCount, others };
}
