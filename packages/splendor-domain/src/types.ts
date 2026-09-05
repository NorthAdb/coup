/**
 * 《璀璨宝石》领域类型。状态为纯数据；所有变更经由 applyCommand（原子复合命令）。
 * 规则基准：官方基础版（2–4 人，90 张发展卡 + 10 张贵族，无扩展）。
 */

export type GemColor = "white" | "blue" | "green" | "red" | "black";
export type PlayerCount = 2 | 3 | 4;
export type CardLevel = 1 | 2 | 3;

/** 各色宝石数量（不含黄金）。 */
export type GemCount = Record<GemColor, number>;

export interface DevCard {
  id: string;
  level: CardLevel;
  /** 卡牌颜色 = 永久宝石加成。 */
  color: GemColor;
  points: number;
  cost: GemCount;
}

export interface Noble {
  id: string;
  /** 历史人物名（官方贵族牌命名，用于展示）。 */
  name: string;
  /** 造访要求：按颜色计的已购发展卡张数（宝石不计）。 */
  requirements: GemCount;
  points: number;
}

export interface SplendorPlayer {
  index: number;
  gems: GemCount;
  gold: number;
  /** 预留卡（私有信息；投影按视角裁剪）。 */
  reserved: DevCard[];
  /** 已购卡按颜色的张数 = 永久加成。 */
  cards: GemCount;
  purchasedCount: number;
  nobles: string[];
  points: number;
}

export type SplendorPhase =
  | "action"
  | "await_discard"
  | "await_noble"
  | "finished";

/** 对局事件（同时是投影里的公开日志）。 */
export type SplendorEvent =
  | { seq: number; kind: "match_started"; playerCount: PlayerCount }
  | { seq: number; kind: "gems_taken"; player: number; gems: GemCount }
  | { seq: number; kind: "reserved"; player: number; level: CardLevel; fromDeck: boolean; goldTaken: boolean }
  | { seq: number; kind: "purchased"; player: number; card: DevCard; from: "table" | "hand"; goldUsed: number }
  | { seq: number; kind: "gems_discarded"; player: number; gems: GemCount }
  | { seq: number; kind: "noble_visits"; player: number; noble: Noble }
  | { seq: number; kind: "final_round"; player: number; points: number }
  | { seq: number; kind: "match_finished"; winners: number[]; standings: Array<{ player: number; points: number; cards: number }> };

export interface SplendorState {
  matchId: string;
  playerCount: PlayerCount;
  stateVersion: number;
  status: "in_progress" | "finished";
  phase: SplendorPhase;
  currentPlayer: number;
  /** 每级牌库（末位为牌堆顶）。 */
  decks: Record<CardLevel, DevCard[]>;
  /** 桌面明牌，每级固定 4 个槽位（null = 已被买走/预留且无牌可补）。 */
  table: Record<CardLevel, (DevCard | null)[]>;
  deckCounts: Record<CardLevel, number>;
  pool: GemCount;
  gold: number;
  players: SplendorPlayer[];
  /** 本局实际使用的贵族（人数 + 1 张）。 */
  nobles: Noble[];
  /** 有人达到 15 分后：本轮打完即终局。 */
  finalRound: boolean;
  /** 触发终局轮的玩家（轮转回到此人即收束）。 */
  endTriggerPlayer: number | null;
  /** 超上限待弃宝物的玩家（= currentPlayer）。 */
  discardExcess: number | null;
  /** 可自选贵族造访的待决玩家。 */
  nobleChoice: { player: number; candidates: string[] } | null;
  winners: number[];
  log: SplendorEvent[];
  /** 联机 AI 座位（player 下标；平台层开局时写入，旧快照缺省视为无）。 */
  botPlayers?: number[];
}

/** 投影给座位/观战视角的公开状态（裁剪牌库顺序与预留私有牌）。 */
export interface SplendorPublicPlayer extends Omit<SplendorPlayer, "reserved"> {}

export interface SplendorPublicState {
  matchId: string;
  playerCount: PlayerCount;
  stateVersion: number;
  status: "in_progress" | "finished";
  phase: SplendorPhase;
  currentPlayer: number;
  table: Record<CardLevel, (DevCard | null)[]>;
  deckCounts: Record<CardLevel, number>;
  pool: GemCount;
  gold: number;
  players: SplendorPublicPlayer[];
  nobles: Noble[];
  finalRound: boolean;
  endTriggerPlayer: number | null;
  discardExcess: number | null;
  nobleChoice: { player: number; candidates: string[] } | null;
  winners: number[];
  log: SplendorEvent[];  /** 联机 AI 座位（与权威态一致，投影透传）。 */
  botPlayers?: number[];
}

// ---------------------------------------------------------------------------
// 命令（原子；expectedVersion 乐观锁）
// ---------------------------------------------------------------------------

export type SplendorCommand =
  | { type: "take_gems"; player: number; expectedVersion: number; gems: GemColor[] }
  | { type: "reserve_table"; player: number; expectedVersion: number; level: CardLevel; slot: number }
  | { type: "reserve_deck"; player: number; expectedVersion: number; level: CardLevel }
  | { type: "purchase_table"; player: number; expectedVersion: number; level: CardLevel; slot: number }
  | { type: "purchase_reserved"; player: number; expectedVersion: number; cardId: string }
  | { type: "discard_gems"; player: number; expectedVersion: number; gems: GemCount }
  | { type: "choose_noble"; player: number; expectedVersion: number; nobleId: string };

export type SplendorDecisionPayload = {
  protocolVersion: number;
  requestId: string;
  stateVersion: number;
  command: SplendorCommand;
};

export type ApplyResult =
  | { ok: true; state: SplendorState; events: SplendorEvent[] }
  | { ok: false; reason: string };

export const GEM_COLORS: readonly GemColor[] = ["white", "blue", "green", "red", "black"];

export const TOKEN_LIMIT = 10;
export const RESERVED_LIMIT = 3;
export const WIN_SCORE = 15;
export const TABLE_SLOTS = 4;
