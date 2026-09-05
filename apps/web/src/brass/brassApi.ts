import type { BrassCommand, BrassState } from "@coup/brass-domain";
import {
  createRoomClient,
  ensureSession,
  type LobbySeatLike,
  type SeatAbsenceLike,
} from "../platform/roomApi.js";

/** Brass 房间客户端（ADR-0010）：传输与端点来自平台层（前缀 "brass"）。 */
const brass = createRoomClient("brass");

export { ensureSession as ensureBrassSession };

export type BrassLobbySeat = LobbySeatLike;

export type BrassRoomInvite = {
  code: string;
  phase: "lobby" | "match" | "rematch" | string;
  game: "brass";
  seats?: BrassLobbySeat[];
  turnTimeLimitSec?: number;
  joinUrl: string | null;
  lanOrigin: string | null;
  bindMode: string;
  error?: string | null;
};

export type BrassSeatAbsence = SeatAbsenceLike;

export type BrassView = {
  protocolVersion: number;
  requestId: string;
  matchId: string;
  stateVersion: number;
  seatId: string;
  game: "brass";
  spectator: boolean;
  state: BrassState;
  hand: string[];
  othersHandCount: Record<number, number>;
  decidingSeatId: string | null;
  isYourTurn: boolean;
  displayName: string | null;
  displayNames: Record<string, string>;
};

export type BrassMatchPollBody = {
  view?: BrassView;
  unchanged?: boolean;
  stateVersion?: number;
  absences?: BrassSeatAbsence[];
  pausedForAbsenceSeatId?: string | null;
  turnDeadline?: { seatId: string; deadlineAt: number; durationMs: number } | null;
  autoDecision?: { seatId: string; at: number; kind: string } | null;
  error?: string;
};

// ------------------------------------------------------------------
// 房间
// ------------------------------------------------------------------

export function createBrassRoom(): Promise<BrassRoomInvite> {
  return brass.createRoom() as Promise<BrassRoomInvite>;
}

export function fetchBrassRoom(code: string): Promise<BrassRoomInvite> {
  return brass.fetchRoom("", code) as Promise<BrassRoomInvite>;
}

export function fetchMyBrassSeat(code: string): Promise<{ seat: BrassLobbySeat | null; seats: BrassLobbySeat[] }> {
  return brass.fetchMySeat("", code);
}

export function claimBrassSeat(code: string, seatId: string, displayName: string) {
  return brass.claimSeat("", code, seatId, displayName);
}

export function leaveBrassSeat(code: string) {
  return brass.leaveSeat("", code) as Promise<{ released: boolean; seatId: string; seats: BrassLobbySeat[] }>;
}

export function renameBrassSeat(code: string, seatId: string, displayName: string) {
  return brass.renameSeat("", code, seatId, displayName);
}

export function configureBrassSeat(code: string, seatId: string, kind: "open" | "closed") {
  return brass.configureSeat("", code, seatId, { kind });
}

export function updateBrassSettings(code: string, turnTimeLimitSec: number) {
  return brass.updateSettings("", code, { turnTimeLimitSec });
}

export function startBrassMatchOn(code: string) {
  return brass.start("", code) as Promise<BrassMatchPollBody>;
}

export function postBrassHeartbeat(code: string) {
  return brass.heartbeat("", code);
}

export function fetchBrassPresence(code: string) {
  return brass.fetchPresence("", code);
}

export function resumeBrassSeat(code: string) {
  return brass.resumeSeat("", code);
}

export function postBrassDisposition(code: string, seatId: string, action: "extend_wait" | "technical_abort") {
  return brass.disposition("", code, seatId, action);
}

export function enterBrassRematch(code: string) {
  return brass.enterRematch("", code) as Promise<{ phase: string; seats: BrassLobbySeat[] }>;
}

// 续局确认/离开按座位凭证路由（与 coup 同一平台端点；旧实现多带了
// seatId 路径段，服务端从不匹配，导致线上续局无法确认）。
export function confirmBrassRematch(code: string) {
  return brass.confirmRematch("", code) as Promise<{ seats: BrassLobbySeat[] }>;
}

export function declineBrassRematch(code: string) {
  return brass.declineRematch("", code) as Promise<{ seats: BrassLobbySeat[] }>;
}

export function fetchBrassRecovery() {
  return brass.fetchRecovery() as Promise<{
    items: Array<{ code: string; status: string; reason: string | null; game: string; phase: string | null }>;
  }>;
}

export function abandonBrassRecovery(roomCode: string) {
  return brass.abandonRecovery("", roomCode) as Promise<{ abandoned: boolean }>;
}

// ------------------------------------------------------------------
// 对局轮询与决策
// ------------------------------------------------------------------

export function brassMatchUrl(code: string, query?: { since?: number; spectate?: boolean }): string {
  return brass.matchCurrentPath(code, false, query);
}

export function fetchBrassMatch(code: string, query?: { since?: number; spectate?: boolean }): Promise<BrassMatchPollBody> {
  return brass.fetchMatch("", code, query) as Promise<BrassMatchPollBody>;
}

export function submitBrassCommand(code: string, command: BrassCommand, requestId: string): Promise<BrassMatchPollBody> {
  return brass.submitDecision("", code, {
    protocolVersion: 1,
    requestId,
    stateVersion: command.expectedVersion,
    command,
  }) as Promise<BrassMatchPollBody>;
}
