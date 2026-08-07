import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { DomainEvent, MatchState } from "@coup/domain";

/** 兼容旧库 seat_agents_json 列；联机版恒为空对象�?*/
export type LegacySeatAgent = {
  cli: string;
  modelId: string | null;
};

export type MatchRunStatus =
  | "in_progress"
  | "finished"
  | "technical_abort"
  | "user_abort"
  | "migration_error";

export type StoredMatchEvent = {
  seq: number;
  event: DomainEvent;
};

export type MatchRunRecord = {
  matchId: string;
  roomCode: string | null;
  runStatus: MatchRunStatus;
  winnerSeatId: string | null;
  abortReason: string | null;
  resumedFromMatchId: string | null;
  humanSeatId: string;
  displayNames: Record<string, string>;
  seatAgents: Record<string, LegacySeatAgent>;
  state: MatchState;
  events: DomainEvent[];
};

export type CreateRunInput = {
  matchId: string;
  roomCode: string;
  humanSeatId: string;
  displayNames: Record<string, string>;
  seatAgents: Record<string, LegacySeatAgent>;
  state: MatchState;
  events: DomainEvent[];
  resumedFromMatchId?: string | null;
};

export type MatchStore = {
  createRun(input: CreateRunInput): MatchRunRecord;
  commitCommand(
    matchId: string,
    state: MatchState,
    newEvents: DomainEvent[],
  ): MatchRunRecord;
  getRun(matchId: string): MatchRunRecord | null;
  listEvents(matchId: string): StoredMatchEvent[];
  listRuns(roomCode?: string): Array<{
    matchId: string;
    runStatus: MatchRunStatus;
    winnerSeatId: string | null;
    resumedFromMatchId: string | null;
    stateVersion: number;
  }>;
  findResumableRun(roomCode?: string): MatchRunRecord | null;
  migrateLegacyRuns(rooms: Array<{ code: string; matchId: string | null }>): void;
  technicalAbort(matchId: string, reason: string): MatchRunRecord;
  userAbort(matchId: string): MatchRunRecord;
  createResumeRun(fromMatchId: string, newMatchId: string, roomCode?: string): MatchRunRecord;
  /** Test/diagnostic: concatenate all text columns (must stay free of secrets). */
  debugDumpAllText(): string;
  close(): void;
};

function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

function mapRunStatus(status: MatchState["status"]): MatchRunStatus {
  if (status === "finished") return "finished";
  if (status === "aborted") return "technical_abort";
  return "in_progress";
}

