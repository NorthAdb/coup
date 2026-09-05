import type { CatanCommand, CatanGame, DevCardKind, GameEvent, ResourceCount } from "@coup/catan-domain";
import {
  createRoomClient,
  ensureSession,
  type LobbySeatLike,
  type SeatAbsenceLike,
} from "../platform/roomApi.js";

/** Catan 房间客户端（ADR-0010）：传输与端点来自平台层（前缀 "catan"）。 */
const catan = createRoomClient("catan");

export { ensureSession as ensureCatanSession };

export type CatanLobbySeat = LobbySeatLike;

export type CatanRoomInvite = {
  code: string;
  phase: "lobby" | "match" | "rematch" | string;
  game: "catan";
  seats?: CatanLobbySeat[];
  turnTimeLimitSec?: number;
  joinUrl: string | null;
  lanOrigin: string | null;
  bindMode: string;
  error?: string | null;
};

export type CatanSeatAbsence = SeatAbsenceLike;

export type CatanView = {
  protocolVersion: number;
  requestId: string;
  matchId: string;
  stateVersion: number;
  seatId: string;
  game: "catan";
  spectator: boolean;
  state: CatanGame;
  hand: ResourceCount;
  devCards: DevCardKind[];
  devDeckCount: number;
  others: Record<number, { handCount: number; devCount: number }>;
  events: GameEvent[];
  decidingSeatId: string | null;
  isYourTurn: boolean;
  displayName: string | null;
  displayNames: Record<string, string>;
};

export type CatanMatchPollBody = {
  view?: CatanView;
  unchanged?: boolean;
  stateVersion?: number;
  absences?: CatanSeatAbsence[];
  pausedForAbsenceSeatId?: string | null;
  turnDeadline?: { seatId: string; deadlineAt: number; durationMs: number } | null;
  autoDecision?: { seatId: string; at: number; kind: string } | null;
  error?: string;
};

// ------------------------------------------------------------------
// 房间
// ------------------------------------------------------------------

export function createCatanRoom(): Promise<CatanRoomInvite> {
  return catan.createRoom() as Promise<CatanRoomInvite>;
}

export function fetchCatanRoom(code: string): Promise<CatanRoomInvite> {
  return catan.fetchRoom("", code) as Promise<CatanRoomInvite>;
}

export function fetchMyCatanSeat(code: string): Promise<{ seat: CatanLobbySeat | null; seats: CatanLobbySeat[] }> {
  return catan.fetchMySeat("", code);
}

export function claimCatanSeat(code: string, seatId: string, displayName: string) {
  return catan.claimSeat("", code, seatId, displayName);
}

export function leaveCatanSeat(code: string) {
  return catan.leaveSeat("", code) as Promise<{ released: boolean; seatId: string; seats: CatanLobbySeat[] }>;
}

export function renameCatanSeat(code: string, seatId: string, displayName: string) {
  return catan.renameSeat("", code, seatId, displayName);
}

export function configureCatanSeat(code: string, seatId: string, kind: "open" | "closed" | "bot") {
  return catan.configureSeat("", code, seatId, { kind });
}

export function updateCatanSettings(code: string, turnTimeLimitSec: number) {
  return catan.updateSettings("", code, { turnTimeLimitSec });
}

export function startCatanMatchOn(code: string) {
  return catan.start("", code) as Promise<CatanMatchPollBody>;
}

export function postCatanHeartbeat(code: string) {
  return catan.heartbeat("", code);
}

export function fetchCatanPresence(code: string) {
  return catan.fetchPresence("", code);
}

export function resumeCatanSeat(code: string) {
  return catan.resumeSeat("", code);
}

export function enterCatanRematch(code: string) {
  return catan.enterRematch("", code) as Promise<{ phase: string; seats: CatanLobbySeat[] }>;
}

export function confirmCatanRematch(code: string) {
  return catan.confirmRematch("", code) as Promise<{ seats: CatanLobbySeat[] }>;
}

export function declineCatanRematch(code: string) {
  return catan.declineRematch("", code) as Promise<{ seats: CatanLobbySeat[] }>;
}

// ------------------------------------------------------------------
// 对局轮询与决策
// ------------------------------------------------------------------

export function fetchCatanMatch(code: string, query?: { since?: number; spectate?: boolean }): Promise<CatanMatchPollBody> {
  return catan.fetchMatch("", code, query) as Promise<CatanMatchPollBody>;
}

export function submitCatanCommand(code: string, command: CatanCommand, requestId: string, stateVersion: number): Promise<CatanMatchPollBody> {
  return catan.submitDecision("", code, {
    protocolVersion: 1,
    requestId,
    stateVersion,
    command,
  }) as Promise<CatanMatchPollBody>;
}

/** 面向用户的错误文案映射。 */
export function catanErrorText(e: unknown): string {
  const code = (e as { code?: string }).code ?? (e instanceof Error ? e.message : "");
  switch (code) {
    case "room_not_found":
      return "房间不存在或已被回收";
    case "room_capacity_reached":
      return "房间已满，稍后再试";
    case "seat_not_open":
      return "这个座位刚被别人坐下了";
    case "session_required":
    case "csrf_invalid":
      return "会话过期，刷新页面重试";
    case "not_your_turn":
      return "还没轮到你";
    case "version_mismatch":
      return "局面已更新，重试一次";
    case "open_seats_remain":
      return "还有空位未安排（关闭或加AI）";
    case "seats_not_contiguous":
      return "座位需要从 1 号连续排布";
    case "hosting_unavailable":
    case "need_host_mode":
      return "服务器暂未开放建房";
    default:
      if (e instanceof Error && e.message) return e.message;
      return "出了点小状况，稍后再试";
  }
}
