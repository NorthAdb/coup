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
    seats: [
      {
        seatId: "1",
        kind: "local_human",
        displayName: "你",
        credentialHash: "host-hash",
        cli: null,
        modelId: null,
      },
      {
        seatId: "2",
        kind: "remote_human",
        displayName: "客人甲",
        credentialHash: "guest-hash",
        cli: null,
        modelId: null,
      },
      {
        seatId: "3",
        kind: "local_agent",
        displayName: "灰狐",
        credentialHash: null,
        cli: "stub",
        modelId: null,
      },
      {
        seatId: "4",
        kind: "open",
        displayName: null,
        credentialHash: null,
        cli: null,
        modelId: null,
      },
      {
        seatId: "5",
        kind: "closed",
        displayName: null,
        credentialHash: null,
        cli: null,
        modelId: null,
      },
      {
        seatId: "6",
        kind: "open",
        displayName: null,
        credentialHash: null,
        cli: null,
        modelId: null,
      },
    ],
  };
}

describe("RoomStore", () => {
  it("persists an active lobby room across reopen", async () => {
    const dbPath = await tempDbPath();
    const room = sampleLobbyRoom();

    const first = openRoomStore(dbPath);
    first.saveActiveRoom(room);
    first.close();

    const second = openRoomStore(dbPath);
    const loaded = second.loadActiveRoom();
    assert.deepEqual(loaded, { ok: true, room });
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
    store.saveActiveRoom(room);
    const loaded = store.loadActiveRoom();
    assert.deepEqual(loaded, { ok: true, room });
    store.close();
  });

  it("clears the active room so load returns none", async () => {
    const dbPath = await tempDbPath();
    const store = openRoomStore(dbPath);
    store.saveActiveRoom(sampleLobbyRoom());
    store.clearActiveRoom();
    assert.deepEqual(store.loadActiveRoom(), { ok: true, room: null });
    store.close();
  });

  it("reports corrupt payload as load failure", async () => {
    const dbPath = await tempDbPath();
    const store = openRoomStore(dbPath);
    store.saveActiveRoom(sampleLobbyRoom());
    store.debugOverwritePayload("{not-json");
    const loaded = store.loadActiveRoom();
    assert.equal(loaded.ok, false);
    if (loaded.ok) throw new Error("expected failure");
    assert.equal(loaded.reason, "corrupt");
    store.close();
  });
});
