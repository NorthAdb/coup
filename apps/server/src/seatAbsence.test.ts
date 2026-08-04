import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GRACE_MS,
  SOFT_TIMEOUT_MS,
  createSeatAbsence,
  extendAbsenceWait,
  markChannelDrop,
  markSeatResumed,
  projectSeatAbsence,
  seatBlocksAdvancement,
  tickSeatAbsence,
} from "./seatAbsence.js";

describe("seatAbsence", () => {
  it("enters reconnecting grace for 15s after channel drop", () => {
    const t0 = 1_000_000;
    const presence = markChannelDrop(createSeatAbsence("2"), t0);
    assert.equal(presence.phase, "reconnecting");
    assert.equal(presence.deadlineAt, t0 + GRACE_MS);
    assert.equal(GRACE_MS, 15_000);

    const projected = projectSeatAbsence(presence, t0 + 5_000);
    assert.equal(projected.phase, "reconnecting");
    assert.equal(projected.remainingMs, 10_000);
  });

  it("marks absent with 5min soft timeout when grace expires", () => {
    const t0 = 1_000_000;
    let presence = markChannelDrop(createSeatAbsence("2"), t0);
    presence = tickSeatAbsence(presence, t0 + GRACE_MS);
    assert.equal(presence.phase, "absent");
    assert.equal(presence.deadlineAt, t0 + GRACE_MS + SOFT_TIMEOUT_MS);
    assert.equal(SOFT_TIMEOUT_MS, 5 * 60_000);

    const projected = projectSeatAbsence(presence, t0 + GRACE_MS + 60_000);
    assert.equal(projected.phase, "absent");
    assert.equal(projected.remainingMs, SOFT_TIMEOUT_MS - 60_000);
  });

  it("marks timed_out when soft timeout expires", () => {
    const t0 = 1_000_000;
    let presence = markChannelDrop(createSeatAbsence("2"), t0);
    presence = tickSeatAbsence(presence, t0 + GRACE_MS);
    presence = tickSeatAbsence(presence, t0 + GRACE_MS + SOFT_TIMEOUT_MS);
    assert.equal(presence.phase, "timed_out");
    assert.equal(presence.deadlineAt, null);

    const projected = projectSeatAbsence(presence, t0 + GRACE_MS + SOFT_TIMEOUT_MS);
    assert.equal(projected.phase, "timed_out");
    assert.equal(projected.remainingMs, 0);
  });

  it("clears absence on resume during grace or soft wait", () => {
    const t0 = 1_000_000;
    let presence = markChannelDrop(createSeatAbsence("3"), t0);
    presence = markSeatResumed(presence);
    assert.equal(presence.phase, "present");
    assert.equal(presence.deadlineAt, null);

    presence = markChannelDrop(presence, t0);
    presence = tickSeatAbsence(presence, t0 + GRACE_MS);
    presence = markSeatResumed(presence);
    assert.equal(presence.phase, "present");
  });

  it("extend wait resets 5min from absent or timed_out without changing credential semantics", () => {
    const t0 = 1_000_000;
    let presence = markChannelDrop(createSeatAbsence("2"), t0);
    presence = tickSeatAbsence(presence, t0 + GRACE_MS);
    presence = tickSeatAbsence(presence, t0 + GRACE_MS + SOFT_TIMEOUT_MS);
    assert.equal(presence.phase, "timed_out");

    const t1 = t0 + GRACE_MS + SOFT_TIMEOUT_MS + 1_000;
    presence = extendAbsenceWait(presence, t1);
    assert.equal(presence.phase, "absent");
    assert.equal(presence.deadlineAt, t1 + SOFT_TIMEOUT_MS);
  });

  it("blocks advancement only when seat owes a decision and is absent or timed_out", () => {
    const t0 = 1_000_000;
    let presence = markChannelDrop(createSeatAbsence("2"), t0);
    assert.equal(seatBlocksAdvancement(presence, true), false);
    assert.equal(seatBlocksAdvancement(presence, false), false);

    presence = tickSeatAbsence(presence, t0 + GRACE_MS);
    assert.equal(seatBlocksAdvancement(presence, true), true);
    assert.equal(seatBlocksAdvancement(presence, false), false);

    presence = tickSeatAbsence(presence, t0 + GRACE_MS + SOFT_TIMEOUT_MS);
    assert.equal(seatBlocksAdvancement(presence, true), true);
  });
});
