import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { BrassState, LogEntry } from "@coup/brass-domain";
import type { RoomRecord } from "../roomRegistry.js";

/**
 * Brass 房间与对局持久化（与 coup 的 roomStore/matchStore 同构，独立表避免互扰）：
 * - brass_rooms：整份 RoomRecord JSON blob（座位凭证 hash、阶段、matchId、限时）。
 * - brass_runs：对局快照 blob + 运行状态（重启恢复 / 观战 / 终局归档）。
 */

export type BrassRunStatus = "in_progress" | "finished" | "technical_abort" | "user_abort";

export type BrassRunRecord = {
  matchId: string;
  roomCode: string | null;
  runStatus: BrassRunStatus;
  abortReason: string | null;
  humanSeatId: string;
  displayNames: Record<string, string>;
  state: BrassState;
  events: LogEntry[];
};

export type BrassStore = {
  saveBrassRoom(room: RoomRecord): void;
  clearBrassRoom(code: string): void;
  loadBrassRooms(): { rooms: RoomRecord[]; failures: Array<{ roomCode: string | null; reason: string }> };
  createRun(input: {
    matchId: string;
    roomCode: string;
    humanSeatId: string;
    displayNames: Record<string, string>;
    state: BrassState;
    events: LogEntry[];
  }): void;
  commitCommand(matchId: string, state: BrassState, newEvents: LogEntry[]): void;
  getRun(matchId: string): BrassRunRecord | null;
  technicalAbort(matchId: string, reason: string): void;
  userAbort(matchId: string): void;
  debugDumpAllText(): string;
  close(): void;
};

function mapRunStatus(state: BrassState): BrassRunStatus {
  if (state.status === "finished") return "finished";
  return "in_progress";
}

export function openBrassStore(dbPath: string): BrassStore {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS brass_rooms (
      room_code TEXT PRIMARY KEY NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS brass_runs (
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
  }): BrassRunRecord {
    const snapshot = JSON.parse(row.snapshot_json) as {
      state: BrassState;
      events: LogEntry[];
    };
    return {
      matchId: row.match_id,
      roomCode: row.room_code,
      runStatus: row.run_status as BrassRunStatus,
      abortReason: row.abort_reason,
      humanSeatId: row.human_seat_id,
      displayNames: JSON.parse(row.display_names_json) as Record<string, string>,
      state: snapshot.state,
      events: snapshot.events ?? [],
    };
  }

  return {
    saveBrassRoom(room) {
      db.prepare(
        `INSERT INTO brass_rooms (room_code, payload_json, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(room_code) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at`,
      ).run(room.code, JSON.stringify(room), nowIso(), nowIso());
    },
    clearBrassRoom(code) {
      db.prepare(`DELETE FROM brass_rooms WHERE room_code = ?`).run(code);
    },
    loadBrassRooms() {
      const rooms: RoomRecord[] = [];
      const failures: Array<{ roomCode: string | null; reason: string }> = [];
      const rows = db.prepare(`SELECT room_code, payload_json FROM brass_rooms`).all() as Array<{
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
        `INSERT INTO brass_runs (match_id, room_code, run_status, abort_reason, human_seat_id, display_names_json, snapshot_json, updated_at)
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
        .prepare(`SELECT snapshot_json FROM brass_runs WHERE match_id = ?`)
        .get(matchId) as { snapshot_json: string } | undefined;
      const events = row ? ((JSON.parse(row.snapshot_json) as { events: LogEntry[] }).events ?? []) : [];
      db.prepare(
        `UPDATE brass_runs SET run_status = ?, snapshot_json = ?, updated_at = ? WHERE match_id = ?`,
      ).run(
        mapRunStatus(state),
        JSON.stringify({ state, events: [...events, ...newEvents] }),
        nowIso(),
        matchId,
      );
    },
    getRun(matchId) {
      const row = db.prepare(`SELECT * FROM brass_runs WHERE match_id = ?`).get(matchId) as
        | Parameters<typeof rowToRun>[0]
        | undefined;
      return row ? rowToRun(row) : null;
    },
    technicalAbort(matchId, reason) {
      db.prepare(`UPDATE brass_runs SET run_status = 'technical_abort', abort_reason = ?, updated_at = ? WHERE match_id = ?`).run(
        reason,
        nowIso(),
        matchId,
      );
    },
    userAbort(matchId) {
      db.prepare(`UPDATE brass_runs SET run_status = 'user_abort', updated_at = ? WHERE match_id = ?`).run(nowIso(), matchId);
    },
    debugDumpAllText() {
      const rooms = (db.prepare(`SELECT payload_json FROM brass_rooms`).all() as Array<{ payload_json: string }>)
        .map((r) => r.payload_json)
        .join("\n");
      const runs = (db.prepare(`SELECT snapshot_json FROM brass_runs`).all() as Array<{ snapshot_json: string }>)
        .map((r) => r.snapshot_json)
        .join("\n");
      return `${rooms}\n${runs}`;
    },
    close() {
      db.close();
    },
  };
}