export function openMatchStore(dbPath: string): MatchStore {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS match_runs (
      match_id TEXT PRIMARY KEY NOT NULL,
      room_code TEXT NOT NULL,
      run_status TEXT NOT NULL,
      winner_seat_id TEXT,
      abort_reason TEXT,
      resumed_from_match_id TEXT,
      human_seat_id TEXT NOT NULL,
      display_names_json TEXT NOT NULL,
      seat_agents_json TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS match_events (
      match_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      event_json TEXT NOT NULL,
      PRIMARY KEY (match_id, seq),
      FOREIGN KEY (match_id) REFERENCES match_runs(match_id)
    );
  `);
  const columns = db.prepare(`PRAGMA table_info(match_runs)`).all() as Array<{ name: string; notnull: number }>;
  if (!columns.some((column) => column.name === "room_code")) {
    db.exec(`ALTER TABLE match_runs ADD COLUMN room_code TEXT`);
  }
  const roomCodeColumn = columns.find((column) => column.name === "room_code");
  if (!roomCodeColumn || roomCodeColumn.notnull === 0) {
    db.exec("BEGIN");
    try {
      db.exec(`UPDATE match_runs SET room_code = '__migration_error__' WHERE room_code IS NULL`);
      db.exec(`ALTER TABLE match_runs RENAME TO match_runs_before_room_code_constraint`);
      db.exec(`
        CREATE TABLE match_runs (
          match_id TEXT PRIMARY KEY NOT NULL,
          room_code TEXT NOT NULL,
          run_status TEXT NOT NULL,
          winner_seat_id TEXT,
          abort_reason TEXT,
          resumed_from_match_id TEXT,
          human_seat_id TEXT NOT NULL,
          display_names_json TEXT NOT NULL,
          seat_agents_json TEXT NOT NULL,
          snapshot_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
      db.exec(`INSERT INTO match_runs (
        match_id, room_code, run_status, winner_seat_id, abort_reason,
        resumed_from_match_id, human_seat_id, display_names_json,
        seat_agents_json, snapshot_json, updated_at
      ) SELECT
        match_id, room_code, run_status, winner_seat_id, abort_reason,
        resumed_from_match_id, human_seat_id, display_names_json,
        seat_agents_json, snapshot_json, updated_at
        FROM match_runs_before_room_code_constraint`);
      db.exec(`DROP TABLE match_runs_before_room_code_constraint`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  db.exec(`CREATE INDEX IF NOT EXISTS match_runs_room_status_updated ON match_runs (room_code, run_status, updated_at)`);

  function readEvents(matchId: string): DomainEvent[] {
    const rows = db
      .prepare(
        `SELECT event_json AS eventJson
         FROM match_events
         WHERE match_id = ?
         ORDER BY seq ASC`,
      )
      .all(matchId) as Array<{ eventJson: string }>;
    return rows.map((row) => parseJson<DomainEvent>(row.eventJson));
  }

  function readRun(matchId: string): MatchRunRecord | null {
    const row = db
      .prepare(
        `SELECT
            match_id AS matchId,
            room_code AS roomCode,
           run_status AS runStatus,
           winner_seat_id AS winnerSeatId,
           abort_reason AS abortReason,
           resumed_from_match_id AS resumedFromMatchId,
           human_seat_id AS humanSeatId,
           display_names_json AS displayNamesJson,
           seat_agents_json AS seatAgentsJson,
           snapshot_json AS snapshotJson
         FROM match_runs
         WHERE match_id = ?`,
      )
      .get(matchId) as
      | {
           matchId: string;
           roomCode: string | null;
          runStatus: MatchRunStatus;
          winnerSeatId: string | null;
          abortReason: string | null;
          resumedFromMatchId: string | null;
          humanSeatId: string;
          displayNamesJson: string;
          seatAgentsJson: string;
          snapshotJson: string;
        }
      | undefined;
    if (!row) return null;
    return {
       matchId: row.matchId,
       roomCode: row.roomCode,
      runStatus: row.runStatus,
      winnerSeatId: row.winnerSeatId,
      abortReason: row.abortReason,
      resumedFromMatchId: row.resumedFromMatchId,
      humanSeatId: row.humanSeatId,
      displayNames: parseJson(row.displayNamesJson),
      seatAgents: parseJson(row.seatAgentsJson),
      state: parseJson(row.snapshotJson),
      events: readEvents(matchId),
    };
  }

  function nextSeq(matchId: string): number {
    const row = db
      .prepare(
        `SELECT COALESCE(MAX(seq), 0) AS maxSeq
         FROM match_events
         WHERE match_id = ?`,
      )
      .get(matchId) as { maxSeq: number };
    return row.maxSeq + 1;
  }

  function insertEvents(matchId: string, events: DomainEvent[], startSeq: number) {
    const insert = db.prepare(
      `INSERT INTO match_events (match_id, seq, event_json)
       VALUES (?, ?, ?)`,
    );
    let seq = startSeq;
    for (const event of events) {
      insert.run(matchId, seq, JSON.stringify(event));
      seq += 1;
    }
  }

  function upsertRunRow(input: {
    matchId: string;
    roomCode: string | null;
    runStatus: MatchRunStatus;
    winnerSeatId: string | null;
    abortReason: string | null;
    resumedFromMatchId: string | null;
    humanSeatId: string;
    displayNames: Record<string, string>;
    seatAgents: Record<string, LegacySeatAgent>;
    state: MatchState;
  }) {
    db.prepare(
      `INSERT INTO match_runs (
          match_id, room_code, run_status, winner_seat_id, abort_reason,
         resumed_from_match_id, human_seat_id, display_names_json,
         seat_agents_json, snapshot_json, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(match_id) DO UPDATE SET
          run_status = excluded.run_status,
          room_code = excluded.room_code,
         winner_seat_id = excluded.winner_seat_id,
         abort_reason = excluded.abort_reason,
         resumed_from_match_id = excluded.resumed_from_match_id,
         human_seat_id = excluded.human_seat_id,
         display_names_json = excluded.display_names_json,
         seat_agents_json = excluded.seat_agents_json,
         snapshot_json = excluded.snapshot_json,
         updated_at = excluded.updated_at`,
    ).run(
      input.matchId,
      input.roomCode,
      input.runStatus,
      input.winnerSeatId,
      input.abortReason,
      input.resumedFromMatchId,
      input.humanSeatId,
      JSON.stringify(input.displayNames),
      JSON.stringify(input.seatAgents),
      JSON.stringify(input.state),
      new Date().toISOString(),
    );
  }

  const store: MatchStore = {
    createRun(input) {
      if (!input.roomCode) throw new Error("room_code_required");
      const existing = readRun(input.matchId);
      if (existing) {
        throw new Error(`match_already_exists:${input.matchId}`);
      }
      db.exec("BEGIN");
      try {
        upsertRunRow({
          matchId: input.matchId,
          roomCode: input.roomCode ?? null,
          runStatus: mapRunStatus(input.state.status),
          winnerSeatId: input.state.winnerSeatId,
          abortReason: null,
          resumedFromMatchId: input.resumedFromMatchId ?? null,
          humanSeatId: input.humanSeatId,
          displayNames: input.displayNames,
          seatAgents: input.seatAgents,
          state: input.state,
        });
        insertEvents(input.matchId, input.events, 1);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      const created = readRun(input.matchId);
      if (!created) throw new Error("create_run_failed");
      return created;
    },

    commitCommand(matchId, state, newEvents) {
      const current = readRun(matchId);
      if (!current) throw new Error(`match_not_found:${matchId}`);
      if (current.runStatus !== "in_progress") {
        throw new Error(`match_not_active:${current.runStatus}`);
      }
      db.exec("BEGIN");
      try {
        insertEvents(matchId, newEvents, nextSeq(matchId));
        upsertRunRow({
          matchId,
           roomCode: current.roomCode,
          runStatus: mapRunStatus(state.status),
          winnerSeatId: state.winnerSeatId,
          abortReason: null,
          resumedFromMatchId: current.resumedFromMatchId,
          humanSeatId: current.humanSeatId,
          displayNames: current.displayNames,
          seatAgents: current.seatAgents,
          state,
        });
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      const updated = readRun(matchId);
      if (!updated) throw new Error("commit_failed");
      return updated;
    },

    getRun(matchId) {
      return readRun(matchId);
    },

    listEvents(matchId) {
      const rows = db
        .prepare(
          `SELECT seq, event_json AS eventJson
           FROM match_events
           WHERE match_id = ?
           ORDER BY seq ASC`,
        )
        .all(matchId) as Array<{ seq: number; eventJson: string }>;
      return rows.map((row) => ({
        seq: row.seq,
        event: parseJson<DomainEvent>(row.eventJson),
      }));
    },

    listRuns(roomCode) {
      const rows = db
        .prepare(
          `SELECT
             match_id AS matchId,
             room_code AS roomCode,
             run_status AS runStatus,
             winner_seat_id AS winnerSeatId,
             resumed_from_match_id AS resumedFromMatchId,
             snapshot_json AS snapshotJson
           FROM match_runs
           ORDER BY updated_at DESC`,
        )
        .all() as Array<{
         matchId: string;
         roomCode: string | null;
        runStatus: MatchRunStatus;
        winnerSeatId: string | null;
        resumedFromMatchId: string | null;
        snapshotJson: string;
      }>;
       return rows.filter((row) => !roomCode || row.roomCode === roomCode).map((row) => ({
        matchId: row.matchId,
        runStatus: row.runStatus,
        winnerSeatId: row.winnerSeatId,
        resumedFromMatchId: row.resumedFromMatchId,
        stateVersion: parseJson<MatchState>(row.snapshotJson).stateVersion,
      }));
    },

    findResumableRun(roomCode) {
      const row = db
        .prepare(
          `SELECT match_id AS matchId
           FROM match_runs
           WHERE run_status = 'in_progress' AND (? IS NULL OR room_code = ?)
           ORDER BY updated_at DESC
           LIMIT 1`,
        )
        .get(roomCode ?? null, roomCode ?? null) as { matchId: string } | undefined;
      if (!row) return null;
      return readRun(row.matchId);
    },

    migrateLegacyRuns(rooms) {
      const associate = db.prepare(
        `UPDATE match_runs SET room_code = ? WHERE match_id = ? AND room_code = '__migration_error__'`,
      );
      for (const room of rooms) {
        if (room.matchId) associate.run(room.code, room.matchId);
      }
      db.prepare(
        `UPDATE match_runs SET run_status = 'migration_error' WHERE room_code = '__migration_error__'`,
      ).run();
    },

    technicalAbort(matchId, reason) {
      const current = readRun(matchId);
      if (!current) throw new Error(`match_not_found:${matchId}`);
      db.exec("BEGIN");
      try {
        upsertRunRow({
          matchId,
          roomCode: current.roomCode,
          runStatus: "technical_abort",
          winnerSeatId: null,
          abortReason: reason,
          resumedFromMatchId: current.resumedFromMatchId,
          humanSeatId: current.humanSeatId,
          displayNames: current.displayNames,
          seatAgents: current.seatAgents,
          state: {
            ...current.state,
            // Keep domain snapshot at last good command; run-level status is abort.
            winnerSeatId: null,
          },
        });
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      const updated = readRun(matchId);
      if (!updated) throw new Error("technical_abort_failed");
      return updated;
    },

    userAbort(matchId) {
      const current = readRun(matchId);
      if (!current) throw new Error(`match_not_found:${matchId}`);
      db.exec("BEGIN");
      try {
        upsertRunRow({
          matchId,
          roomCode: current.roomCode,
          runStatus: "user_abort",
          winnerSeatId: null,
          abortReason: "user_abort",
          resumedFromMatchId: current.resumedFromMatchId,
          humanSeatId: current.humanSeatId,
          displayNames: current.displayNames,
          seatAgents: current.seatAgents,
          state: { ...current.state, winnerSeatId: null },
        });
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      const updated = readRun(matchId);
      if (!updated) throw new Error("user_abort_failed");
      return updated;
    },

    createResumeRun(fromMatchId, newMatchId, roomCode) {
      const source = readRun(fromMatchId);
      if (!source) throw new Error(`match_not_found:${fromMatchId}`);
      if (
        source.runStatus !== "technical_abort" &&
        source.runStatus !== "user_abort"
      ) {
        throw new Error(`match_not_resumable:${source.runStatus}`);
      }
      if (readRun(newMatchId)) {
        throw new Error(`match_already_exists:${newMatchId}`);
      }

      const resumedState: MatchState = {
        ...structuredClone(source.state),
        matchId: newMatchId,
        status: "in_progress",
        winnerSeatId: null,
      };
      const resumedEvents = structuredClone(source.events).map((event) => {
        if (event.type === "match_started") {
          return { ...event, matchId: newMatchId };
        }
        return event;
      });

      const resumedRoomCode = roomCode ?? source.roomCode;
      if (!resumedRoomCode) throw new Error("room_code_required");
      return store.createRun({
        matchId: newMatchId,
        roomCode: resumedRoomCode,
        humanSeatId: source.humanSeatId,
        displayNames: source.displayNames,
        seatAgents: source.seatAgents,
        state: resumedState,
        events: resumedEvents,
        resumedFromMatchId: fromMatchId,
      });
    },

    debugDumpAllText() {
      const runRows = db
        .prepare(
          `SELECT
             match_id, run_status, winner_seat_id, abort_reason,
             resumed_from_match_id, human_seat_id,
             display_names_json, seat_agents_json, snapshot_json, updated_at
           FROM match_runs`,
        )
        .all();
      const eventRows = db
        .prepare(`SELECT match_id, seq, event_json FROM match_events`)
        .all();
      return `${JSON.stringify(runRows)}\n${JSON.stringify(eventRows)}`;
    },

    close() {
      db.close();
    },
  };

  return store;
}
