/**
 * 卡坦岛规则引擎 —— 类型定义。
 *
 * 纯函数、无 IO、无 React、无 DOM。覆盖棋盘生成、骰子生产、建造合法性与花费、
 * 交易、强盗、发展卡、胜利点，以及联机所需的命令协议与座位投影（protocol.ts）。
 * 完整规则（起始放置流程、>7 弃牌、出牌限制等）刻意不做，见 .scratch/catan/spec.md。
 */

export type Terrain = "forest" | "pasture" | "fields" | "hills" | "mountains" | "desert";

export type ResourceId = "wood" | "brick" | "wool" | "wheat" | "ore";

export const RESOURCES: readonly ResourceId[] = ["wood", "brick", "wool", "wheat", "ore"];

export const RESOURCE_NAMES: Record<ResourceId, string> = {
  wood: "木材",
  brick: "砖石",
  wool: "羊毛",
  wheat: "小麦",
  ore: "矿石",
};

export const TERRAIN_NAMES: Record<Terrain, string> = {
  forest: "森林",
  pasture: "草原",
  fields: "麦田",
  hills: "丘陵",
  mountains: "山脉",
  desert: "沙漠",
};

export const TERRAIN_RESOURCE: Partial<Record<Terrain, ResourceId>> = {
  forest: "wood",
  pasture: "wool",
  fields: "wheat",
  hills: "brick",
  mountains: "ore",
};

export type ResourceCount = Record<ResourceId, number>;

export function emptyCount(): ResourceCount {
  return { wood: 0, brick: 0, wool: 0, wheat: 0, ore: 0 };
}

/** 六边形地块：axial 坐标（pointy-top），value 为数字 token（2–12，沙漠为 null）。 */
export interface CatanTile {
  id: number;
  q: number;
  r: number;
  terrain: Terrain;
  value: number | null;
}

/** 顶点：可放村庄/城市。坐标为布局空间（单位 = 六边形外接圆半径）。 */
export interface Vertex {
  id: number;
  x: number;
  y: number;
  tiles: number[];
  neighbors: number[];
  /** 是否为某港口的靠岸顶点（决定 2:1/3:1 航海交易率）。 */
  harbor: number | null;
}

/** 边：可放道路，连接两个顶点。 */
export interface Edge {
  id: number;
  a: number;
  b: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  tiles: number[];
  /** 海岸线边（恰邻一块陆地）且被选为港口泊位。 */
  harbor: number | null;
}

export type HarborKind = ResourceId | "any";

export interface Harbor {
  id: number;
  kind: HarborKind;
  /** 对应海岸边的 id（港亭画在边中点向外推的方向上）。 */
  edge: number;
}

export type DevCardKind = "knight" | "vp" | "roadBuilding" | "yearOfPlenty" | "monopoly";

export const DEV_NAMES: Record<DevCardKind, string> = {
  knight: "骑士",
  vp: "胜利点",
  roadBuilding: "道路建设",
  yearOfPlenty: "丰收",
  monopoly: "垄断",
};

export interface PlayerState {
  id: number;
  name: string;
  /** 玩家主题色（低饱和，同时用于建筑/道路/徽章）。 */
  color: string;
  /** 联机版里 false 表示服务器机器人座位。 */
  isHuman: boolean;
  hand: ResourceCount;
  /** 未打出的发展卡。 */
  dev: DevCardKind[];
  /** 已打出（公开）的发展卡。 */
  playedDev: DevCardKind[];
  knightsPlayed: number;
  /** 仅座位投影填充：他人手牌/发展卡隐藏后仍可读数量。权威态不依赖。 */
  handCount?: number;
  devCount?: number;
}

export interface RoadPiece {
  edge: number;
  owner: number;
}

export interface BuildingPiece {
  vertex: number;
  owner: number;
  city: boolean;
}

export interface LogEntry {
  seq: number;
  text: string;
  /** 玩家主题色（可选，日志前色点用）。 */
  color?: string;
}

export interface PendingTrade {
  from: number;
  to: number;
  give: ResourceCount;
  want: ResourceCount;
}

export type GamePhase = "roll" | "main" | "robber" | "over";

export interface PlayerScore {
  player: number;
  total: number;
  buildings: number;
  vpCards: number;
  longestRoad: number;
  largestArmy: number;
}

