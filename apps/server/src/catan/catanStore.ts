import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CatanGame, GameEvent } from "@coup/catan-domain";
import type { RoomRecord } from "../roomRegistry.js";

/**
 * Catan 房间与对局持久化（与 coup/brass/splendor 同构，独立表避免互扰）：
 * - catan_rooms：整份 RoomRecord JSON blob。
 * - catan_runs：对局快照 blob + 运行状态（重启恢复 / 观战 / 终局归档）。
 */

export type CatanRunStatus = "in_progress" | "finished" | "technical_abort" | "user_abort";

export type CatanRunRecord = {
  matchId: string;
  roomCode: string | null;
  runStatus: CatanRunStatus;
  abortReason: string | null;
  humanSeatId: string;
  displayNames: Record<string, string>;
  state: CatanGame;
  events: GameEvent[];
};

export type CatanStore = {
  saveCatanRoom(room: RoomRecord): void;
  clearCatanRoom(code: string): void;
  loadCatanRooms(): { rooms: RoomRecord[]; failures: Array<{ roomCode: string | null; reason: string }> };
  createRun(input: {
    matchId: string;
    roomCode: string;
    humanSeatId: string;
    displayNames: Record<string, string>;
    state: CatanGame;
    events: GameEvent[];
  }): void;
  commitCommand(matchId: string, state: CatanGame, newEvents: GameEvent[]): void;
  getRun(matchId: string): CatanRunRecord | null;
  technicalAbort(matchId: string, reason: string): void;
  userAbort(matchId: string): void;
  close(): void;
};

function mapRunStatus(state: CatanGame): CatanRunStatus {
  if (state.status === "finished") return "finished";
  return "in_progress";
}

export function openCatanStore(dbPath: string): CatanStore {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS catan_rooms (
      room_code TEXT PRIMARY KEY NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS catan_runs (
      match_id TEXT PRIMARY KEY NOT NULL,
      room_code TEXT NOT NULL,
      run_status TEXT NOT NULL,
      abort_reason TEXT,
      human_seat_id TEXT NOT NULL,
      display_names_json TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const nowIso = () => new Date().toISOString();

  function rowToRun(row: {
    match_id: string;
    room_code: string;
    run_status: string;
    abort_reason: string | null;
    human_seat_id: string;
    display_names_json: string;
    snapshot_json: string;
  }): CatanRunRecord {
    const snapshot = JSON.parse(row.snapshot_json) as {
      state: CatanGame;
      events: GameEvent[];
    };
    return {
      matchId: row.match_id,
      roomCode: row.room_code,
      runStatus: row.run_status as CatanRunStatus,
      abortReason: row.abort_reason,
      humanSeatId: row.human_seat_id,
      displayNames: JSON.parse(row.display_names_json) as Record<string, string>,
      state: snapshot.state,
      events: snapshot.events ?? [],
    };
  }

  return {
    saveCatanRoom(room) {
      db.prepare(
        `INSERT INTO catan_rooms (room_code, payload_json, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(room_code) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at`,
      ).run(room.code, JSON.stringify(room), nowIso(), nowIso());
    },
    clearCatanRoom(code) {
      db.prepare(`DELETE FROM catan_rooms WHERE room_code = ?`).run(code);
    },
    loadCatanRooms() {
      const rooms: RoomRecord[] = [];
      const failures: Array<{ roomCode: string | null; reason: string }> = [];
      const rows = db.prepare(`SELECT room_code, payload_json FROM catan_rooms`).all() as Array<{
        room_code: string;
        payload_json: string;
      }>;
      for (const row of rows) {
        try {
          rooms.push(JSON.parse(row.payload_json) as RoomRecord);
        } catch {
          failures.push({ roomCode: row.room_code, reason: "room_payload_corrupt" });
        }
      }
      return { rooms, failures };
    },
    createRun(input) {
      db.prepare(
        `INSERT INTO catan_runs (match_id, room_code, run_status, abort_reason, human_seat_id, display_names_json, snapshot_json, updated_at)
         VALUES (?, ?, ?, NULL, ?, ?, ?, ?)`,
      ).run(
        input.matchId,
        input.roomCode,
        mapRunStatus(input.state),
        input.humanSeatId,
        JSON.stringify(input.displayNames),
        JSON.stringify({ state: input.state, events: input.events }),
        nowIso(),
      );
    },
    commitCommand(matchId, state, newEvents) {
      const row = db
        .prepare(`SELECT snapshot_json FROM catan_runs WHERE match_id = ?`)
        .get(matchId) as { snapshot_json: string } | undefined;
      const events = row ? ((JSON.parse(row.snapshot_json) as { events: GameEvent[] }).events ?? []) : [];
      db.prepare(
        `UPDATE catan_runs SET run_status = ?, snapshot_json = ?, updated_at = ? WHERE match_id = ?`,
      ).run(
        mapRunStatus(state),
        JSON.stringify({ state, events: [...events, ...newEvents] }),
        nowIso(),
        matchId,
      );
    },
    getRun(matchId) {
      const row = db.prepare(`SELECT * FROM catan_runs WHERE match_id = ?`).get(matchId) as
        | Parameters<typeof rowToRun>[0]
        | undefined;
      return row ? rowToRun(row) : null;
    },
    technicalAbort(matchId, reason) {
      db.prepare(`UPDATE catan_runs SET run_status = 'technical_abort', abort_reason = ?, updated_at = ? WHERE match_id = ?`).run(
        reason,
        nowIso(),
        matchId,
      );
    },
    userAbort(matchId) {
      db.prepare(`UPDATE catan_runs SET run_status = 'user_abort', updated_at = ? WHERE match_id = ?`).run(nowIso(), matchId);
    },
    close() {
      db.close();
    },
  };
}
