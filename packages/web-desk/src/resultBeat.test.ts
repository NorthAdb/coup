import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  beatWeightForEvent,
  buildResultBeatSteps,
  challengeCalloutBeatHoldMs,
  heavyBeatHoldMs,
  isChallengeCalloutEvent,
  lightBeatHoldMs,
  stageBeatFromEvent,
} from "./resultBeat.js";

const seats = [
  { seatId: "seat-1", displayName: "你" },
  { seatId: "seat-2", displayName: "灰狐" },
] as const;

describe("beatWeightForEvent", () => {
  it("marks consequential outcomes as heavy", () => {
    assert.equal(
      beatWeightForEvent({
        type: "action_failed",
        seatId: "seat-1",
        actionType: "tax",
        reason: "challenged",
      }),
      "heavy",
    );
    assert.equal(
      beatWeightForEvent({
        type: "claim_proven",
        seatId: "seat-2",
        character: "duke",
      }),
      "heavy",
    );
    assert.equal(
      beatWeightForEvent({
        type: "influence_revealed",
        seatId: "seat-2",
        character: "assassin",
      }),
      "heavy",
    );
  });

  it("keeps routine public moves light and bookkeeping skipped", () => {
    assert.equal(
      beatWeightForEvent({
        type: "action_declared",
        seatId: "seat-2",
        actionType: "income",
      }),
      "light",
    );
    assert.equal(
      beatWeightForEvent({ type: "turn_advanced", seatId: "seat-2" }),
      "skip",
    );
  });
});

describe("stageBeatFromEvent", () => {
  it("builds a just-happened stage caption without requiring the log", () => {
    const beat = stageBeatFromEvent(
      {
        type: "action_failed",
        seatId: "seat-1",
        actionType: "tax",
        reason: "challenged",
      },
      seats,
    );
    assert.equal(beat?.eyebrow, "刚才发生");
    assert.equal(beat?.title, "你 的征税被质疑推翻");
  });
});

describe("buildResultBeatSteps", () => {
  it("drops skip events and keeps heavy then light order", () => {
    const steps = buildResultBeatSteps(
      [
        {
          type: "action_failed",
          seatId: "seat-1",
          actionType: "tax",
          reason: "challenged",
        },
        { type: "turn_advanced", seatId: "seat-2" },
        {
          type: "action_declared",
          seatId: "seat-2",
          actionType: "income",
        },
      ],
      seats,
    );
    assert.equal(steps.length, 2);
    assert.equal(steps[0]?.weight, "heavy");
    assert.equal(steps[1]?.weight, "light");
    assert.equal(steps[1]?.callout?.text, "声明收入");
  });
});

describe("result beat holds", () => {
  it("uses ~1.6–2.2s heavy and shorter light on balanced pace", () => {
    const heavy = heavyBeatHoldMs("balanced", false);
    const light = lightBeatHoldMs("balanced", false);
    assert.ok(heavy >= 1600 && heavy <= 2200);
    assert.ok(light >= 400 && light <= 700);
    assert.ok(light < heavy);
  });

  it("shortens on fast pace but keeps readable reduced-motion holds", () => {
    assert.ok(heavyBeatHoldMs("fast", false) < heavyBeatHoldMs("balanced", false));
    assert.ok(heavyBeatHoldMs("balanced", true) >= 1000);
    assert.ok(lightBeatHoldMs("balanced", true) >= 300);
  });

  it("holds challenge and pass-challenge seat bubbles ~3s on balanced pace", () => {
    assert.equal(challengeCalloutBeatHoldMs("balanced", false), 3000);
    assert.equal(
      isChallengeCalloutEvent({
        type: "challenge_declared",
        seatId: "seat-2",
        againstSeatId: "seat-1",
      }),
      true,
    );
    assert.equal(
      isChallengeCalloutEvent({
        type: "response_passed",
        seatId: "seat-2",
        responseType: "challenge",
      }),
      true,
    );
    assert.equal(
      isChallengeCalloutEvent({
        type: "response_passed",
        seatId: "seat-2",
        responseType: "block",
      }),
      false,
    );
  });
});
