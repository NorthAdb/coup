export type RoomInvite = {
  code: string;
  phase: string;
  port: number;
  selectedHost: string | null;
  joinUrl: string | null;
  candidates: string[];
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

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function waitForHostOrigin(
  retryOrigins: string[],
  attempts = 20,
): Promise<string> {
  for (let i = 0; i < attempts; i++) {
    for (const origin of retryOrigins) {
      try {
        const response = await fetch(`${origin}/api/hosting`, {
          cache: "no-store",
        });
        if (!response.ok) continue;
        const body = (await response.json()) as { bindMode?: string };
        if (body.bindMode === "host") return origin;
      } catch {
        /* try next */
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
    // on the LAN Origin (avoids dissolving a just-created room).
    sessionStorage.setItem("coup.createRoom", "1");
    window.location.assign(`${apiBase}/`);
    throw new Error("redirecting");
  }

  const created = await fetch("/api/rooms", { method: "POST" });
  if (!created.ok) {
    const body = (await created.json().catch(() => null)) as {
      error?: string;
    } | null;
    if (body?.error === "no_lan_ipv4") {
      throw new Error("未检测到可用局域网 IPv4，无法生成加入链接");
    }
    if (body?.error === "need_host_mode") {
      throw new Error("仍未进入主机模式，请重试创建房间");
    }
    throw new Error(body?.error ?? "无法创建房间");
  }
  const invite = (await created.json()) as RoomInvite;
  if (invite.lanOrigin && invite.lanOrigin !== window.location.origin) {
    sessionStorage.setItem("coup.restoreInvite", invite.code);
    window.location.assign(`${invite.lanOrigin}/`);
    throw new Error("redirecting");
  }
  return invite;
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
  const response = await fetch(`${origin}/api/rooms/${code}`);
  if (response.status === 404) {
    throw new Error("房间不存在或已解散");
  }
  if (!response.ok) {
    throw new Error("无法查询房间");
  }
  return (await response.json()) as RoomInvite;
}
