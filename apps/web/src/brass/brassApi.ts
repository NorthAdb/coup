import type { BrassCommand } from "@coup/brass-domain";
import { ensureSession } from "../lanRoom.js";

export type BrassLobbySeat = {
  seatId: string;
  kind: "local_human" | "open" | "remote_human" | "closed";
  displayName: string | null;
  rematchStatus?: "awaiting" | "confirmed" | "left" | null;
};

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

export type BrassSeatAbsence = {
  seatId: string;
  phase: "present" | "reconnecting" | "absent" | "timed_out";
  since: number;
  resumeDeadline?: number | null;
};

export type BrassView = {
  protocolVersion: number;
  requestId: string;
  matchId: string;
  stateVersion: number;
  seatId: string;
  game: "brass";
  spectator: boolean;
  state: Parameters<typeof Object>[0] extends never ? never : import("@coup/brass-domain").BrassState;
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

let csrfToken: string | null = null;

export async function ensureBrassSession(): Promise<string> {
  const token = await ensureSession("");
  csrfToken = token;
  return token;
}

export async function brassFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (!csrfToken) await ensureBrassSession();
  const headers = new Headers(init.headers);
  if (csrfToken) headers.set("x-csrf-token", csrfToken);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return fetch(url, { ...init, credentials: "include", headers });
}

async function brassJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await brassFetch(url, init);
  const body = (await response.json().catch(() => null)) as (T & { error?: string; message?: string }) | null;
  if (!response.ok) {
    const error = new Error(body?.error ?? body?.message ?? `http_${response.status}`) as Error & {
      code?: string;
      status?: number;
    };
    error.code = body?.error;
    error.status = response.status;
    throw error;
  }
  return body as T;
}

export function brassPost<T>(url: string, body?: unknown): Promise<T> {
  return brassJson<T>(url, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
}

export function brassPatch<T>(url: string, body?: unknown): Promise<T> {
  return brassJson<T>(url, { method: "PATCH", body: body === undefined ? undefined : JSON.stringify(body) });
}

export async function brassGet<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include", cache: "no-store" });
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) {
    const error = new Error(body?.error ?? `http_${response.status}`) as Error & { code?: string; status?: number };
    error.code = body?.error;
    error.status = response.status;
    throw error;
  }
  return body as T;
}

// ------------------------------------------------------------------
// 房间
// ------------------------------------------------------------------

export function createBrassRoom(): Promise<BrassRoomInvite> {
  return brassPost<BrassRoomInvite>("/api/brass/rooms");
}

export function fetchBrassRoom(code: string): Promise<BrassRoomInvite> {
  return brassGet<BrassRoomInvite>(`/api/brass/rooms/${code}`);
}

export function fetchMyBrassSeat(code: string): Promise<{ seat: BrassLobbySeat | null; seats: BrassLobbySeat[] }> {
  return brassGet(`/api/brass/rooms/${code}/me`);
}

export function claimBrassSeat(code: string, seatId: string, displayName: string) {
  return brassPost<{ seat: BrassLobbySeat; seats: BrassLobbySeat[] }>(
    `/api/brass/rooms/${code}/seats/${seatId}/claim`,
    { displayName },
  );
}

export function renameBrassSeat(code: string, seatId: string, displayName: string) {
  return brassPatch<{ seat: BrassLobbySeat; seats: BrassLobbySeat[] }>(
    `/api/brass/rooms/${code}/seats/${seatId}`,
    { displayName },
  );
}

export function configureBrassSeat(code: string, seatId: string, kind: "open" | "closed") {
  return brassPatch<{ seat: BrassLobbySeat; seats: BrassLobbySeat[] }>(
    `/api/brass/rooms/${code}/seats/${seatId}/config`,
    { kind },
  );
}

export function updateBrassSettings(code: string, turnTimeLimitSec: number) {
  return brassPatch<{ turnTimeLimitSec: number; seats: BrassLobbySeat[] }>(
    `/api/brass/rooms/${code}/settings`,
    { turnTimeLimitSec },
  );
}

export function startBrassMatchOn(code: string) {
  return brassPost<BrassMatchPollBody>(`/api/brass/rooms/${code}/start`);
}

export function postBrassHeartbeat(code: string) {
  return brassPost<{ ok: true; absences: BrassSeatAbsence[] }>(`/api/brass/rooms/${code}/heartbeat`);
}

export function fetchBrassPresence(code: string) {
  return brassGet<{ absences: BrassSeatAbsence[] }>(`/api/brass/rooms/${code}/presence`);
}

export function resumeBrassSeat(code: string) {
  return brassPost<{ resumed: boolean; seat: BrassLobbySeat | null; absences: BrassSeatAbsence[] }>(
    `/api/brass/rooms/${code}/resume-seat`,
  );
}

export function postBrassDisposition(code: string, seatId: string, action: "extend_wait" | "technical_abort") {
  return brassPost<Record<string, unknown>>(`/api/brass/rooms/${code}/seats/${seatId}/disposition`, { action });
}

export function enterBrassRematch(code: string) {
  return brassPost<{ phase: string; seats: BrassLobbySeat[] }>(`/api/brass/rooms/${code}/rematch`);
}

export function confirmBrassRematch(code: string, seatId: string) {
  return brassPost<{ seats: BrassLobbySeat[] }>(`/api/brass/rooms/${code}/rematch/join/${seatId}`);
}

export function declineBrassRematch(code: string, seatId: string) {
  return brassPost<{ seats: BrassLobbySeat[] }>(`/api/brass/rooms/${code}/rematch/leave/${seatId}`);
}

export function fetchBrassRecovery() {
  return brassGet<{ items: Array<{ code: string; status: string; reason: string | null; game: string; phase: string | null }> }>(
    "/api/brass/room-recovery",
  );
}

export function abandonBrassRecovery(roomCode: string) {
  return brassPost<{ abandoned: boolean }>("/api/brass/room-recovery/abandon", { roomCode });
}

// ------------------------------------------------------------------
// 对局轮询与决策
// ------------------------------------------------------------------

export function brassMatchUrl(code: string, query?: { since?: number; spectate?: boolean }): string {
  const params = new URLSearchParams();
  if (query?.since != null) params.set("since", String(query.since));
  if (query?.spectate) params.set("spectate", "1");
  const qs = params.toString();
  return `/api/brass/rooms/${code}/matches/current${qs ? `?${qs}` : ""}`;
}

export function fetchBrassMatch(code: string, query?: { since?: number; spectate?: boolean }): Promise<BrassMatchPollBody> {
  return brassGet<BrassMatchPollBody>(brassMatchUrl(code, query));
}

export function submitBrassCommand(code: string, command: BrassCommand, requestId: string): Promise<BrassMatchPollBody> {
  return brassPost<BrassMatchPollBody>(`/api/brass/rooms/${code}/matches/current/decision`, {
    protocolVersion: 1,
    requestId,
    stateVersion: command.expectedVersion,
    command,
  });
}
