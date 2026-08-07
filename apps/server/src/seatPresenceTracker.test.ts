import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GRACE_MS } from "./seatAbsence.js";
import {
  HEARTBEAT_LEASE_MS,
  createSeatPresenceTracker,
} from "./seatPresenceTracker.js";

describe("room-scoped seat presence", () => {
  it("tracks the same seat independently in different rooms", () => {
    const tracker = createSeatPresenceTracker();
    const t0 = 1_000_000;

    tracker.trackSeat("room-a", "1");
    tracker.trackSeat("room-b", "1");
    tracker.noteHeartbeat("room-a", "1", t0);
    tracker.noteHeartbeat("room-b", "1", t0);

    tracker.tick("room-a", t0 + HEARTBEAT_LEASE_MS + 1);

    assert.equal(tracker.get("room-a", "1")?.phase, "reconnecting");
    assert.equal(tracker.get("room-b", "1")?.phase, "present");
    assert.equal(tracker.projectAll("room-a", t0)[0]?.seatId, "1");
    assert.deepEqual(tracker.projectAll("room-b", t0), []);
  });

  it("clears one room without affecting another room", () => {
    const tracker = createSeatPresenceTracker();
    tracker.trackSeat("room-a", "1");
    tracker.trackSeat("room-b", "1");
    tracker.grantRecoveryGrace(["1"], "room-a", 2_000_000);
    tracker.grantRecoveryGrace(["1"], "room-b", 2_000_000);

    tracker.clearRoom("room-a");

    assert.equal(tracker.get("room-a", "1"), null);
    assert.equal(tracker.get("room-b", "1")?.phase, "reconnecting");
    assert.equal(
      tracker.projectAll("room-b", 2_000_000 + GRACE_MS).length,
      1,
    );

    tracker.clearAll();
    assert.deepEqual(tracker.projectAll("room-b", 2_000_000), []);
  });
});
