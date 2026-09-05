import type { GemColor, SplendorCommand, SplendorPublicState } from "@coup/splendor-domain";
import {
  createRoomClient,
  ensureSession,
  type LobbySeatLike,
  type SeatAbsenceLike,
} from "../platform/roomApi.js";

/** Splendor 房间客户端（ADR-0010）：传输与端点来自平台层（前缀 "splendor"）。 */
const splendor = createRoomClient("splendor");

export { ensureSession as ensureSplendorSession };

export type SplendorLobbySeat = LobbySeatLike;

export type SplendorRoomInvite = {
  code: string;
  phase: "lobby" | "match" | "rematch" | string;
  game: "splendor";
  seats?: SplendorLobbySeat[];
  turnTimeLimitSec?: number;
  joinUrl: string | null;
  lanOrigin: string | null;
  bindMode: string;
  error?: string | null;
};

export type SplendorSeatAbsence = SeatAbsenceLike;

export type SplendorView = {
  protocolVersion: number;
  requestId: string;
  matchId: string;
  stateVersion: number;
  seatId: string;
  game: "splendor";
  spectator: boolean;
  state: SplendorPublicState;
  yourReserved: Array<{ id: string; level: 1 | 2 | 3; color: GemColor; points: number; cost: Record<GemColor, number> }> | null;
  reservedCounts: number[];
  decidingSeatId: string | null;
  isYourTurn: boolean;
  displayName: string | null;
  displayNames: Record<string, string>;
};

export type SplendorMatchPollBody = {
  view?: SplendorView;
  unchanged?: boolean;
  stateVersion?: number;
  absences?: SplendorSeatAbsence[];
  pausedForAbsenceSeatId?: string | null;
  turnDeadline?: { seatId: string; deadlineAt: number; durationMs: number } | null;
  autoDecision?: { seatId: string; at: number; kind: string } | null;
  error?: string;
};

// ------------------------------------------------------------------
// 房间
// ------------------------------------------------------------------

export function createSplendorRoom(): Promise<SplendorRoomInvite> {
  return splendor.createRoom() as Promise<SplendorRoomInvite>;
}

export function fetchSplendorRoom(code: string): Promise<SplendorRoomInvite> {
  return splendor.fetchRoom("", code) as Promise<SplendorRoomInvite>;
}

export function fetchMySplendorSeat(code: string): Promise<{ seat: SplendorLobbySeat | null; seats: SplendorLobbySeat[] }> {
  return splendor.fetchMySeat("", code);
}

export function claimSplendorSeat(code: string, seatId: string, displayName: string) {
  return splendor.claimSeat("", code, seatId, displayName);
}

export function leaveSplendorSeat(code: string) {
  return splendor.leaveSeat("", code) as Promise<{ released: boolean; seatId: string; seats: SplendorLobbySeat[] }>;
}

export function renameSplendorSeat(code: string, seatId: string, displayName: string) {
  return splendor.renameSeat("", code, seatId, displayName);
}

export function configureSplendorSeat(code: string, seatId: string, kind: "open" | "closed" | "bot") {
  return splendor.configureSeat("", code, seatId, { kind });
}

export function updateSplendorSettings(code: string, turnTimeLimitSec: number) {
  return splendor.updateSettings("", code, { turnTimeLimitSec });
}

export function startSplendorMatchOn(code: string) {
  return splendor.start("", code) as Promise<SplendorMatchPollBody>;
}

export function postSplendorHeartbeat(code: string) {
  return splendor.heartbeat("", code);
}

export function fetchSplendorPresence(code: string) {
  return splendor.fetchPresence("", code);
}

export function resumeSplendorSeat(code: string) {
  return splendor.resumeSeat("", code);
}

export function postSplendorDisposition(code: string, seatId: string, action: "extend_wait" | "technical_abort") {
  return splendor.disposition("", code, seatId, action);
}

export function enterSplendorRematch(code: string) {
  return splendor.enterRematch("", code) as Promise<{ phase: string; seats: SplendorLobbySeat[] }>;
}

export function confirmSplendorRematch(code: string) {
  return splendor.confirmRematch("", code) as Promise<{ seats: SplendorLobbySeat[] }>;
}

export function declineSplendorRematch(code: string) {
  return splendor.declineRematch("", code) as Promise<{ seats: SplendorLobbySeat[] }>;
}

export function fetchSplendorRecovery() {
  return splendor.fetchRecovery() as Promise<{
    items: Array<{ code: string; status: string; reason: string | null; game: string; phase: string | null }>;
  }>;
}

export function abandonSplendorRecovery(roomCode: string) {
  return splendor.abandonRecovery("", roomCode) as Promise<{ abandoned: boolean }>;
}

// ------------------------------------------------------------------
// 对局轮询与决策
// ------------------------------------------------------------------

export function fetchSplendorMatch(code: string, query?: { since?: number; spectate?: boolean }): Promise<SplendorMatchPollBody> {
  return splendor.fetchMatch("", code, query) as Promise<SplendorMatchPollBody>;
}

export function submitSplendorCommand(code: string, command: SplendorCommand, requestId: string): Promise<SplendorMatchPollBody> {
  return splendor.submitDecision("", code, {
    protocolVersion: 1,
    requestId,
    stateVersion: command.expectedVersion,
    command,
  }) as Promise<SplendorMatchPollBody>;
}
