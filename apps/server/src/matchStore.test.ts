import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { createMatch } from "@coup/domain";
import { openMatchStore, type MatchStore } from "./matchStore.js";
import { persistenceForStore } from "./createApp.js";

const tempDirs: string[] = [];

async function tempDbPath() {
  const dir = await mkdtemp(path.join(tmpdir(), "coup-store-"));
  tempDirs.push(dir);
  return path.join(dir, "coup.sqlite");
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

function sampleMatch(matchId = "match-1") {
  return createMatch({
    matchId,
    seed: "seed-1",
    seats: [
      { seatId: "seat-1", controller: "local_human" },
      { seatId: "seat-2", controller: "stub_agent" },
    ],
  });
}

function openSample(store: MatchStore, matchId = "match-1") {
  const created = sampleMatch(matchId);
  store.createRun({
    matchId,
    roomCode: "4242",
    humanSeatId: "seat-1",
    displayNames: { "seat-1": "你", "seat-2": "灰狐" },
    seatAgents: {
      "seat-2": { cli: "stub", modelId: null },
    },
    state: created.state,
    events: created.events,
  });
  return created;
}

describe("MatchStore", () => {
  it("commits new events and snapshot in one transaction", async () => {
    const dbPath = await tempDbPath();
    const store = openMatchStore(dbPath);
    try {
      const created = openSample(store);
      const nextVersion = created.state.stateVersion + 1;
      const nextState = {
        ...created.state,
        stateVersion: nextVersion,
        seats: created.state.seats.map((seat, index) =>
          index === 0 ? { ...seat, coins: seat.coins + 1 } : seat,
        ),
      };
      const newEvents = [
        {
          type: "action_declared" as const,
          seatId: "seat-1",
          actionType: "income" as const,
        },
        {
          type: "action_resolved" as const,
          seatId: "seat-1",
          actionType: "income" as const,
          coinsGained: 1,
        },
      ];

      store.commitCommand(created.state.matchId, nextState, newEvents);

      const loaded = store.getRun(created.state.matchId);
      assert.ok(loaded);
      assert.equal(loaded.state.stateVersion, nextVersion);
      assert.equal(loaded.state.seats[0]?.coins, created.state.seats[0]!.coins + 1);
      assert.equal(loaded.events.length, created.events.length + newEvents.length);
      assert.equal(loaded.events.at(-1)?.type, "action_resolved");
    } finally {
      store.close();
    }
  });

  it("lists match events in monotonic sequence for replay browsing", async () => {
    const dbPath = await tempDbPath();
    const store = openMatchStore(dbPath);
    try {
      const created = openSample(store);
      store.commitCommand(created.state.matchId, created.state, [
        {
          type: "turn_advanced",
          seatId: "seat-2",
        },
      ]);

      const listed = store.listEvents(created.state.matchId);
      assert.equal(listed.length, created.events.length + 1);
      assert.equal(listed[0]?.seq, 1);
      assert.equal(listed[1]?.seq, 2);
      assert.equal(listed.at(-1)?.event.type, "turn_advanced");
    } finally {
      store.close();
    }
  });

  it("reopens the same db file and restores an in-progress run", async () => {
    const dbPath = await tempDbPath();
    const first = openMatchStore(dbPath);
    const created = openSample(first, "match-persist");
    first.commitCommand(created.state.matchId, {
      ...created.state,
      stateVersion: created.state.stateVersion + 1,
    }, [
      { type: "turn_advanced", seatId: "seat-2" },
    ]);
    first.close();

    const second = openMatchStore(dbPath);
    try {
      const resumable = second.findResumableRun();
      assert.ok(resumable);
      assert.equal(resumable.matchId, "match-persist");
      assert.equal(resumable.runStatus, "in_progress");
      assert.equal(resumable.state.stateVersion, created.state.stateVersion + 1);
      assert.equal(resumable.displayNames["seat-2"], "灰狐");
      assert.equal(resumable.seatAgents["seat-2"]?.cli, "stub");
      assert.equal(resumable.events.at(-1)?.type, "turn_advanced");
    } finally {
      second.close();
    }
  });

  it("finds in-progress runs by room and allows different rooms to coexist", async () => {
    const dbPath = await tempDbPath();
    const store = openMatchStore(dbPath);
    try {
      openSample(store, "match-a");
      const created = sampleMatch("match-b");
      store.createRun({
        matchId: "match-b", roomCode: "5151", humanSeatId: "seat-1",
        displayNames: { "seat-1": "你", "seat-2": "灰狐" },
        seatAgents: { "seat-2": { cli: "stub", modelId: null } },
        state: created.state, events: created.events,
      });
      assert.equal(store.findResumableRun("4242")?.matchId, "match-a");
      assert.equal(store.findResumableRun("5151")?.matchId, "match-b");
      assert.deepEqual(store.listRuns("5151").map((run) => run.matchId), ["match-b"]);
    } finally {
      store.close();
    }
  });

  it("creates runs in their room without aborting another room's run", async () => {
    const dbPath = await tempDbPath();
    const store = openMatchStore(dbPath);
    try {
      const persistence = persistenceForStore(store);
      const first = sampleMatch("match-room-a");
      persistence.onCreated(
        {
          state: first.state,
          events: first.events,
          humanSeatId: "seat-1",
          displayNames: { "seat-1": "你", "seat-2": "灰狐" },
        },
        "4242",
      );
      const second = sampleMatch("match-room-b");
      persistence.onCreated(
        {
          state: second.state,
          events: second.events,
          humanSeatId: "seat-1",
          displayNames: { "seat-1": "你", "seat-2": "灰狐" },
        },
        "5151",
      );

      assert.equal(store.findResumableRun("4242")?.matchId, "match-room-a");
      assert.equal(store.findResumableRun("5151")?.matchId, "match-room-b");
      assert.equal(store.getRun("match-room-a")?.runStatus, "in_progress");
    } finally {
      store.close();
    }
  });

  it("records technical abort with no winner and keeps the last snapshot", async () => {
    const dbPath = await tempDbPath();
    const store = openMatchStore(dbPath);
    try {
      const created = openSample(store);
      const version = created.state.stateVersion + 1;
      store.commitCommand(
        created.state.matchId,
        { ...created.state, stateVersion: version },
        [{ type: "turn_advanced", seatId: "seat-2" }],
      );

      store.technicalAbort(created.state.matchId, "agent_decision_not_legal");

      const run = store.getRun(created.state.matchId);
      assert.ok(run);
      assert.equal(run.runStatus, "technical_abort");
      assert.equal(run.winnerSeatId, null);
      assert.equal(run.abortReason, "agent_decision_not_legal");
      assert.equal(run.state.stateVersion, version);
      assert.equal(run.state.status, "in_progress");
      assert.equal(run.state.winnerSeatId, null);
    } finally {
      store.close();
    }
  });

  it("creates a resume run from the aborted snapshot with a new match id", async () => {
    const dbPath = await tempDbPath();
    const store = openMatchStore(dbPath);
    try {
      const created = openSample(store, "match-old");
      store.commitCommand(
        created.state.matchId,
        { ...created.state, stateVersion: created.state.stateVersion + 1 },
        [{ type: "turn_advanced", seatId: "seat-2" }],
      );
      store.technicalAbort(created.state.matchId, "agent_timeout");

      const resumed = store.createResumeRun(created.state.matchId, "match-new");
      assert.equal(resumed.matchId, "match-new");
      assert.equal(resumed.runStatus, "in_progress");
      assert.equal(resumed.resumedFromMatchId, "match-old");
      assert.equal(resumed.state.matchId, "match-new");
      assert.equal(resumed.state.stateVersion, created.state.stateVersion + 1);
      assert.equal(resumed.events.length, created.events.length + 1);
      assert.equal(resumed.humanSeatId, "seat-1");

      const old = store.getRun("match-old");
      assert.ok(old);
      assert.equal(old.runStatus, "technical_abort");
      assert.equal(old.state.matchId, "match-old");
    } finally {
      store.close();
    }
  });

  it("does not write credentials or raw model transcripts into the database", async () => {
    const dbPath = await tempDbPath();
    const store = openMatchStore(dbPath);
    try {
      openSample(store);
      const blob = store.debugDumpAllText();
      assert.equal(blob.includes("oauth_token"), false);
      assert.equal(blob.includes("Authorization"), false);
      assert.equal(blob.includes("sk-"), false);
      assert.equal(blob.includes("transcript"), false);
      assert.equal(blob.includes("system prompt"), false);
    } finally {
      store.close();
    }
  });
});
