import type { SeatView } from "@coup/protocol";

export type LobbySeat = {
  seatId: string;
  kind: "local_human" | "open" | "remote_human" | "local_agent" | "closed";
  displayName: string | null;
  cli?: string | null;
  modelId?: string | null;
};

export type RoomInvite = {
  code: string;
  phase: string;
  port: number;
  selectedHost: string | null;
  joinUrl: string | null;
  candidates: string[];
  seats?: LobbySeat[];
  bindMode: string;
  lanOrigin: string | null;
  error?: string | null;
};

export type HostingEnterResponse =
  | {
      status: "ready";
      bindMode: string;
      listenHost: string;
      port: number;
      candidates: string[];
      selectedHost: string | null;
    }
  | {
      status: "rebinding";
      preferredPort: number;
      candidates: string[];
      retryOrigins: string[];
    };

let csrfToken: string | null = null;

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function buildCreateRoomUrl(origin: string): string {
  const url = new URL("/", origin);
  url.searchParams.set("createRoom", "1");
  return url.toString();
}

export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall back for non-secure LAN origins or denied clipboard permission.
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

export async function waitForHostOrigin(
  retryOrigins: string[],
  attempts = 20,
): Promise<string> {
  for (let i = 0; i < attempts; i++) {
    for (const origin of retryOrigins) {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 1000);
      try {
        const response = await fetch(`${origin}/api/hosting`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) continue;
        const body = (await response.json()) as { bindMode?: string };
        if (body.bindMode === "host") return origin;
      } catch {
        /* try next */
      } finally {
        window.clearTimeout(timeoutId);
      }
    }
    await sleep(200);
  }
  throw new Error("主机模式重绑超时：请确认端口 8787 可用后重试");
}

export async function enterHostModeAndCreateRoom(): Promise<RoomInvite> {
  const enter = await fetch("/api/hosting/enter", { method: "POST" });
  if (!enter.ok) {
    throw new Error("无法进入主机模式");
  }
  const enterBody = (await enter.json()) as HostingEnterResponse;

  if (enterBody.status === "rebinding") {
    const apiBase = await waitForHostOrigin(enterBody.retryOrigins);
    // Create the room only after navigation so the invite is issued once
    // on the LAN Origin (avoids dissolving a just-created room). Query
    // parameters cross origins; sessionStorage does not.
    window.location.assign(buildCreateRoomUrl(apiBase));
    throw new Error("redirecting");
  }

  // Already host: still land on LAN Origin before create so seat cookies
  // are issued on the join Origin (host-only; loopback ≠ LAN site).
  const selected =
    enterBody.status === "ready" ? enterBody.selectedHost : null;
  const port = enterBody.status === "ready" ? enterBody.port : 0;
  if (selected && port > 0) {
    const lanOrigin = `http://${selected}:${port}`;
    if (lanOrigin !== window.location.origin) {
      window.location.assign(buildCreateRoomUrl(lanOrigin));
      throw new Error("redirecting");
    }
  }

  return createRoomOnCurrentOrigin();
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
      throw new Error("未检测到可用局域网 IPv4，无法生成加入链接");
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

export function parseManualJoin(input: {
  joinLink: string;
  address: string;
  code: string;
}):
  | { ok: true; origin: string; code: string }
  | { ok: false; reason: string } {
  const link = input.joinLink.trim();
  if (link) {
    try {
      const url = new URL(link);
      const code = url.searchParams.get("code") ?? "";
      if (!/^\d{4}$/.test(code)) {
        return { ok: false, reason: "加入链接中的房间号无效" };
      }
      return { ok: true, origin: url.origin, code };
    } catch {
      return { ok: false, reason: "加入链接不是合法 URL" };
    }
  }

  const address = input.address.trim();
  const code = input.code.trim();
  if (!address && code) {
    return { ok: false, reason: "不能只填房间号，请提供主机地址或完整链接" };
  }
  if (!address || !code) {
    return { ok: false, reason: "需要完整加入链接，或「地址 + 房间号」" };
  }
  if (!/^\d{4}$/.test(code)) {
    return { ok: false, reason: "房间号须为 4 位数字" };
  }
  const withScheme = address.includes("://") ? address : `http://${address}`;
  try {
    const url = new URL(withScheme);
    return { ok: true, origin: url.origin, code };
  } catch {
    return { ok: false, reason: "主机地址无效" };
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
    throw new Error("房间已失效，可离开");
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

export async function patchRoomHost(
  code: string,
  selectedHost: string,
): Promise<RoomInvite> {
  await ensureSession();
  const response = await authedFetch(`/api/rooms/${code}`, {
    method: "PATCH",
    body: JSON.stringify({ selectedHost }),
  });
  if (!response.ok) {
    throw new Error("无法切换网卡地址");
  }
  return (await response.json()) as RoomInvite;
}

export type ConfigureSeatPayload =
  | { kind: "open" }
  | { kind: "closed" }
  | {
      kind: "local_agent";
      displayName: string;
      cli: "opencode" | "claude" | "stub";
      modelId: string | null;
    };

export async function configureLobbySeat(
  code: string,
  seatId: string,
  payload: ConfigureSeatPayload,
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
  decisionRationales?: Record<string, unknown>;
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
    decisionRationales?: Record<string, unknown>;
    matchId: string;
    phase: string;
  };
}

export function lobbyStartBlockHint(seats: LobbySeat[]): string | null {
  const open = seats.filter((s) => s.kind === "open");
  if (open.length > 0) {
    return "仍有「开放占座」空槽，请占满、改 Agent 或关闭。";
  }
  const effective = seats.filter(
    (s) =>
      s.kind === "local_human" ||
      s.kind === "remote_human" ||
      s.kind === "local_agent",
  );
  if (effective.length < 2) return "有效座位至少 2 人。";
  if (effective.length > 6) return "有效座位至多 6 人。";
  return null;
}

export function canStartLobby(seats: LobbySeat[]): boolean {
  return lobbyStartBlockHint(seats) === null;
}

export function seatKindLabel(kind: LobbySeat["kind"]): string {
  switch (kind) {
    case "local_human":
      return "本地人类";
    case "remote_human":
      return "远程人类";
    case "open":
      return "开放占座";
    case "local_agent":
      return "本机 Agent";
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
  | "swap_agent"
  | "technical_abort"
  | "force_eliminate";

export async function postSeatDisposition(
  code: string,
  seatId: string,
  action: DispositionAction,
): Promise<Record<string, unknown>> {
  await ensureSession();
  const payload =
    action === "swap_agent"
      ? {
          action,
          displayName: "灰狐",
          cli: "stub",
          modelId: "stub/placeholder",
        }
      : { action };
  const response = await authedFetch(
    `/api/rooms/${code}/seats/${seatId}/disposition`,
    {
      method: "POST",
      body: JSON.stringify(payload),
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
