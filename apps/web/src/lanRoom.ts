import type { SeatView } from "@coup/protocol";

export type LobbySeat = {
  seatId: string;
  kind: "local_human" | "open" | "remote_human" | "closed";
  displayName: string | null;
  rematchStatus?: "awaiting" | "confirmed" | "left" | null;
};

export type RoomInvite = {
  code: string;
  phase: "lobby" | "match" | "rematch" | string;
  port: number;
  selectedHost: string | null;
  joinUrl: string | null;
  candidates: string[];
  seats?: LobbySeat[];
  bindMode: string;
  lanOrigin: string | null;
  error?: string | null;
};

export function matchCurrentPath(code: string, decision = false): string {
  if (!code) throw new Error("room code is required");
  return `/api/rooms/${code}/matches/current${decision ? "/decision" : ""}`;
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
    throw new Error(body?.error ?? "无法建立会话");
  }
  const body = (await response.json()) as { csrfToken: string };
  csrfToken = body.csrfToken;
  return csrfToken;
}

async function authedFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  if (!csrfToken) {
    const absolute = url.startsWith("http") ? new URL(url).origin : "";
    await ensureSession(absolute);
  }
  const headers = new Headers(init.headers);
  if (csrfToken) headers.set("x-csrf-token", csrfToken);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return fetch(url, {
    ...init,
    credentials: "include",
    headers,
  });
}

export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall back for non-secure origins or denied clipboard permission.
    }
  }

  if (!document.body) return false;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  textarea.remove();
  return copied;
}

async function waitForHostMode(attempts = 20): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch("/api/hosting", { cache: "no-store" });
      if (!response.ok) continue;
      const body = (await response.json()) as { bindMode?: string };
      if (body.bindMode === "host") return;
    } catch {
      /* try again */
    }
    await new Promise((resolve) => window.setTimeout(resolve, 200));
  }
  throw new Error("进入主机模式超时，请重试");
}

export async function createRoomOnCurrentOrigin(): Promise<RoomInvite> {
  await ensureSession();
  const created = await authedFetch("/api/rooms", { method: "POST" });
  if (!created.ok) {
    const body = (await created.json().catch(() => null)) as {
      error?: string;
      message?: string;
    } | null;
    if (body?.error === "no_lan_ipv4") {
      throw new Error("未检测到可用 IPv4，无法生成房间");
    }
    if (body?.error === "need_host_mode") {
      throw new Error("仍未进入主机模式，请重试创建房间");
    }
    if (body?.error === "recovery_pending_abandon") {
      throw new Error(
        body.message ?? "无法恢复上一房间：须先放弃并作废旧房后才能创建新房",
      );
    }
    throw new Error(body?.error ?? "无法创建房间");
  }
  return (await created.json()) as RoomInvite;
}

export async function enterHostModeAndCreateRoom(): Promise<RoomInvite> {
  await ensureSession();
  // 互联网版：服务端常驻主机模式；若仍处 loopback 则先触发重绑，
  // 完成后在**当前地址**建房，不做任何跳转。
  const enter = await fetch("/api/hosting/enter", { method: "POST" });
  if (!enter.ok) {
    throw new Error("无法进入主机模式");
  }
  const enterBody = (await enter.json()) as { status?: string };
  if (enterBody.status === "rebinding") {
    await waitForHostMode();
  }
  return createRoomOnCurrentOrigin();
}

export type RoomRecovery =
  | {
      status: "none";
      reason: null;
      message: null;
      room: null;
    }
  | {
      status: "restored";
      reason: null;
      message: null;
      room: {
        code: string;
        phase: string;
        matchId: string | null;
        seats: LobbySeat[];
      };
    }
  | {
      status: "failed";
      reason: string | null;
      message: string | null;
      room: {
        code: string;
        phase: string;
        matchId: string | null;
        seats: LobbySeat[];
      } | null;
    };

export async function fetchRoomRecovery(): Promise<RoomRecovery> {
  const response = await fetch("/api/room-recovery", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("无法读取房间恢复状态");
  }
  return (await response.json()) as RoomRecovery;
}

export async function abandonFailedRoomRecovery(): Promise<void> {
  await ensureSession();
  const response = await authedFetch("/api/room-recovery/abandon", {
    method: "POST",
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "放弃旧房间失败");
  }
}

export async function fetchRoom(
  origin: string,
  code: string,
): Promise<RoomInvite> {
  const response = await fetch(`${origin}/api/rooms/${code}`, {
    credentials: "include",
    cache: "no-store",
  });
  if (response.status === 404) {
    throw new Error("房间号不正确，或房主还没开房");
  }
  if (response.status === 429) {
    throw new Error("尝试太频繁，请稍后再试");
  }
  if (!response.ok) {
    throw new Error("无法查询房间");
  }
  return (await response.json()) as RoomInvite;
}

export async function fetchMySeat(
  origin: string,
  code: string,
): Promise<{ seat: LobbySeat | null; seats: LobbySeat[] }> {
  const response = await fetch(`${origin}/api/rooms/${code}/me`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("无法确认座位凭证");
  }
  return (await response.json()) as {
    seat: LobbySeat | null;
    seats: LobbySeat[];
  };
}

export async function claimSeat(
  origin: string,
  code: string,
  seatId: string,
  displayName: string,
): Promise<{ seat: LobbySeat; seats: LobbySeat[] }> {
  await ensureSession(origin);
  const response = await authedFetch(
    `${origin}/api/rooms/${code}/seats/${seatId}/claim`,
    {
      method: "POST",
      body: JSON.stringify({ displayName }),
    },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    if (body?.error === "seat_not_open") {
      throw new Error("该座位不可占或已被占用");
    }
    throw new Error(body?.error ?? "占座失败");
  }
  return (await response.json()) as { seat: LobbySeat; seats: LobbySeat[] };
}

