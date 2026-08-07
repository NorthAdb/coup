import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isRoomEmpty } from "./roomLifecycle.js";
import type { ActiveMatch } from "./matchRuntime.js";
import type { RoomRecord } from "./roomRegistry.js";

const room: RoomRecord = {
  code: "4242",
  phase: "match",
  createdAt: 1,
  matchId: "match-1",
  seats: [],
};

it("treats a lobby with only the host seat as empty", () => {
  const lobby: RoomRecord = {
    ...room,
    phase: "lobby",
    matchId: null,
    seats: [{ seatId: "1", kind: "local_human", credentialHash: null, displayName: null, rematchStatus: null }],
  };

  assert.equal(isRoomEmpty(lobby, null, () => null), true);
});

it("keeps a lobby occupied while a remote human has a seat", () => {
  const lobby: RoomRecord = {
    ...room,
    phase: "lobby",
    matchId: null,
    seats: [{ seatId: "2", kind: "remote_human", credentialHash: null, displayName: null, rematchStatus: null }],
  };

  assert.equal(isRoomEmpty(lobby, null, () => null), false);
});

it("keeps a match room occupied while its local human is eliminated", () => {
  const match = {
    state: {
      seats: [
        { seatId: "1", controller: "local_human", eliminated: true },
      ],
    },
  } as unknown as ActiveMatch;

  assert.equal(isRoomEmpty(room, match, () => null), false);
});

describe("match room emptiness", () => {
  it("ignores eliminated remote humans", () => {
    const match = {
      state: {
        seats: [
          { seatId: "2", controller: "remote_human", eliminated: true },
        ],
      },
    } as unknown as ActiveMatch;

    assert.equal(isRoomEmpty(room, match, () => null), true);
  });
});
