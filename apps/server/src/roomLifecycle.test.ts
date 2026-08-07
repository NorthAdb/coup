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