export async function renameSeat(
  origin: string,
  code: string,
  seatId: string,
  displayName: string,
): Promise<{ seat: LobbySeat; seats: LobbySeat[] }> {
  await ensureSession(origin);
  const response = await authedFetch(
    `${origin}/api/rooms/${code}/seats/${seatId}`,
    {
      method: "PATCH",
      body: JSON.stringify({ displayName }),
    },
  );
  if (!response.ok) {
    throw new Error("无法修改显示名");
  }
  return (await response.json()) as { seat: LobbySeat; seats: LobbySeat[] };
}

export async function configureLobbySeat(
  code: string,
  seatId: string,
  payload: { kind: "open" } | { kind: "closed" },
): Promise<{ seat: LobbySeat; seats: LobbySeat[] }> {
  await ensureSession();
  const response = await authedFetch(
    `/api/rooms/${code}/seats/${seatId}/config`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "无法配置座位");
  }
  return (await response.json()) as { seat: LobbySeat; seats: LobbySeat[] };
}

export async function startRoomMatch(code: string): Promise<{
  view: SeatView;
  matchId: string;
  phase: string;
}> {
  await ensureSession();
  const response = await authedFetch(`/api/rooms/${code}/start`, {
    method: "POST",
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
      hint?: string;
    } | null;
    throw new Error(body?.hint ?? body?.error ?? "无法开局");
  }
  return (await response.json()) as {
    view: SeatView;
    matchId: string;
    phase: string;
  };
}

export async function enterRoomRematch(
  code: string,
): Promise<{ code: string; phase: string; seats: LobbySeat[]; matchId: string | null }> {
  await ensureSession();
  const response = await authedFetch(`/api/rooms/${code}/rematch`, {
    method: "POST",
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "无法进入续局等待");
  }
  return (await response.json()) as {
    code: string;
    phase: string;
    seats: LobbySeat[];
    matchId: string | null;
  };
}

export async function confirmRoomRematch(
  code: string,
): Promise<{ seat: LobbySeat; seats: LobbySeat[] }> {
  await ensureSession();
  const response = await authedFetch(`/api/rooms/${code}/rematch/join`, {
    method: "POST",
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "加入对局失败");
  }
  return (await response.json()) as { seat: LobbySeat; seats: LobbySeat[] };
}

export async function declineRoomRematch(
  code: string,
): Promise<{ seats: LobbySeat[] }> {
  await ensureSession();
  const response = await authedFetch(`/api/rooms/${code}/rematch/leave`, {
    method: "POST",
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "离开对局失败");
  }
  return (await response.json()) as { seats: LobbySeat[] };
}

export function lobbyStartBlockHint(
  seats: LobbySeat[],
  phase?: string,
): string | null {
  if (phase === "rematch") {
    const awaiting = seats.filter((s) => s.rematchStatus === "awaiting");
    if (awaiting.length > 0) {
      return `还有 ${awaiting.length} 个座位等待确认加入`;
    }
    const open = seats.filter((s) => s.kind === "open");
    if (open.length > 0) {
      return `座位 ${open.map((s) => s.seatId).join("、")} 已开放，等待新人占座或由你关闭`;
    }
  }
  const open = seats.filter((s) => s.kind === "open");
  if (open.length > 0) {
    return "仍有「开放占座」空槽，请占满或关闭。";
  }
  const effective = seats.filter(
    (s) => s.kind === "local_human" || s.kind === "remote_human",
  );
  if (effective.length < 2) return "至少还需 1 名真人入座才能开局。";
  if (effective.length > 6) return "有效座位至多 6 人。";
  return null;
}

export function canStartLobby(seats: LobbySeat[], phase?: string): boolean {
  return lobbyStartBlockHint(seats, phase) === null;
}

export function seatKindLabel(kind: LobbySeat["kind"]): string {
  switch (kind) {
    case "local_human":
      return "本地人类";
    case "remote_human":
      return "远程人类";
    case "open":
      return "开放占座";
    case "closed":
      return "关闭";
  }
}

export type SeatAbsenceView = {
  seatId: string;
  phase: "reconnecting" | "absent" | "timed_out" | "present";
  remainingMs: number;
  deadlineAt: number | null;
};

export async function postRoomHeartbeat(
  code: string,
): Promise<{ absences: SeatAbsenceView[] }> {
  await ensureSession();
  const response = await authedFetch(`/api/rooms/${code}/heartbeat`, {
    method: "POST",
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "心跳失败");
  }
  return (await response.json()) as { absences: SeatAbsenceView[] };
}

export async function resumeRoomSeat(code: string): Promise<{
  resumed: boolean;
  absences: SeatAbsenceView[];
}> {
  await ensureSession();
  const response = await authedFetch(`/api/rooms/${code}/resume-seat`, {
    method: "POST",
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "回席失败");
  }
  return (await response.json()) as {
    resumed: boolean;
    absences: SeatAbsenceView[];
  };
}

export type DispositionAction =
  | "extend_wait"
  | "technical_abort"
  | "force_eliminate";

export async function postSeatDisposition(
  code: string,
  seatId: string,
  action: DispositionAction,
): Promise<Record<string, unknown>> {
  await ensureSession();
  const response = await authedFetch(
    `/api/rooms/${code}/seats/${seatId}/disposition`,
    {
      method: "POST",
      body: JSON.stringify({ action }),
    },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "处置失败");
  }
  return (await response.json()) as Record<string, unknown>;
}
