/**
 * In-memory room registry for LAN lobby (tickets 10–11 — no SQLite yet).
 */

import { allocateRoomCode, buildJoinUrl, isValidRoomCode } from "./roomInvite.js";

export type RoomPhase = "lobby";

export type LobbySeatKind = "local_human" | "open" | "remote_human";

export type LobbySeat = {
  seatId: string;
  kind: LobbySeatKind;
  displayName: string | null;
  /** SHA-256 hex of seat credential; never exposed on the wire. */
  credentialHash: string | null;
};

export type RoomRecord = {
  code: string;
  phase: RoomPhase;
  createdAt: number;
  seats: LobbySeat[];
};

export type PublicLobbySeat = {
  seatId: string;
  kind: LobbySeatKind;
  displayName: string | null;
};

export type RoomRegistry = {
  create(): RoomRecord;
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
};

function defaultSeats(): LobbySeat[] {
  const seats: LobbySeat[] = [
    {
      seatId: "1",
      kind: "local_human",
      displayName: "你",
      credentialHash: null,
    },
  ];
  for (let n = 2; n <= 6; n += 1) {
    seats.push({
      seatId: String(n),
      kind: "open",
      displayName: null,
      credentialHash: null,
    });
  }
  return seats;
}

export function publicSeats(room: RoomRecord): PublicLobbySeat[] {
  return room.seats.map(({ seatId, kind, displayName }) => ({
    seatId,
    kind,
    displayName,
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
      };
      rooms.set(code, room);
      return room;
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
