/**
 * In-memory room registry for LAN lobby (tickets 10–11 — no SQLite yet).
 */

import { allocateRoomCode, buildJoinUrl, isValidRoomCode } from "./roomInvite.js";

export type RoomPhase = "lobby" | "match";

export type LobbySeatKind =
  | "local_human"
  | "open"
  | "remote_human"
  | "local_agent"
  | "closed";

export type LobbyAgentCli = "opencode" | "claude" | "stub";

export type LobbySeat = {
  seatId: string;
  kind: LobbySeatKind;
  displayName: string | null;
  /** SHA-256 hex of seat credential; never exposed on the wire. */
  credentialHash: string | null;
  cli: LobbyAgentCli | null;
  modelId: string | null;
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
  cli: LobbyAgentCli | null;
  modelId: string | null;
};

export type ConfigureSeatInput =
  | { kind: "open" }
  | { kind: "closed" }
  | {
      kind: "local_agent";
      displayName: string;
      cli: LobbyAgentCli;
      modelId: string | null;
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
  swapSeatToLocalAgent(
    code: string,
    seatId: string,
    input: {
      displayName: string;
      cli: LobbyAgentCli;
      modelId: string | null;
    },
  ):
    | { ok: true; seat: LobbySeat; room: RoomRecord }
    | {
        ok: false;
        reason:
          | "room_not_found"
          | "seat_not_found"
          | "seat_not_remote_human"
          | "room_not_match";
      };
};

function defaultSeats(): LobbySeat[] {
  const seats: LobbySeat[] = [
    {
      seatId: "1",
      kind: "local_human",
      displayName: "你",
      credentialHash: null,
      cli: null,
      modelId: null,
    },
  ];
  for (let n = 2; n <= 6; n += 1) {
    seats.push({
      seatId: String(n),
      kind: "open",
      displayName: null,
      credentialHash: null,
      cli: null,
      modelId: null,
    });
  }
  return seats;
}

export function publicSeats(room: RoomRecord): PublicLobbySeat[] {
  return room.seats.map(({ seatId, kind, displayName, cli, modelId }) => ({
    seatId,
    kind,
    displayName,
    cli,
    modelId,
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
      seat.cli = null;
      seat.modelId = null;
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
      if (room.phase !== "lobby") {
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
        seat.cli = null;
        seat.modelId = null;
      } else if (input.kind === "closed") {
        seat.kind = "closed";
        seat.displayName = null;
        seat.credentialHash = null;
        seat.cli = null;
        seat.modelId = null;
      } else {
        seat.kind = "local_agent";
        seat.displayName = input.displayName;
        seat.credentialHash = null;
        seat.cli = input.cli;
        seat.modelId = input.modelId;
      }
      return { ok: true, seat, room };
    },
    beginMatch(code, matchId) {
      const room = rooms.get(code);
      if (!room) return { ok: false, reason: "room_not_found" };
      if (room.phase !== "lobby") {
        return { ok: false, reason: "room_not_lobby" };
      }
      room.phase = "match";
      room.matchId = matchId;
      return { ok: true, room };
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
    swapSeatToLocalAgent(code, seatId, input) {
      const room = rooms.get(code);
      if (!room) return { ok: false, reason: "room_not_found" };
      if (room.phase !== "match") {
        return { ok: false, reason: "room_not_match" };
      }
      const seat = room.seats.find((s) => s.seatId === seatId);
      if (!seat) return { ok: false, reason: "seat_not_found" };
      if (seat.kind !== "remote_human") {
        return { ok: false, reason: "seat_not_remote_human" };
      }
      seat.kind = "local_agent";
      seat.displayName = input.displayName;
      seat.credentialHash = null;
      seat.cli = input.cli;
      seat.modelId = input.modelId;
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
