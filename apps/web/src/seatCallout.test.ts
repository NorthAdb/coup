import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  seatCalloutFromEvent,
  seatCalloutsFromEvents,
} from "./matchCopy.ts";

const seats = [
  {
    seatId: "seat-1",
    displayName: "你",
  },
  {
    seatId: "seat-2",
    displayName: "灰狐",
  },
] as const;

describe("seatCalloutFromEvent", () => {
  it("builds public-decision callouts without seat names or private info", () => {
    assert.deepEqual(
      seatCalloutFromEvent(
        { type: "action_declared", seatId: "seat-1", actionType: "income" },
        seats,
      ),
      { seatId: "seat-1", text: "声明收入" },
    );
    assert.deepEqual(
      seatCalloutFromEvent(
        {
          type: "action_declared",
          seatId: "seat-1",
          actionType: "assassinate",
          targetSeatId: "seat-2",
        },
        seats,
      ),
      { seatId: "seat-1", text: "声明刺杀 → 灰狐" },
    );
    assert.deepEqual(
      seatCalloutFromEvent(
        {
          type: "challenge_declared",
          seatId: "seat-2",
          againstSeatId: "seat-1",
        },
        seats,
      ),
      { seatId: "seat-2", text: "质疑 你" },
    );
    assert.deepEqual(
      seatCalloutFromEvent(
        {
          type: "block_declared",
          seatId: "seat-2",
          claimedCharacter: "duke",
        },
        seats,
      ),
      { seatId: "seat-2", text: "阻挡 · 公爵" },
    );
    assert.deepEqual(
      seatCalloutFromEvent(
        {
          type: "response_passed",
          seatId: "seat-2",
          responseType: "challenge",
        },
        seats,
      ),
      { seatId: "seat-2", text: "放弃质疑" },
    );
    assert.deepEqual(
      seatCalloutFromEvent(
        { type: "claim_proven", seatId: "seat-1", character: "captain" },
        seats,
      ),
      { seatId: "seat-1", text: "证明队长" },
    );
    assert.deepEqual(
      seatCalloutFromEvent({ type: "claim_conceded", seatId: "seat-1" }, seats),
      { seatId: "seat-1", text: "放弃证明" },
    );
    assert.deepEqual(
      seatCalloutFromEvent(
        {
          type: "influence_revealed",
          seatId: "seat-2",
          character: "contessa",
        },
        seats,
      ),
      { seatId: "seat-2", text: "揭示伯爵夫人" },
    );
    assert.deepEqual(
      seatCalloutFromEvent(
        {
          type: "action_resolved",
          seatId: "seat-1",
          actionType: "exchange",
        },
        seats,
      ),
      { seatId: "seat-1", text: "完成交换" },
    );
  });

  it("ignores non-decision bookkeeping events", () => {
    assert.equal(
      seatCalloutFromEvent(
        {
          type: "match_started",
          matchId: "m",
          seatIds: ["seat-1"],
          currentSeatId: "seat-1",
        },
        seats,
      ),
      null,
    );
    assert.equal(
      seatCalloutFromEvent({ type: "turn_advanced", seatId: "seat-1" }, seats),
      null,
    );
  });
});

describe("seatCalloutsFromEvents", () => {
  it("later callouts for the same seat replace earlier ones", () => {
    const map = seatCalloutsFromEvents(
      [
        {
          type: "action_declared",
          seatId: "seat-1",
          actionType: "tax",
        },
        {
          type: "challenge_declared",
          seatId: "seat-2",
          againstSeatId: "seat-1",
        },
        {
          type: "claim_proven",
          seatId: "seat-1",
          character: "duke",
        },
      ],
      seats,
    );
    assert.deepEqual(map, {
      "seat-1": "证明公爵",
      "seat-2": "质疑 你",
    });
  });
});
