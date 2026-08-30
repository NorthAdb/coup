import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import type { RoomRecord } from "./roomRegistry.js";
import { openRoomStore } from "./roomStore.js";

const tempDirs: string[] = [];

async function tempDbPath() {
  const dir = await mkdtemp(path.join(tmpdir(), "coup-room-store-"));
  tempDirs.push(dir);
  return path.join(dir, "coup.sqlite");
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

function sampleLobbyRoom(): RoomRecord {
  return {
    code: "4242",
    phase: "lobby",
    createdAt: 1_700_000_000_000,
    matchId: null,
    turnTimeLimitSec: 60,
    seats: [
      {
        seatId: "1",
        kind: "local_human",
        displayName: "你",
        credentialHash: "host-hash",
        rematchStatus: null,
      },
      {
        seatId: "2",
        kind: "remote_human",
        displayName: "客人甲",
        credentialHash: "guest-hash",
        rematchStatus: null,
      },
      {
        seatId: "3",
        kind: "closed",
        displayName: null,
        credentialHash: null,
        rematchStatus: null,
      },
      {
        seatId: "4",
        kind: "open",
        displayName: null,
        credentialHash: null,
        rematchStatus: null,
      },
      {
        seatId: "5",
        kind: "closed",
        displayName: null,
        credentialHash: null,
        rematchStatus: null,
      },
      {
        seatId: "6",
        kind: "open",
        displayName: null,
        credentialHash: null,
        rematchStatus: null,
      },
    ],
  };
}

describe("RoomStore", () => {
  it("stores, loads, and clears rooms independently", async () => {
    const dbPath = await tempDbPath();
    const store = openRoomStore(dbPath);
    const first = sampleLobbyRoom();
    const second = { ...sampleLobbyRoom(), code: "5151" };
    store.saveRoom(first);
    store.saveRoom(second);
    assert.deepEqual(store.loadRooms(), { ok: true, rooms: [first, second], failures: [] });
    store.clearRoom(first.code);
    assert.deepEqual(store.loadRooms(), { ok: true, rooms: [second], failures: [] });
    store.close();
  });

  it("migrates the legacy room row and does not read it afterwards", async () => {
    const dbPath = await tempDbPath();
    const first = openRoomStore(dbPath);
    first.debugOverwritePayload(JSON.stringify(sampleLobbyRoom()));
    first.close();

    const second = openRoomStore(dbPath);
    assert.deepEqual(second.loadRooms(), {
      ok: true,
      rooms: [sampleLobbyRoom()],
      failures: [],
    });
    second.debugOverwriteLegacyPayload(JSON.stringify({ ...sampleLobbyRoom(), code: "9999" }));
    assert.deepEqual(second.loadRooms(), {
      ok: true,
      rooms: [sampleLobbyRoom()],
      failures: [],
    });
    second.close();
  });

  it("reports corrupt legacy data while retaining it", async () => {
    const dbPath = await tempDbPath();
    const first = openRoomStore(dbPath);
    first.debugOverwritePayload("{broken");
    first.close();
    const second = openRoomStore(dbPath);
    const loaded = second.loadRooms();
    assert.equal(loaded.ok, false);
    if (loaded.ok) throw new Error("expected migration failure");
    assert.equal(loaded.failures[0]?.roomCode, null);
    assert.equal(loaded.failures[0]?.reason, "corrupt");
    second.close();
  });

  it("persists an active lobby room across reopen", async () => {
    const dbPath = await tempDbPath();
    const room = sampleLobbyRoom();

    const first = openRoomStore(dbPath);
    first.saveRoom(room);
    first.close();

    const second = openRoomStore(dbPath);
    const loaded = second.loadRooms();
    assert.deepEqual(loaded, { ok: true, rooms: [room], failures: [] });
    second.close();
  });

  it("persists match-phase room with linked matchId", async () => {
    const dbPath = await tempDbPath();
    const room: RoomRecord = {
      ...sampleLobbyRoom(),
      phase: "match",
      matchId: "match-abc",
      seats: sampleLobbyRoom().seats.map((seat) =>
        seat.kind === "open" || seat.kind === "closed"
          ? { ...seat, kind: "closed" as const }
          : seat,
      ),
    };

    const store = openRoomStore(dbPath);
    store.saveRoom(room);
    const loaded = store.loadRooms();
    assert.deepEqual(loaded, { ok: true, rooms: [room], failures: [] });
    store.close();
  });

  it("clears the active room so load returns none", async () => {
    const dbPath = await tempDbPath();
    const store = openRoomStore(dbPath);
    const room = sampleLobbyRoom();
    store.saveRoom(room);
    store.clearRoom(room.code);
    assert.deepEqual(store.loadRooms(), { ok: true, rooms: [], failures: [] });
    store.close();
  });

  it("reports corrupt payload as load failure", async () => {
    const dbPath = await tempDbPath();
    const store = openRoomStore(dbPath);
    store.debugOverwritePayload("{not-json");
    store.close();
    const reopened = openRoomStore(dbPath);
    const loaded = reopened.loadRooms();
    assert.equal(loaded.ok, false);
    if (loaded.ok) throw new Error("expected failure");
    assert.equal(loaded.failures[0]?.reason, "corrupt");
    reopened.close();
  });

  it("degrades legacy local_agent seats to closed and drops cli/modelId", async () => {
    const dbPath = await tempDbPath();
    const store = openRoomStore(dbPath);
    store.debugOverwritePayload(
      JSON.stringify({
        code: "1111",
        phase: "lobby",
        createdAt: 1_700_000_000_000,
        matchId: null,
        seats: [
          {
            seatId: "1",
            kind: "local_human",
            displayName: "你",
            credentialHash: null,
            cli: null,
            modelId: null,
          },
          {
            seatId: "2",
            kind: "local_agent",
            displayName: "灰狐",
            credentialHash: null,
            cli: "stub",
            modelId: "stub/placeholder",
          },
        ],
      }),
    );
    store.close();
    const reopened = openRoomStore(dbPath);
    const loaded = reopened.loadRooms();
    assert.equal(loaded.ok, true);
    if (!loaded.ok || !loaded.rooms[0]) throw new Error("expected room");
    assert.equal(loaded.rooms[0].seats[1]?.kind, "closed");
    assert.deepEqual(
      Object.keys(loaded.rooms[0].seats[1] ?? {}).sort(),
      ["credentialHash", "displayName", "kind", "rematchStatus", "seatId"].sort(),
    );
    reopened.close();
  });
});
