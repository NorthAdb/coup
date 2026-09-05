/**
 * 平台层共享 HTTP 客户端（ADR-0010）：会话/CSRF 引导、结构化错误、
 * 以及按游戏前缀参数化的房间/对局端点工厂。
 * coup（lanRoom.ts）与 brass（brassApi.ts）共用这份传输与端点实现；
 * 各自只保留「面向用户的错误文案映射」与游戏专属类型。
 */

export type ApiError = Error & { code?: string; status?: number };

function apiError(message: string, code?: string, status?: number): ApiError {
  const error = new Error(message) as ApiError;
  error.code = code;
  error.status = status;
  return error;
}

let csrfToken: string | null = null;

export async function ensureSession(origin = ""): Promise<string> {
  const base = origin || "";
  const response = await fetch(`${base}/api/session`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw apiError(body?.error ?? "无法建立会话", body?.error ?? undefined, response.status);
  }
  const body = (await response.json()) as { csrfToken: string };
  csrfToken = body.csrfToken;
  return csrfToken;
}

async function currentCsrfToken(origin: string): Promise<string> {
  if (!csrfToken) {
    const absolute = origin.startsWith("http") ? origin : "";
    await ensureSession(absolute);
  }
  return csrfToken ?? "";
}

export async function authedFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const origin = url.startsWith("http") ? new URL(url).origin : "";
  const token = await currentCsrfToken(origin);
  const headers = new Headers(init.headers);
  if (token) headers.set("x-csrf-token", token);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return fetch(url, {
    ...init,
    credentials: "include",
    headers,
  });
}

export async function getJson<T>(
  url: string,
  query?: Record<string, string | undefined>,
): Promise<T> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value != null && value !== "") params.set(key, value);
  }
  const qs = params.toString();
  const response = await fetch(`${url}${qs ? `?${qs}` : ""}`, {
    credentials: "include",
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) {
    throw apiError(body?.error ?? `http_${response.status}`, body?.error, response.status);
  }
  return body as T;
}

async function parseErrorResponse(response: Response): Promise<never> {
  const body = (await response.json().catch(() => null)) as {
    error?: string;
    message?: string;
  } | null;
  throw apiError(
    body?.error ?? body?.message ?? `http_${response.status}`,
    body?.error,
    response.status,
  );
}

export async function sendJson<T>(
  method: "POST" | "PATCH",
  url: string,
  body?: unknown,
): Promise<T> {
  const response = await authedFetch(url, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) await parseErrorResponse(response);
  return (await response.json()) as T;
}

/** 拼接某款游戏的 API 路径：prefix 为 ""（coup）或 "brass"。 */
export function gameApiPath(prefix: string, origin: string, path: string): string {
  const gameSegment = prefix ? `/${prefix}` : "";
  return `${origin}/api${gameSegment}${path}`;
}

export type LobbySeatLike = {
  seatId: string;
  kind: "local_human" | "open" | "remote_human" | "closed" | "bot";
  displayName: string | null;
  rematchStatus?: "awaiting" | "confirmed" | "left" | null;
};

export type SeatAbsenceLike = {
  seatId: string;
  phase: "present" | "reconnecting" | "absent" | "timed_out";
  since?: number;
  remainingMs?: number;
  resumeDeadline?: number | null;
  deadlineAt?: number | null;
};

export type RoomClient = {
  createRoom(origin?: string): Promise<unknown>;
  fetchRoom(origin: string, code: string): Promise<unknown>;
  fetchMySeat(origin: string, code: string): Promise<{ seat: LobbySeatLike | null; seats: LobbySeatLike[] }>;
  claimSeat(
    origin: string,
    code: string,
    seatId: string,
    displayName: string,
  ): Promise<{ seat: LobbySeatLike; seats: LobbySeatLike[] }>;
  /** 客人主动让出大厅座位（凭证即身份）。 */
  leaveSeat(origin: string, code: string): Promise<{ released: boolean; seatId: string; seats: LobbySeatLike[] }>;
  renameSeat(
    origin: string,
    code: string,
    seatId: string,
    displayName: string,
  ): Promise<{ seat: LobbySeatLike; seats: LobbySeatLike[] }>;
  configureSeat(
    origin: string,
    code: string,
    seatId: string,
    payload: { kind: "open" } | { kind: "closed" } | { kind: "bot" },
  ): Promise<{ seat: LobbySeatLike; seats: LobbySeatLike[] }>;
  updateSettings(
    origin: string,
    code: string,
    settings: { turnTimeLimitSec: number },
  ): Promise<{ turnTimeLimitSec: number; seats?: LobbySeatLike[] }>;
  start(origin: string, code: string): Promise<Record<string, unknown>>;
  heartbeat(origin: string, code: string): Promise<{ absences: SeatAbsenceLike[] }>;
  fetchPresence(origin: string, code: string): Promise<{ absences: SeatAbsenceLike[] }>;
  resumeSeat(origin: string, code: string): Promise<{ resumed: boolean; absences: SeatAbsenceLike[] }>;
  disposition(origin: string, code: string, seatId: string, action: string): Promise<Record<string, unknown>>;
  enterRematch(origin: string, code: string): Promise<Record<string, unknown>>;
  confirmRematch(origin: string, code: string): Promise<{ seat?: LobbySeatLike; seats: LobbySeatLike[] }>;
  declineRematch(origin: string, code: string): Promise<{ seats: LobbySeatLike[] }>;
  fetchRecovery(origin?: string): Promise<unknown>;
  abandonRecovery(origin: string, roomCode: string): Promise<unknown>;
  fetchMatch(
    origin: string,
    code: string,
    query?: { since?: number; spectate?: boolean },
  ): Promise<unknown>;
  submitDecision(origin: string, code: string, payload: unknown): Promise<unknown>;
  matchCurrentPath(
    code: string,
    decision?: boolean,
    query?: { since?: number; spectate?: boolean },
    origin?: string,
  ): string;
};