export interface CatanGame {
  matchId: string;
  stateVersion: number;
  /** 平台栈语义的对局状态；finished 与 phase === "over" 同步。 */
  status: "in_progress" | "finished";
  tiles: CatanTile[];
  vertices: Vertex[];
  edges: Edge[];
  harbors: Harbor[];
  robberTile: number;
  players: PlayerState[];
  roads: RoadPiece[];
  buildings: BuildingPiece[];
  /** 当前行动玩家下标。 */
  turn: number;
  turnNo: number;
  phase: GamePhase;
  /** 本阶段强盗是否已被移动过（每阶段限一次；防原始命令重复挪动）。 */
  robberMoved: boolean;
  /** 最近一次掷骰结果（联机视图展示用）。 */
  lastDice: { a: number; b: number } | null;
  /** 「道路建设」剩余免费道路数。 */
  freeRoads: number;
  devDeck: DevCardKind[];
  longestRoadOwner: number | null;
  largestArmyOwner: number | null;
  pendingTrade: PendingTrade | null;
  /** 终局时冻结的全员明分（含隐藏的发展卡分），结算页用。 */
  finalScores: PlayerScore[] | null;
  log: LogEntry[];
  seq: number;
  winner: number | null;
  /** 内部确定性随机状态（mulberry32）。 */
  rngState: number;
}

export type GameEvent =
  | { type: "dice"; a: number; b: number }
  | { type: "produce"; tileId: number; player: number; resource: ResourceId; n: number }
  | { type: "build"; kind: "road" | "settlement" | "city"; player: number; key: number }
  | { type: "dev"; player: number; card: DevCardKind }
  | { type: "robberMoved"; tileId: number }
  | { type: "steal"; from: number; to: number }
  | { type: "tradeApplied"; from: number; to: number }
  | { type: "win"; player: number };

export type GameResult =
  | { ok: true; game: CatanGame; events: GameEvent[] }
  | { ok: false; code: string };

export const BUILD_COSTS = {
  road: { wood: 1, brick: 1 } as Partial<ResourceCount>,
  settlement: { wood: 1, brick: 1, wheat: 1, wool: 1 } as Partial<ResourceCount>,
  city: { wheat: 2, ore: 3 } as Partial<ResourceCount>,
  dev: { wool: 1, wheat: 1, ore: 1 } as Partial<ResourceCount>,
};

/** 玩家主题色（低饱和）：联机与本地共用，建筑/道路/徽章同色系。 */
export const PLAYER_COLORS: readonly string[] = ["#b3573f", "#3f6d8e", "#5d7048", "#c9973f"];

/** 产出飘卡动画的载荷（UI 用；从某地块向某玩家飘 n 张资源）。 */
export interface FloatChip {
  id: number;
  tileId: number;
  player: number;
  resource: ResourceId;
  n: number;
}

/* ------------------------------------------------------------------ */
/* 联机命令协议与座位投影                                              */
/* ------------------------------------------------------------------ */

export const CATAN_PROTOCOL_VERSION = 1;

/**
 * 原子命令（ADR-0009 经验：一次提交整动作全部参数）。
 * player 为玩家下标；大多数命令要求 player === g.turn（respond_trade 例外，
 * 归属 pendingTrade.to；cancel_trade 归属 pendingTrade.from）。
 */
export type CatanCommand =
  | { type: "roll"; player: number }
  | { type: "build_road"; player: number; edgeId: number; free?: boolean }
  | { type: "build_settlement"; player: number; vertexId: number }
  | { type: "build_city"; player: number; vertexId: number }
  | { type: "buy_dev"; player: number }
  | { type: "play_dev"; player: number; card: DevCardKind; picks?: [ResourceId, ResourceId]; resource?: ResourceId }
  | { type: "move_robber"; player: number; tileId: number }
  | { type: "steal"; player: number; victim: number }
  | { type: "end_robber_move"; player: number }
  | { type: "propose_trade"; player: number; to: number; give: Partial<ResourceCount>; want: Partial<ResourceCount> }
  | { type: "respond_trade"; player: number; accept: boolean }
  | { type: "cancel_trade"; player: number }
  | { type: "bank_trade"; player: number; give: ResourceId; want: ResourceId }
  | { type: "end_turn"; player: number };

export type CatanApplyResult =
  | { ok: true; state: CatanGame; events: GameEvent[] }
  | { ok: false; code: string };

export type CatanDecisionPayload = {
  protocolVersion: number;
  requestId: string;
  stateVersion: number;
  command: CatanCommand;
};

/**
 * 座位投影：他人手牌与发展卡身份隐藏（保留数量），牌库顺序剥离。
 * 投影态仍可跑 legalRoads/legalSettlements 等公开查询（robberVictims 依赖
 * handCount 兜底）。player 为 null 时按观战投影（hand 为空计数）。
 */
export interface CatanProjection {
  state: CatanGame;
  /** 本人手牌（观战为全零）。 */
  hand: ResourceCount;
  /** 本人未打出的发展卡（观战为空）。 */
  devCards: DevCardKind[];
  /** 牌库剩余张数（顺序不外泄）。 */
  devDeckCount: number;
  /** 他人公开信息（handCount/devCount 已填进投影后的 players）。 */
  others: Record<number, { handCount: number; devCount: number }>;
}
