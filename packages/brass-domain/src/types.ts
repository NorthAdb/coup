/**
 * Brass: Birmingham 领域类型。
 * 状态为纯数据；所有变更经由 applyCommand（原子复合命令）。
 */

export type IndustryType = 'cotton' | 'manufacturer' | 'pottery' | 'coal' | 'iron' | 'brewery';
export type Era = 'canal' | 'rail';
export type PlayerCount = 2 | 3 | 4;

/** 版图节点：可建地点（含 2 个农场酒厂）或商人位。 */
export type NodeId = string;

export type GoodsType = 'cotton' | 'manufacturer' | 'pottery';

export interface TileSpec {
  industry: IndustryType;
  level: number;
  count: number;
  /** 可建造时代（canalOnly=铁路时代禁建，railOnly=运河时代禁建）。 */
  eras: 'both' | 'canalOnly' | 'railOnly';
  costMoney: number;
  costCoal: number;
  costIron: number;
  /** Sell 翻面所需啤酒数（棉/制造/陶）。 */
  beersToSell: number;
  /** 翻面后时代末 VP。 */
  vp: number;
  /** 翻面时收入轨前进格数。 */
  income: number;
  /** 翻面瓦片上的连接图标数（时代末 Link 计分）。 */
  linkPoints: number;
  /** 煤矿产煤 / 铁厂产铁 数量。 */
  produces: number;
  /** 灯泡陶：不可 Develop。 */
  lightbulb: boolean;
}

export interface SlotDef {
  /** 该槽允许的产业。 */
  industries: IndustryType[];
}

export interface LocationDef {
  name: string;
  slots: SlotDef[];
  /** 农场酒厂：只能用 Brewery 产业卡或 Wild Industry 卡。 */
  farm?: boolean;
}

export interface MerchantDef {
  name: string;
  /** 商人板位数。 */
  slots: number;
  /** 板位进入游戏的最小人数（Warrington 3p+、Nottingham 4p）。 */
  minPlayers: PlayerCount;
  /** 喝该位商人啤酒的奖励。 */
  bonus:
    | { type: 'vp'; amount: number }
    | { type: 'money'; amount: number }
    | { type: 'income'; amount: number }
    | { type: 'develop' };
}

/** 连接边（Link 线）。 */
export interface LinkDef {
  id: string;
  a: NodeId;
  b: NodeId;
  /** 三端点边（Kidderminster–南农场–Worcester）。 */
  via?: NodeId;
  canal: boolean;
  rail: boolean;
}

// ---------------------------------------------------------------------------
// 对局内实体
// ---------------------------------------------------------------------------

export type CardKind =
  | { kind: 'location'; location: NodeId }
  | { kind: 'industry'; industries: IndustryType[] }
  | { kind: 'wild-location' }
  | { kind: 'wild-industry' };

export type Card = { id: string } & CardKind;

/** 场上产业板块。 */
export interface PlacedTile {
  id: string;
  location: NodeId;
  slotIndex: number;
  industry: IndustryType;
  level: number;
  player: number;
  flipped: boolean;
  coal: number;
  iron: number;
  beer: number;
}

/** 场上 Link。 */
export interface PlacedLink {
  id: string;
  linkIndex: number;
  player: number;
  era: Era;
}

/** 已放置的商人板块（某个板位上的具体板块）。 */
export interface PlacedMerchant {
  /** 板位 id，如 'gloucester#2'。 */
  slotId: string;
  location: string;
  /** 收购的货物；万能板为三种全收。 */
  goods: GoodsType[];
  /** 空白板：不收货、无啤酒。 */
  blank: boolean;
  beer: boolean;
}

export interface PlayerState {
  money: number;
  /** 收入轨格（0-99）。 */
  incomeSpace: number;
  vp: number;
  /** 本轮花费（决定下轮座次）。 */
  spent: number;
  /** 手牌（card id）。 */
  hand: string[];
  /** 弃牌堆。 */
  discard: string[];
  /** 面板剩余板块：各产业的等级多重集。 */
  mat: Record<IndustryType, number[]>;
}

export type LogKind =
  | 'build'
  | 'overbuild'
  | 'network'
  | 'develop'
  | 'sell'
  | 'loan'
  | 'scout'
  | 'pass'
  | 'flip'
  | 'market_sell'
  | 'market_buy'
  | 'beer'
  | 'merchant_bonus'
  | 'income'
  | 'shortfall'
  | 'era_score'
  | 'era_end'
  | 'game_end';

