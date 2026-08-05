/**
 * SQLite persistence for the single active LAN room (ticket 14).
 * Same DB file as MatchStore; separate table.
 */

import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  LobbySeat,
  LobbySeatKind,
  RoomPhase,
  RoomRecord,
} from "./roomRegistry.js";

export type LoadActiveRoomResult =
  | { ok: true; room: RoomRecord | null }
  | { ok: false; reason: "corrupt" | "invalid" };

export type RoomStore = {
  saveActiveRoom(room: RoomRecord): void;
  loadActiveRoom(): LoadActiveRoomResult;
  clearActiveRoom(): void;
  /** Test helper: overwrite raw JSON to simulate corruption. */
  debugOverwritePayload(payload: string): void;
  close(): void;
};

const ACTIVE_ROW_ID = 1;

function isRoomPhase(value: unknown): value is RoomPhase {
  return value === "lobby" || value === "match" || value === "rematch";
}

function parseSeat(raw: unknown): LobbySeat | null {
  if (!raw || typeof raw !== "object") return null;
  const seat = raw as Record<string, unknown>;
  if (typeof seat.seatId !== "string") return null;
  const kindValue: unknown = seat.kind;
  if (
    kindValue !== "local_human" &&
    kindValue !== "open" &&
    kindValue !== "remote_human" &&
    // 旧库可能残留 local_agent 座位；解析时容忍但降级为关闭。
    kindValue !== "local_agent" &&
    kindValue !== "closed"
  ) {
    return null;
  }
  if (seat.displayName !== null && typeof seat.displayName !== "string") {
    return null;
  }
  if (
    seat.credentialHash !== null &&
    typeof seat.credentialHash !== "string"
  ) {
    return null;
  }
  const rematchValue: unknown = seat.rematchStatus;
  if (
    rematchValue !== null &&
    rematchValue !== undefined &&
    rematchValue !== "awaiting" &&
    rematchValue !== "confirmed" &&
    rematchValue !== "left"
  ) {
    return null;
  }
  return {
    seatId: seat.seatId,
    kind: kindValue === "local_agent" ? "closed" : (kindValue as LobbySeatKind),
    displayName: seat.displayName,
    credentialHash: seat.credentialHash,
    rematchStatus:
      rematchValue === undefined || rematchValue === null
        ? null
        : rematchValue,
  };
}

function parseRoom(raw: unknown): RoomRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const room = raw as Record<string, unknown>;
  if (typeof room.code !== "string") return null;
  if (!isRoomPhase(room.phase)) return null;
  if (typeof room.createdAt !== "number") return null;
  if (room.matchId !== null && typeof room.matchId !== "string") return null;
  if (!Array.isArray(room.seats)) return null;
  const seats: LobbySeat[] = [];
  for (const item of room.seats) {
    const seat = parseSeat(item);
    if (!seat) return null;
    seats.push(seat);
  }
  if (room.phase === "match" && room.matchId === null) return null;
  return {
    code: room.code,
    phase: room.phase,
    createdAt: room.createdAt,
    seats,
    matchId: room.matchId,
  };
}

export function openRoomStore(dbPath: string): RoomStore {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS lan_active_room (
      id INTEGER PRIMARY KEY NOT NULL,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  return {
    saveActiveRoom(room) {
      db.prepare(
        `INSERT INTO lan_active_room (id, payload_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           payload_json = excluded.payload_json,
           updated_at = excluded.updated_at`,
      ).run(ACTIVE_ROW_ID, JSON.stringify(room), new Date().toISOString());
    },

    loadActiveRoom() {
      const row = db
        .prepare(
          `SELECT payload_json AS payloadJson
           FROM lan_active_room
           WHERE id = ?`,
        )
        .get(ACTIVE_ROW_ID) as { payloadJson: string } | undefined;
      if (!row) return { ok: true, room: null };
      let parsed: unknown;
      try {
        parsed = JSON.parse(row.payloadJson);
      } catch {
        return { ok: false, reason: "corrupt" };
      }
      const room = parseRoom(parsed);
      if (!room) return { ok: false, reason: "invalid" };
      return { ok: true, room };
    },

    clearActiveRoom() {
      db.prepare(`DELETE FROM lan_active_room WHERE id = ?`).run(ACTIVE_ROW_ID);
    },

    debugOverwritePayload(payload) {
      db.prepare(
        `INSERT INTO lan_active_room (id, payload_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           payload_json = excluded.payload_json,
           updated_at = excluded.updated_at`,
      ).run(ACTIVE_ROW_ID, payload, new Date().toISOString());
    },

    close() {
      db.close();
    },
  };
}
