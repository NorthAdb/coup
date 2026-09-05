import type { SeatView } from "@coup/protocol";
import {
  createRoomClient,
  ensureSession,
  type ApiError,
  type LobbySeatLike,
} from "./platform/roomApi.ts";

/** Coup 房间客户端（ADR-0010）：传输与端点来自平台层，此处只做文案映射。 */
const coup = createRoomClient("");

export { ensureSession };

export type LobbySeat = LobbySeatLike;

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
  /** 回合限时（秒）；0 = 不限时。 */
  turnTimeLimitSec?: number;
};

const PLAYER_NAME_KEY = "coup.playerName";

export function loadPlayerName(): string {
  try {
    return globalThis.localStorage?.getItem(PLAYER_NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function savePlayerName(name: string): void {
  try {
    globalThis.localStorage?.setItem(PLAYER_NAME_KEY, name);
  } catch {
    // ignore quota / private mode
  }
}

export function matchCurrentPath(
  code: string,
  decision = false,
  query?: { since?: number; spectate?: boolean },
): string {
  return coup.matchCurrentPath(code, decision, query);
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

async function waitForHostMode(): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch("/api/hosting", { cache: "no-store" });
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
  try {
    return (await coup.createRoom()) as RoomInvite;
  } catch (error) {
    const code = (error as ApiError).code;
    const message = (error as ApiError).message;
    if (code === "no_lan_ipv4") {
      throw new Error("未检测到可用 IPv4，无法生成房间");
    }
    if (code === "need_host_mode") {
      throw new Error("仍未进入主机模式，请重试创建房间");
    }
    if (code === "recovery_pending_abandon") {
      throw new Error(message ?? "无法恢复上一房间：须先放弃并作废旧房后才能创建新房");
    }
    throw new Error(message ?? "无法创建房间");
  }
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

export type RoomRecoveryItem = {
  code: string;
  status: "restored" | "failed";
  reason: string | null;
  phase: string | null;
  matchId: string | null;
  seats: LobbySeat[];
};

export type RoomRecovery = { rooms: RoomRecoveryItem[] };

export async function fetchRoomRecovery(): Promise<RoomRecovery> {
  try {
    return (await coup.fetchRecovery()) as RoomRecovery;
  } catch {
    throw new Error("无法读取房间恢复状态");
  }
}

export async function abandonFailedRoomRecovery(roomCode: string): Promise<void> {
  await ensureSession();
  try {
    await coup.abandonRecovery("", roomCode);
  } catch (error) {
    throw new Error((error as ApiError).message ?? "放弃旧房间失败");
  }
}

export async function fetchRoom(
  origin: string,
  code: string,
): Promise<RoomInvite> {
  try {
    return (await coup.fetchRoom(origin, code)) as RoomInvite;
  } catch (error) {
    const apiError = error as ApiError;
    if (apiError.status === 404) {
      throw new Error("房间号不正确，或房主还没开房");
    }
    if (apiError.status === 429) {
      throw new Error("尝试太频繁，请稍后再试");
    }
    throw new Error("无法查询房间");
  }
}

export async function fetchMySeat(
  origin: string,
  code: string,
): Promise<{ seat: LobbySeat | null; seats: LobbySeat[] }> {
  try {
    return await coup.fetchMySeat(origin, code);
  } catch {
    throw new Error("无法确认座位凭证");
  }
}

export async function claimSeat(
  origin: string,
  code: string,
  seatId: string,
  displayName: string,
): Promise<{ seat: LobbySeat; seats: LobbySeat[] }> {
  try {
    return await coup.claimSeat(origin, code, seatId, displayName);
  } catch (error) {
    if ((error as ApiError).code === "seat_not_open") {
      throw new Error("该座位不可占或已被占用");
    }
    throw new Error((error as ApiError).message ?? "占座失败");
  }
}

export async function leaveSeat(origin: string, code: string): Promise<void> {
  try {
    await coup.leaveSeat(origin, code);
  } catch (error) {
    const errCode = (error as ApiError).code;
    if (errCode === "room_not_lobby") {
      throw new Error("对局已开始，无法让出座位");
    }
    if (errCode === "seat_credential_required") {
      throw new Error("没有可让出的座位凭证");
    }
    if (errCode === "seat_not_remote") {
      throw new Error("该座位不是你的");
    }
    throw new Error((error as ApiError).message ?? "让座失败");
  }
}

export async function renameSeat(
  origin: string,
  code: string,
  seatId: string,
  displayName: string,
): Promise<{ seat: LobbySeat; seats: LobbySeat[] }> {
  try {
    return await coup.renameSeat(origin, code, seatId, displayName);
  } catch {
    throw new Error("无法修改显示名");
  }
}

export async function configureLobbySeat(
  code: string,
  seatId: string,
  payload: { kind: "open" } | { kind: "closed" } | { kind: "bot" },
): Promise<{ seat: LobbySeat; seats: LobbySeat[] }> {
  try {
    return await coup.configureSeat("", code, seatId, payload);
  } catch (error) {
    throw new Error((error as ApiError).message ?? "无法配置座位");
  }
}

export async function startRoomMatch(code: string): Promise<{
  view: SeatView;
  matchId: string;
  phase: string;
}> {
  try {
    return (await coup.start("", code)) as {
      view: SeatView;
      matchId: string;
      phase: string;
    };
  } catch (error) {
    const apiError = error as ApiError & { hint?: string };
    throw new Error(apiError.message ?? "无法开局");
  }
}

export async function enterRoomRematch(
  code: string,
): Promise<{ code: string; phase: string; seats: LobbySeat[]; matchId: string | null }> {
  try {
    return (await coup.enterRematch("", code)) as {
      code: string;
      phase: string;
      seats: LobbySeat[];
      matchId: string | null;
    };
  } catch (error) {
    throw new Error((error as ApiError).message ?? "无法进入续局等待");
  }
}

export async function confirmRoomRematch(
  code: string,
): Promise<{ seat: LobbySeat; seats: LobbySeat[] }> {
  try {
    return (await coup.confirmRematch("", code)) as { seat: LobbySeat; seats: LobbySeat[] };
  } catch {
    throw new Error("加入对局失败");
  }
}

export async function declineRoomRematch(
  code: string,
): Promise<{ seats: LobbySeat[] }> {
  try {
    return (await coup.declineRematch("", code)) as { seats: LobbySeat[] };
  } catch {
    throw new Error("离开对局失败");
  }
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
    return `还有 ${open.length} 个空位：等朋友加入，或点座位上的「关闭」腾出局。`;
  }
  // 有效座位口径与服务器 evaluateLobbyStartGates 一致：AI 队友也算已就座。
  const effective = seats.filter(
    (s) => s.kind === "local_human" || s.kind === "remote_human" || s.kind === "bot",
  );
  if (effective.length < 2) return "至少还需 1 名玩家或 AI 入座才能开局。";
  if (effective.length > 6) return "有效座位至多 6 人。";
  return null;
}

export function canStartLobby(seats: LobbySeat[], phase?: string): boolean {
  return lobbyStartBlockHint(seats, phase) === null;
}

export function seatKindLabel(kind: LobbySeat["kind"]): string {
  switch (kind) {
    case "local_human":
      return "房主";
    case "remote_human":
      return "已入座";
    case "open":
      return "空位 · 可加入";
    case "closed":
      return "已关闭";
    case "bot":
      return "AI 队友";
  }
}

/** 房间设置更新（仅房主，大厅/续局阶段）。 */
export async function updateRoomSettings(
  code: string,
  settings: { turnTimeLimitSec: number },
): Promise<{ turnTimeLimitSec: number }> {
  try {
    const result = await coup.updateSettings("", code, settings);
    return { turnTimeLimitSec: result.turnTimeLimitSec };
  } catch {
    throw new Error("无法保存房间设置");
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
  try {
    return (await coup.heartbeat("", code)) as { absences: SeatAbsenceView[] };
  } catch {
    throw new Error("心跳失败");
  }
}

export async function resumeRoomSeat(code: string): Promise<{
  resumed: boolean;
  absences: SeatAbsenceView[];
}> {
  try {
    return (await coup.resumeSeat("", code)) as {
      resumed: boolean;
      absences: SeatAbsenceView[];
    };
  } catch {
    throw new Error("回席失败");
  }
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
  try {
    return await coup.disposition("", code, seatId, action);
  } catch {
    throw new Error("处置失败");
  }
}