export interface LogEntry {
  seq: number;
  kind: LogKind;
  player?: number;
  /** 结构化负载，web 层负责本地化文案。 */
  payload?: Record<string, string | number | boolean>;
}

export type MatchStatus = 'in_progress' | 'finished';
export type MatchPhase = 'await_action' | 'await_shortfall_removal';

export interface BrassState {
  matchId: string;
  seed: string;
  status: MatchStatus;
  stateVersion: number;
  phase: MatchPhase;
  playerCount: PlayerCount;
  era: Era;
  /** 本时代回合数（1 起）。 */
  round: number;
  /** 当前行动玩家（player index）。 */
  currentPlayer: number;
  /** 本回合剩余行动数（1 或 2）。 */
  actionsLeft: number;
  /** 轮转后的座次（player index 顺序）。 */
  turnOrder: number[];
  players: PlayerState[];
  placedTiles: PlacedTile[];
  placedLinks: PlacedLink[];
  merchantTiles: PlacedMerchant[];
  /** 煤市场方块数（0-14）。 */
  coalMarket: number;
  /** 铁市场方块数（0-10）。 */
  ironMarket: number;
  deck: string[];
  wildLocationArea: number;
  wildIndustryArea: number;
  /** 缺额拆板阶段的目标玩家与剩余缺口。 */
  shortfall: { player: number; amount: number } | null;
  /** 同一轮中还有缺额的玩家队列。 */
  shortfallQueue: { player: number; amount: number }[];
  log: LogEntry[];
  /** 各玩家剩余 Link 数（每人每时代 14）。 */
  linksLeft: number[];
  winner: number | null;
  /** 终局结算摘要。 */
  finalScores: { player: number; vp: number; income: number; money: number }[] | null;
  /** 联机 AI 座位（player 下标；平台层开局时写入，旧快照缺省视为无）。 */
  botPlayers?: number[];
}

// ---------------------------------------------------------------------------
// 资源来源与命令
// ---------------------------------------------------------------------------

export type CoalSource = { kind: 'mine'; tileId: string } | { kind: 'market' };
export type IronSource = { kind: 'works'; tileId: string } | { kind: 'market' };
export type BeerSource =
  | { kind: 'brewery'; tileId: string }
  | { kind: 'merchant'; merchantSlotId: string };

export interface BrassCommandBase {
  expectedVersion: number;
}

export type BrassCommand = BrassCommandBase &
  (
    | {
        type: 'pass';
        player: number;
        cardId: string;
      }
    | {
        type: 'build';
        player: number;
        cardId: string;
        /** 产业卡/双图标卡需要显式选择产业；地点卡可省略（任意产业）。 */
        industry: IndustryType;
        location: NodeId;
        slotIndex: number;
        /** 覆盖目标（已放置板块 id）；省略则放到空槽 slotIndex。 */
        overbuildTileId?: string;
        coalSources: CoalSource[];
        ironSources: IronSource[];
      }
    | {
        type: 'network';
        player: number;
        cardId: string;
        /** 铁路时代双轨时为 2 条。 */
        links: { linkIndex: number; coalSources: CoalSource[] }[];
        /** 双轨啤酒来源。 */
        beerSource?: BeerSource;
      }
    | {
        type: 'develop';
        player: number;
        cardId: string;
        /** 要移除的产业（1-2 个，逐个取当时最低级）。 */
        industries: IndustryType[];
        ironSources: IronSource[];
      }
    | {
        type: 'sell';
        player: number;
        cardId: string;
        sales: {
          tileId: string;
          merchantSlotId: string;
          beerSources: BeerSource[];
          /** 消耗 Gloucester 商人啤酒时的免费 Develop 目标产业。 */
          developIndustry?: IndustryType;
        }[];
      }
    | {
        type: 'loan';
        player: number;
        cardId: string;
      }
    | {
        type: 'scout';
        player: number;
        /** 共 3 张。 */
        cardIds: string[];
      }
    | {
        type: 'shortfall_removal';
        player: number;
        /** 拆除的场上板块 id；一次一块。 */
        tileId: string;
      }
  );

export type ApplyResult =
  | { ok: true; state: BrassState; events: LogEntry[] }
  | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// 事件（投影给客户端的日志条目复用 LogEntry）
// ---------------------------------------------------------------------------

export interface CreateMatchInput {
  matchId: string;
  seed: string;
  playerCount: PlayerCount;
}
