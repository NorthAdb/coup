/**
 * In-memory room registry for LAN lobby (ticket 10 — no SQLite yet).
 */

import { allocateRoomCode, buildJoinUrl, isValidRoomCode } from "./roomInvite.js";

export type RoomPhase = "lobby";

export type RoomRecord = {
  code: string;
  phase: RoomPhase;
  createdAt: number;
};

export type RoomRegistry = {
  create(): RoomRecord;
  getByCode(code: string): RoomRecord | null;
  listCodes(): string[];
  dissolve(code: string): boolean;
};

export function createRoomRegistry(): RoomRegistry {
  const rooms = new Map<string, RoomRecord>();

  return {
    create() {
      const code = allocateRoomCode(new Set(rooms.keys()));
      const room: RoomRecord = {
        code,
        phase: "lobby",
        createdAt: Date.now(),
      };
      rooms.set(code, room);
      return room;
    },
    getByCode(code: string) {
      if (!isValidRoomCode(code)) return null;
      return rooms.get(code) ?? null;
    },
    listCodes() {
      return [...rooms.keys()];
    },
    dissolve(code: string) {
      return rooms.delete(code);
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
  if (!lanHost) {
    return {
      code: room.code,
      phase: room.phase,
      port,
      selectedHost: null,
      joinUrl: null,
      candidates,
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
    error: null,
  };
}