/**
 * 房间/对局端点工厂：一款游戏一个实例（coup 前缀 ""，brass 前缀 "brass"）。
 * 错误一律抛 ApiError（带 code/status），面向用户的文案由各游戏层映射。
 */
export function createRoomClient(prefix: string): RoomClient {
  const path = (origin: string, rest: string) => gameApiPath(prefix, origin, rest);

  return {
    async createRoom(origin = "") {
      return sendJson("POST", path(origin, "/rooms"));
    },
    fetchRoom(origin, code) {
      return getJson(path(origin, `/rooms/${code}`));
    },
    fetchMySeat(origin, code) {
      return getJson(path(origin, `/rooms/${code}/me`));
    },
    async claimSeat(origin, code, seatId, displayName) {
      return sendJson("POST", path(origin, `/rooms/${code}/seats/${seatId}/claim`), { displayName });
    },
    async leaveSeat(origin, code) {
      return sendJson("POST", path(origin, `/rooms/${code}/seats/leave`));
    },
    async renameSeat(origin, code, seatId, displayName) {
      return sendJson("PATCH", path(origin, `/rooms/${code}/seats/${seatId}`), { displayName });
    },
    async configureSeat(origin, code, seatId, payload) {
      return sendJson("PATCH", path(origin, `/rooms/${code}/seats/${seatId}/config`), payload);
    },
    async updateSettings(origin, code, settings) {
      return sendJson("PATCH", path(origin, `/rooms/${code}/settings`), settings);
    },
    async start(origin, code) {
      return sendJson("POST", path(origin, `/rooms/${code}/start`));
    },
    async heartbeat(origin, code) {
      return sendJson("POST", path(origin, `/rooms/${code}/heartbeat`));
    },
    fetchPresence(origin, code) {
      return getJson(path(origin, `/rooms/${code}/presence`));
    },
    async resumeSeat(origin, code) {
      return sendJson("POST", path(origin, `/rooms/${code}/resume-seat`));
    },
    async disposition(origin, code, seatId, action) {
      return sendJson("POST", path(origin, `/rooms/${code}/seats/${seatId}/disposition`), { action });
    },
    async enterRematch(origin, code) {
      return sendJson("POST", path(origin, `/rooms/${code}/rematch`));
    },
    async confirmRematch(origin, code) {
      return sendJson("POST", path(origin, `/rooms/${code}/rematch/join`));
    },
    async declineRematch(origin, code) {
      return sendJson("POST", path(origin, `/rooms/${code}/rematch/leave`));
    },
    async fetchRecovery(origin = "") {
      // 恢复清单需要会话（服务端已收紧）；首次访问先引导建立会话再携带 CSRF。
      const base = origin.startsWith("http") ? origin : "";
      await ensureSession(base);
      const response = await authedFetch(path(origin, "/room-recovery"));
      if (!response.ok) await parseErrorResponse(response);
      return (await response.json()) as unknown;
    },
    async abandonRecovery(origin, roomCode) {
      return sendJson("POST", path(origin, "/room-recovery/abandon"), { roomCode });
    },
    fetchMatch(origin, code, query) {
      return getJson(path(origin, `/rooms/${code}/matches/current`), {
        since: query?.since != null ? String(query.since) : undefined,
        spectate: query?.spectate ? "1" : undefined,
      });
    },
    async submitDecision(origin, code, payload) {
      return sendJson("POST", path(origin, `/rooms/${code}/matches/current/decision`), payload);
    },
    matchCurrentPath(code, decision = false, query, origin = "") {
      if (!code) throw new Error("room code is required");
      const params = new URLSearchParams();
      if (query?.since != null) params.set("since", String(query.since));
      if (query?.spectate) params.set("spectate", "1");
      const qs = params.toString();
      return `${path(origin, `/rooms/${code}/matches/current`)}${decision ? "/decision" : ""}${qs ? `?${qs}` : ""}`;
    },
  };
}
