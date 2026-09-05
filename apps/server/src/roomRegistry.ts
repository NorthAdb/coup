/**
 * In-memory room registry for the single internet room.
 * Persistence across host restart is handled by RoomStore.
 */

import {
  allocateRoomCode,
  buildJoinUrl,
  isValidRoomCode,
} from "./roomInvite.js";

export type RoomPhase = "lobby" | "match" | "rematch";

export type LobbySeatKind = "local_human" | "open" | "remote_human" | "closed" | "bot";

export type RematchSeatStatus = "awaiting" | "confirmed" | "left";

export type LobbySeat = {
  seatId: string;
  kind: LobbySeatKind;
  displayName: string | null;
  /** SHA-256 hex of seat credential; never exposed on the wire. */
  credentialHash: string | null;
  /** 续局等待中的确认状态；null 表示不在续局等待。 */
  rematchStatus: RematchSeatStatus | null;
};

export type RoomRecord = {
  code: string;
  phase: RoomPhase;
  createdAt: number;
  seats: LobbySeat[];
  matchId: string | null;
  /** 回合限时（秒）；0 = 不限时。默认 60。 */
  turnTimeLimitSec: number;
};

export const DEFAULT_TURN_TIME_LIMIT_SEC = 60;

export const TURN_TIME_LIMIT_CHOICES = [0, 30, 60, 90, 120];

export function normalizeTurnTimeLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_TURN_TIME_LIMIT_SEC;
  }
  const whole = Math.trunc(value);
  if (whole === 0) return 0;
  if (whole < 0) return DEFAULT_TURN_TIME_LIMIT_SEC;
  // 1–600 秒任意整数；UI 只提供常用档位。
  return Math.min(600, whole);
}

export type PublicLobbySeat = {
  seatId: string;
  kind: LobbySeatKind;
  displayName: string | null;
  rematchStatus: RematchSeatStatus | null;
};

export type ConfigureSeatInput = { kind: "open" } | { kind: "closed" } | { kind: "bot" };

export type RoomRegistry = {
  create(): RoomRecord;
  /** Add a persisted room to the in-memory map (boot recovery). */
  restore(room: RoomRecord): void;
  getByCode(code: string): RoomRecord | null;
  listCodes(): string[];
  dissolve(code: string): boolean;
  claimSeat(
    code: string,
    seatId: string,
    input: { displayName: string; credentialHash: string },
  ):
    | { ok: true; seat: LobbySeat; room: RoomRecord }
    | { ok: false; reason: "room_not_found" | "seat_not_found" | "seat_not_open" };
  renameSeat(
    code: string,
    seatId: string,
    displayName: string,
  ):
    | { ok: true; seat: LobbySeat; room: RoomRecord }
    | {
        ok: false;
        reason: "room_not_found" | "seat_not_found" | "seat_not_human";
      };
  /** 客人主动让出已占座位：座位转开放占座，凭证作废。 */
  releaseSeat(
    code: string,
    seatId: string,
  ):
    | { ok: true; seat: LobbySeat; room: RoomRecord }
    | {
        ok: false;
        reason: "room_not_found" | "seat_not_found" | "seat_not_remote";
      };
  findSeatByCredential(
    code: string,
    credentialHash: string,
  ): LobbySeat | null;
  configureSeat(
    code: string,
    seatId: string,
    input: ConfigureSeatInput,
  ):
    | { ok: true; seat: LobbySeat; room: RoomRecord }
    | {
        ok: false;
        reason:
          | "room_not_found"
          | "seat_not_found"
          | "seat_not_configurable"
          | "room_not_lobby";
      };
  /** 更新房间设置（仅大厅/续局阶段）。 */
  updateSettings(
    code: string,
    settings: { turnTimeLimitSec: number },
  ):
    | { ok: true; room: RoomRecord }
    | {
        ok: false;
        reason: "room_not_found" | "room_locked" | "invalid_setting";
      };
  beginMatch(
    code: string,
    matchId: string,
  ):
    | { ok: true; room: RoomRecord }
    | { ok: false; reason: "room_not_found" | "room_not_lobby" };
  /** 终局后进入续局等待：所有远程座位待确认，凭证保留。 */
  enterRematch(
    code: string,
  ):
    | { ok: true; room: RoomRecord }
    | { ok: false; reason: "room_not_found" | "room_not_match" };
  /** 客人确认加入续局；凭证轮换由调用方完成。 */
  confirmRematchSeat(
    code: string,
    seatId: string,
  ):
    | { ok: true; seat: LobbySeat; room: RoomRecord }
    | {
        ok: false;
        reason:
          | "room_not_found"
          | "seat_not_found"
          | "seat_not_awaiting";
      };
  /** 客人离开续局：座位转开放占座，作废凭证。 */
  declineRematchSeat(
    code: string,
    seatId: string,
  ):
    | { ok: true; seat: LobbySeat; room: RoomRecord }
    | { ok: false; reason: "room_not_found" | "seat_not_found" };
  rotateSeatCredential(
    code: string,
    seatId: string,
    credentialHash: string,
  ):
    | { ok: true; seat: LobbySeat; room: RoomRecord }
    | {
        ok: false;
        reason: "room_not_found" | "seat_not_found" | "seat_not_human";
      };
  revokeSeatCredential(
    code: string,
    seatId: string,
  ):
    | { ok: true; seat: LobbySeat; room: RoomRecord }
    | { ok: false; reason: "room_not_found" | "seat_not_found" };
};

