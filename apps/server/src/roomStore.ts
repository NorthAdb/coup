import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  normalizeTurnTimeLimit,
  type LobbySeat,
  type LobbySeatKind,
  type RoomPhase,
  type RoomRecord,
} from "./roomRegistry.js";

export type RoomLoadFailure = {
  roomCode: string | null;
  reason: "corrupt" | "invalid" | "migration_error";
};

export type LoadRoomsResult =
  | { ok: true; rooms: RoomRecord[]; failures: [] }
  | { ok: false; rooms: RoomRecord[]; failures: RoomLoadFailure[] };

export type RoomStore = {
  saveRoom(room: RoomRecord): void;
  loadRooms(): LoadRoomsResult;
  clearRoom(roomCode: string): void;
  clearAllRooms(): void;
  // Test-only payload injection for migration and corruption recovery cases.
  debugOverwritePayload(payload: string): void;
  debugOverwriteLegacyPayload(payload: string): void;
  close(): void;
};

function isRoomPhase(value: unknown): value is RoomPhase {
  return value === "lobby" || value === "match" || value === "rematch";
}

function parseSeat(raw: unknown): LobbySeat | null {
  if (!raw || typeof raw !== "object") return null;
  const seat = raw as Record<string, unknown>;
  const kind = seat.kind;
  if (typeof seat.seatId !== "string" ||
      !["local_human", "open", "remote_human", "local_agent", "closed"].includes(String(kind))) return null;
  if (seat.displayName !== null && typeof seat.displayName !== "string") return null;
  if (seat.credentialHash !== null && typeof seat.credentialHash !== "string") return null;
  const rematchStatus = seat.rematchStatus;
  if (rematchStatus !== null && rematchStatus !== undefined &&
      !["awaiting", "confirmed", "left"].includes(String(rematchStatus))) return null;
  return {
    seatId: seat.seatId,
    kind: kind === "local_agent" ? "closed" : kind as LobbySeatKind,
    displayName: seat.displayName,
    credentialHash: seat.credentialHash,
    rematchStatus: rematchStatus == null ? null : rematchStatus as "awaiting" | "confirmed" | "left",
  };
}

function parseRoom(raw: unknown): RoomRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const room = raw as Record<string, unknown>;
  if (typeof room.code !== "string" || !isRoomPhase(room.phase) ||
      typeof room.createdAt !== "number" ||
      (room.matchId !== null && typeof room.matchId !== "string") ||
      !Array.isArray(room.seats)) return null;
  const seats = room.seats.map(parseSeat);
  if (seats.some((seat) => seat === null) || (room.phase === "match" && room.matchId === null)) return null;
  return {
    code: room.code,
    phase: room.phase,
    createdAt: room.createdAt,
    seats: seats as LobbySeat[],
    matchId: room.matchId,
    // 旧版持久化载荷没有该字段：回填默认。
    turnTimeLimitSec: normalizeTurnTimeLimit(room.turnTimeLimitSec),
  };
}

function parsePayload(payload: string): { room: RoomRecord } | RoomLoadFailure {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return { roomCode: null, reason: "corrupt" };
  }
  const room = parseRoom(parsed);
  return room ? { room } : { roomCode: null, reason: "invalid" };
}

export function openRoomStore(dbPath: string): RoomStore {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      room_code TEXT PRIMARY KEY NOT NULL,
      payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS lan_active_room (
      id INTEGER PRIMARY KEY NOT NULL,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const migrationFailures: RoomLoadFailure[] = [];

  const legacy = db.prepare(`SELECT payload_json AS payloadJson FROM lan_active_room WHERE id = 1`).get() as { payloadJson: string } | undefined;
  if (legacy) {
    const parsed = parsePayload(legacy.payloadJson);
    if ("room" in parsed) {
      const exists = db.prepare(`SELECT 1 AS present FROM rooms WHERE room_code = ?`).get(parsed.room.code);
      if (!exists) {
        db.prepare(`INSERT INTO rooms (room_code, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?)`).run(
          parsed.room.code, JSON.stringify(parsed.room), parsed.room.createdAt, new Date().toISOString(),
        );
        db.prepare(`DELETE FROM lan_active_room WHERE id = 1`).run();
      }
    } else {
      migrationFailures.push(parsed);
    }
  }

  function loadRooms(): LoadRoomsResult {
    const rows = db.prepare(`SELECT room_code AS roomCode, payload_json AS payloadJson FROM rooms ORDER BY room_code`).all() as Array<{ roomCode: string; payloadJson: string }>;
    const rooms: RoomRecord[] = [];
    const failures: RoomLoadFailure[] = [...migrationFailures];
    for (const row of rows) {
      const parsed = parsePayload(row.payloadJson);
      if ("room" in parsed) {
        if (parsed.room.code !== row.roomCode) failures.push({ roomCode: row.roomCode, reason: "invalid" });
        else rooms.push(parsed.room);
      } else failures.push({ ...parsed, roomCode: row.roomCode });
    }
    return failures.length > 0 ? { ok: false, rooms, failures } : { ok: true, rooms, failures: [] };
  }

  return {
    saveRoom(room) {
      db.prepare(`INSERT INTO rooms (room_code, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(room_code) DO UPDATE SET payload_json = excluded.payload_json, created_at = excluded.created_at, updated_at = excluded.updated_at`).run(room.code, JSON.stringify(room), room.createdAt, new Date().toISOString());
    },
    loadRooms,
    clearRoom(roomCode) { db.prepare(`DELETE FROM rooms WHERE room_code = ?`).run(roomCode); },
    clearAllRooms() { db.prepare(`DELETE FROM rooms`).run(); },
    debugOverwritePayload(payload) {
      const row = db.prepare(`SELECT room_code AS roomCode FROM rooms ORDER BY room_code LIMIT 1`).get() as { roomCode: string } | undefined;
      if (row) {
        db.prepare(`UPDATE rooms SET payload_json = ? WHERE room_code = ?`).run(payload, row.roomCode);
        return;
      }
      db.prepare(`INSERT INTO lan_active_room (id, payload_json, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at`).run(payload, new Date().toISOString());
    },
    debugOverwriteLegacyPayload(payload) {
      db.prepare(`INSERT INTO lan_active_room (id, payload_json, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at`).run(payload, new Date().toISOString());
    },
    close() { db.close(); },
  };
}
