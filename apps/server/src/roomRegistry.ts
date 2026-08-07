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

export type LobbySeatKind = "local_human" | "open" | "remote_human" | "closed";

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
};

export type PublicLobbySeat = {
  seatId: string;
  kind: LobbySeatKind;
  displayName: string | null;
  rematchStatus: RematchSeatStatus | null;
};

export type ConfigureSeatInput = { kind: "open" } | { kind: "closed" };

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

function defaultSeats(): LobbySeat[] {
  const seats: LobbySeat[] = [
    {
      seatId: "1",
      kind: "local_human",
      displayName: "你",
      credentialHash: null,
      rematchStatus: null,
    },
  ];
  for (let n = 2; n <= 6; n += 1) {
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

export function createRoomRegistry(): RoomRegistry {
  const rooms = new Map<string, RoomRecord>();

  return {
    create() {
      const code = allocateRoomCode(new Set(rooms.keys()));
      const room: RoomRecord = {
        code,
        phase: "lobby",
        createdAt: Date.now(),
        seats: defaultSeats(),
        matchId: null,
      };
      rooms.set(code, room);
      return room;
    },
    restore(room) {
      rooms.set(room.code, structuredClone(room));
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
      } else {
        seat.kind = "closed";
        seat.displayName = null;
        seat.credentialHash = null;
      }
      seat.rematchStatus = null;
      return { ok: true, seat, room };
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
    error: null,
  };
}