export type CreateRoomRegistryOptions = {
  /** 座位数（含房主）；coup 默认 6，brass 传 4。 */
  seatCount?: number;
  /** 分配新码时额外参考的占用码（跨游戏共享码池）。 */
  takenExtra?: () => string[];
  /** 分配/恢复房间码后的回调（登记到共享码池）。 */
  onCodeAllocated?: (code: string) => void;
};

function defaultSeats(seatCount = 6): LobbySeat[] {
  const count = Math.max(2, Math.min(8, seatCount));
  const seats: LobbySeat[] = [
    {
      seatId: "1",
      kind: "local_human",
      displayName: "你",
      credentialHash: null,
      rematchStatus: null,
    },
  ];
  for (let n = 2; n <= count; n += 1) {
    seats.push({
      seatId: String(n),
      kind: "open",
      displayName: null,
      credentialHash: null,
      rematchStatus: null,
    });
  }
  return seats;
}

export function publicSeats(room: RoomRecord): PublicLobbySeat[] {
  return room.seats.map(({ seatId, kind, displayName, rematchStatus }) => ({
    seatId,
    kind,
    displayName,
    rematchStatus,
  }));
}

/** AI 座位名：按座位号取「甲乙丙丁戊」，稳定可读（不同房间同名也无妨）。 */
export function botDisplayNameFor(seatId: string): string {
  const n = Number(seatId);
  const names = ["甲", "乙", "丙", "丁", "戊", "己"];
  const glyph = Number.isInteger(n) && n >= 2 && n - 2 < names.length ? names[n - 2]! : String(seatId);
  return `机器人·${glyph}`;
}

