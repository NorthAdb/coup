import type { RoomRecord, RoomRegistry } from "../roomRegistry.js";

/**
 * 平台层游戏模块接口（ADR-0010）。
 *
 * 平台栈（gameRoomStack）负责与具体规则无关的联机编排：房间/座位/大厅门禁、
 * 心跳离席、回合计时与超时代打、增量轮询、观战、续局、重启恢复、空房回收、
 * 持久化接缝。游戏模块（games/*）只回答「规则是什么」：
 * 怎么开局、谁的回合、合法命令怎么校验、状态怎么投影。
 *
 * 新增一款游戏的接入清单见 docs/platform/adding-a-game.md。
 */

/** 平台栈依赖的最小对局状态面。 */
export type StackMatchState = {
  matchId: string;
  stateVersion: number;
  status: string;
};

export type StackMatch<S extends StackMatchState = StackMatchState> = {
  state: S;
  events: unknown[];
  humanSeatId: string;
  displayNames: Record<string, string>;
};

export type GameRunRecord<S extends StackMatchState = StackMatchState> = {
  matchId: string;
  roomCode: string | null;
  runStatus: string;
  humanSeatId: string;
  displayNames: Record<string, string>;
  state: S;
  events: unknown[];
};

/** 对局持久化接缝：各游戏用自己的 SQLite 表实现（match_runs / brass_runs）。 */
export type GameMatchStore<S extends StackMatchState = StackMatchState> = {
  createRun(input: {
    matchId: string;
    roomCode: string;
    humanSeatId: string;
    displayNames: Record<string, string>;
    state: S;
    events: unknown[];
  }): void;
  commitCommand(matchId: string, state: S, newEvents: unknown[]): void;
  getRun(matchId: string): GameRunRecord<S> | null;
  technicalAbort(matchId: string, reason: string): void;
  userAbort(matchId: string): void;
};

/** 房间持久化接缝：rooms / brass_rooms 两张同构表。 */
export type GameRoomPersistence = {
  saveRoom(room: RoomRecord): void;
  clearRoom(code: string): void;
  loadRooms(): {
    rooms: RoomRecord[];
    failures: Array<{ roomCode: string | null; reason: string }>;
  };
};

/** 平台栈视角的对局内座位事实（心跳追踪/空房判定/凭证解析共用）。 */
export type GameSeatFact = {
  seatId: string;
  controller: "local_human" | "remote_human" | "other";
  eliminated: boolean;
};

/** 开局时平台栈交给模块的座位清单（来自大厅有效座位）。 */
export type GameSeatInput = {
  seatId: string;
  kind: "local_human" | "remote_human";
  displayName: string;
};

/** 决策/轮询响应中 view 之外的游戏附加顶层字段。 */
export type GameViewPayload = { view: unknown } & Record<string, unknown>;

export type GameStartContext<S extends StackMatchState = StackMatchState> = {
  matchId: string;
  roomCode: string;
  seats: GameSeatInput[];
  store: GameMatchStore<S>;
};

export type GameDecisionOptions<S extends StackMatchState = StackMatchState> = {
  store: GameMatchStore<S>;
  actingSeatId: string;
};

export type GameHostContext = {
  bindMode: "local" | "host";
  port: number;
  lanHost: string | null;
  candidates: string[];
};

export type GameModule<M extends StackMatch<any> = StackMatch<any>> = {
  /** URL 段与恢复清单标识："coup" / "brass"。 */
  id: string;
  /** 房间路由前缀段："" → /api/rooms…；"brass" → /api/brass/rooms…。 */
  apiPrefix: string;
  /** 房间座位数（含房主）。 */
  seatCount: number;
  /** 并行房间上限。 */
  maxRooms: number;
  /** 建房是否要求可解析的局域网/公网主机（coup 需要，brass 允许 joinUrl 为空）。 */
  createRequiresLanHost: boolean;
  /** 未知房号查询是否按 IP 限速（coup 开启）。 */
  throttleRoomLookup: boolean;
  /** 恢复清单响应的列表键（coup 客户端读 rooms，brass 客户端读 items）。 */
  recoveryListKey: "rooms" | "items";

  newMatchId(): string;
  startMatch(input: GameStartContext<M["state"]>): Promise<M> | M;
  matchFromRun(run: GameRunRecord<M["state"]>): M;

  seatFacts(state: M["state"]): GameSeatFact[];
  activeDecidingSeatId(state: M["state"]): string | null;
  /** 超时代打计划：payload 会原样走 submitDecision，与人类决策同通路。 */
  planAutoDecision(
    state: M["state"],
    seatId: string,
  ): { payload: unknown; kind: string } | null;

  submitDecision(
    match: M,
    payload: unknown,
    options: GameDecisionOptions<M["state"]>,
  ):
    | Promise<{ ok: true; match: M } | { ok: false; reason: string }>
    | { ok: true; match: M }
    | { ok: false; reason: string };
  seatView(match: M, seatId: string, requestId?: string): GameViewPayload;
  spectatorView(match: M): GameViewPayload;

  /** 开局前钩子（如 brass 自动关闭空位、座位连续性校验）；返回错误码拒绝开局。 */
  beforeStart?(room: RoomRecord, registry: RoomRegistry): string | null;
  /** 离席座位的强制淘汰处置；未提供则平台回 disposition_not_supported。 */
  hostForceEliminate?(
    match: M,
    seatId: string,
  ):
    | { ok: true; state: M["state"]; events: unknown[] }
    | { ok: false; reason: string };

  /** 建房/查询房间的邀请载荷（joinUrl、座位、限时等）。 */
  invitePayload(room: RoomRecord, host: GameHostContext): Record<string, unknown>;
};
