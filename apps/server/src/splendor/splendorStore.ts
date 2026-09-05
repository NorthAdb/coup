import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SplendorEvent, SplendorState } from "@coup/splendor-domain";
import type { RoomRecord } from "../roomRegistry.js";

/**
 * Splendor 房间与对局持久化（与 roomStore/brassStore 同构，独立表避免互扰）：
 * - splendor_rooms：整份 RoomRecord JSON blob。
 * - splendor_runs：对局快照 blob + 运行状态（重启恢复 / 观战 / 终局归档）。
 */

export type SplendorRunStatus = "in_progress" | "finished" | "technical_abort" | "user_abort";

export type SplendorRunRecord = {
  matchId: string;
  roomCode: string | null;
  runStatus: SplendorRunStatus;
  abortReason: string | null;
  humanSeatId: string;
  displayNames: Record<string, string>;
  state: SplendorState;
  events: SplendorEvent[];
};

export type SplendorStore = {
  saveSplendorRoom(room: RoomRecord): void;
  clearSplendorRoom(code: string): void;
  loadSplendorRooms(): { rooms: RoomRecord[]; failures: Array<{ roomCode: string | null; reason: string }> };
  createRun(input: {
    matchId: string;
    roomCode: string;
    humanSeatId: string;
    displayNames: Record<string, string>;
    state: SplendorState;
    events: SplendorEvent[];
  }): void;
  commitCommand(matchId: string, state: SplendorState, newEvents: SplendorEvent[]): void;
  getRun(matchId: string): SplendorRunRecord | null;
  technicalAbort(matchId: string, reason: string): void;
  userAbort(matchId: string): void;
  debugDumpAllText(): string;
  close(): void;
};

function mapRunStatus(state: SplendorState): SplendorRunStatus {
  if (state.status === "finished") return "finished";
  return "in_progress";
}

export function openSplendorStore(dbPath: string): SplendorStore {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS splendor_rooms (
      room_code TEXT PRIMARY KEY NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS splendor_runs (
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
  }): SplendorRunRecord {
    const snapshot = JSON.parse(row.snapshot_json) as {
      state: SplendorState;
      events: SplendorEvent[];
    };
    return {
      matchId: row.match_id,
      roomCode: row.room_code,
      runStatus: row.run_status as SplendorRunStatus,
      abortReason: row.abort_reason,
      humanSeatId: row.human_seat_id,
      displayNames: JSON.parse(row.display_names_json) as Record<string, string>,
      state: snapshot.state,
      events: snapshot.events ?? [],
    };
  }

  return {
    saveSplendorRoom(room) {
      db.prepare(
        `INSERT INTO splendor_rooms (room_code, payload_json, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(room_code) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at`,
      ).run(room.code, JSON.stringify(room), nowIso(), nowIso());
    },
    clearSplendorRoom(code) {
      db.prepare(`DELETE FROM splendor_rooms WHERE room_code = ?`).run(code);
    },
    loadSplendorRooms() {
      const rooms: RoomRecord[] = [];
      const failures: Array<{ roomCode: string | null; reason: string }> = [];
      const rows = db.prepare(`SELECT room_code, payload_json FROM splendor_rooms`).all() as Array<{
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
        `INSERT INTO splendor_runs (match_id, room_code, run_status, abort_reason, human_seat_id, display_names_json, snapshot_json, updated_at)
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
        .prepare(`SELECT snapshot_json FROM splendor_runs WHERE match_id = ?`)
        .get(matchId) as { snapshot_json: string } | undefined;
      const events = row ? ((JSON.parse(row.snapshot_json) as { events: SplendorEvent[] }).events ?? []) : [];
      db.prepare(
        `UPDATE splendor_runs SET run_status = ?, snapshot_json = ?, updated_at = ? WHERE match_id = ?`,
      ).run(
        mapRunStatus(state),
        JSON.stringify({ state, events: [...events, ...newEvents] }),
        nowIso(),
        matchId,
      );
    },
    getRun(matchId) {
      const row = db.prepare(`SELECT * FROM splendor_runs WHERE match_id = ?`).get(matchId) as
        | Parameters<typeof rowToRun>[0]
        | undefined;
      return row ? rowToRun(row) : null;
    },
    technicalAbort(matchId, reason) {
      db.prepare(`UPDATE splendor_runs SET run_status = 'technical_abort', abort_reason = ?, updated_at = ? WHERE match_id = ?`).run(
        reason,
        nowIso(),
        matchId,
      );
    },
    userAbort(matchId) {
      db.prepare(`UPDATE splendor_runs SET run_status = 'user_abort', updated_at = ? WHERE match_id = ?`).run(nowIso(), matchId);
    },
    debugDumpAllText() {
      const rooms = (db.prepare(`SELECT payload_json FROM splendor_rooms`).all() as Array<{ payload_json: string }>)
        .map((r) => r.payload_json)
        .join("\n");
      const runs = (db.prepare(`SELECT snapshot_json FROM splendor_runs`).all() as Array<{ snapshot_json: string }>)
        .map((r) => r.snapshot_json)
        .join("\n");
      return `${rooms}\n${runs}`;
    },
    close() {
      db.close();
    },
  };
}