export function createRoomRegistry(options?: CreateRoomRegistryOptions): RoomRegistry {
  const rooms = new Map<string, RoomRecord>();
  const seatCount = options?.seatCount ?? 6;
  const takenExtra = options?.takenExtra;
  const onCodeAllocated = options?.onCodeAllocated;

  return {
    create() {
      const taken = new Set([...rooms.keys(), ...(takenExtra?.() ?? [])]);
      const code = allocateRoomCode(taken);
      onCodeAllocated?.(code);
      const room: RoomRecord = {
        code,
        phase: "lobby",
        createdAt: Date.now(),
        seats: defaultSeats(seatCount),
        matchId: null,
        turnTimeLimitSec: DEFAULT_TURN_TIME_LIMIT_SEC,
      };
      rooms.set(code, room);
      return room;
    },
    restore(room) {
      const cloned = structuredClone(room);
      // 旧版持久化房间没有该字段：回填默认值。
      cloned.turnTimeLimitSec = normalizeTurnTimeLimit(cloned.turnTimeLimitSec);
      rooms.set(cloned.code, cloned);
      onCodeAllocated?.(cloned.code);
    },
    getByCode(code) {
      if (!isValidRoomCode(code)) return null;
      return rooms.get(code) ?? null;
    },
    listCodes() {
      return [...rooms.keys()];
    },
    dissolve(code) {
      return rooms.delete(code);
    },
    claimSeat(code, seatId, input) {
      const room = rooms.get(code);
      if (!room) return { ok: false, reason: "room_not_found" };
      const seat = room.seats.find((s) => s.seatId === seatId);
      if (!seat) return { ok: false, reason: "seat_not_found" };
      if (seat.kind !== "open") return { ok: false, reason: "seat_not_open" };
      seat.kind = "remote_human";
      seat.displayName = input.displayName;
      seat.credentialHash = input.credentialHash;
      // 续局等待中占下开放座位即视为已确认加入。
      seat.rematchStatus = room.phase === "rematch" ? "confirmed" : null;
      return { ok: true, seat, room };
    },
    renameSeat(code, seatId, displayName) {
      const room = rooms.get(code);
      if (!room) return { ok: false, reason: "room_not_found" };
      const seat = room.seats.find((s) => s.seatId === seatId);
      if (!seat) return { ok: false, reason: "seat_not_found" };
      if (seat.kind !== "local_human" && seat.kind !== "remote_human") {
        return { ok: false, reason: "seat_not_human" };
      }
      seat.displayName = displayName;
      return { ok: true, seat, room };
    },
    findSeatByCredential(code, credentialHash) {
      const room = rooms.get(code);
      if (!room) return null;
      return (
        room.seats.find((s) => s.credentialHash === credentialHash) ?? null
      );
    },
    releaseSeat(code, seatId) {
      const room = rooms.get(code);
      if (!room) return { ok: false, reason: "room_not_found" };
      const seat = room.seats.find((s) => s.seatId === seatId);
      if (!seat) return { ok: false, reason: "seat_not_found" };
      // 只有远程客人能自己让座；房主座位（本地）不适用。
      if (seat.kind !== "remote_human") {
        return { ok: false, reason: "seat_not_remote" };
      }
      seat.kind = "open";
      seat.displayName = null;
      seat.credentialHash = null;
      seat.rematchStatus = null;
      return { ok: true, seat, room };
    },
    configureSeat(code, seatId, input) {
      const room = rooms.get(code);
      if (!room) return { ok: false, reason: "room_not_found" };
      if (room.phase !== "lobby" && room.phase !== "rematch") {
        return { ok: false, reason: "room_not_lobby" };
      }
      const seat = room.seats.find((s) => s.seatId === seatId);
      if (!seat) return { ok: false, reason: "seat_not_found" };
      if (seat.kind === "local_human" || seatId === "1") {
        return { ok: false, reason: "seat_not_configurable" };
      }
      if (input.kind === "open") {
        seat.kind = "open";
        seat.displayName = null;
        seat.credentialHash = null;
      } else if (input.kind === "bot") {
        // AI 队友座位：无凭证、不可认领（claimSeat 只收 open），房主可随时撤回。
        seat.kind = "bot";
        seat.displayName = botDisplayNameFor(seatId);
        seat.credentialHash = null;
      } else {
        seat.kind = "closed";
        seat.displayName = null;
        seat.credentialHash = null;
      }
      seat.rematchStatus = null;
      return { ok: true, seat, room };
    },
    updateSettings(code, settings) {
      const room = rooms.get(code);
      if (!room) return { ok: false, reason: "room_not_found" };
      if (room.phase === "match") {
        return { ok: false, reason: "room_locked" };
      }
      const limit = normalizeTurnTimeLimit(settings.turnTimeLimitSec);
      if (limit !== settings.turnTimeLimitSec) {
        return { ok: false, reason: "invalid_setting" };
      }
      room.turnTimeLimitSec = limit;
      return { ok: true, room };
    },
    beginMatch(code, matchId) {
      const room = rooms.get(code);
      if (!room) return { ok: false, reason: "room_not_found" };
      if (
        room.phase !== "lobby" &&
        room.phase !== "match" &&
        room.phase !== "rematch"
      ) {
        return { ok: false, reason: "room_not_lobby" };
      }
      room.phase = "match";
      room.matchId = matchId;
      for (const seat of room.seats) {
        seat.rematchStatus = null;
      }
      return { ok: true, room };
    },
    enterRematch(code) {
      const room = rooms.get(code);
      if (!room) return { ok: false, reason: "room_not_found" };
      if (room.phase !== "match") {
        return { ok: false, reason: "room_not_match" };
      }
      room.phase = "rematch";
      for (const seat of room.seats) {
        seat.rematchStatus =
          seat.kind === "remote_human" ? "awaiting" : null;
      }
      return { ok: true, room };
    },
    confirmRematchSeat(code, seatId) {
      const room = rooms.get(code);
      if (!room) return { ok: false, reason: "room_not_found" };
      const seat = room.seats.find((s) => s.seatId === seatId);
      if (!seat) return { ok: false, reason: "seat_not_found" };
      if (seat.kind !== "remote_human" || seat.rematchStatus !== "awaiting") {
        return { ok: false, reason: "seat_not_awaiting" };
      }
      seat.rematchStatus = "confirmed";
      return { ok: true, seat, room };
    },
    declineRematchSeat(code, seatId) {
      const room = rooms.get(code);
      if (!room) return { ok: false, reason: "room_not_found" };
      const seat = room.seats.find((s) => s.seatId === seatId);
      if (!seat) return { ok: false, reason: "seat_not_found" };
      seat.kind = "open";
      seat.displayName = null;
      seat.credentialHash = null;
      seat.rematchStatus = "left";
      return { ok: true, seat, room };
    },
    rotateSeatCredential(code, seatId, credentialHash) {
      const room = rooms.get(code);
      if (!room) return { ok: false, reason: "room_not_found" };
      const seat = room.seats.find((s) => s.seatId === seatId);
      if (!seat) return { ok: false, reason: "seat_not_found" };
      if (seat.kind !== "local_human" && seat.kind !== "remote_human") {
        return { ok: false, reason: "seat_not_human" };
      }
      seat.credentialHash = credentialHash;
      return { ok: true, seat, room };
    },
    revokeSeatCredential(code, seatId) {
      const room = rooms.get(code);
      if (!room) return { ok: false, reason: "room_not_found" };
      const seat = room.seats.find((s) => s.seatId === seatId);
      if (!seat) return { ok: false, reason: "seat_not_found" };
      seat.credentialHash = null;
      return { ok: true, seat, room };
    },
  };
}

export function roomInvitePayload(input: {
  room: RoomRecord;
  lanHost: string | null;
  port: number;
  candidates: string[];
}) {
  const { room, lanHost, port, candidates } = input;
  const seats = publicSeats(room);
  if (!lanHost) {
    return {
      code: room.code,
      phase: room.phase,
      port,
      selectedHost: null,
      joinUrl: null,
      candidates,
      seats,
      turnTimeLimitSec: room.turnTimeLimitSec,
      error: "no_lan_ipv4" as const,
    };
  }
  return {
    code: room.code,
    phase: room.phase,
    port,
    selectedHost: lanHost,
    joinUrl: buildJoinUrl({ host: lanHost, port, code: room.code }),
    candidates,
    seats,
    turnTimeLimitSec: room.turnTimeLimitSec,
    error: null,
  };
}
