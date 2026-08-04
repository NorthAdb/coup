import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  actionDraftSummary,
  actionDraftToDecision,
  canConfirmActionDraft,
  type ActionDraft,
} from "./actionDraft.ts";

const seats = [
  { seatId: "seat-1", displayName: "你" },
  { seatId: "seat-2", displayName: "灰狐" },
] as const;

describe("canConfirmActionDraft", () => {
  it("allows untargeted drafts immediately", () => {
    const draft: ActionDraft = { kind: "untargeted", actionType: "exchange" };
    assert.equal(canConfirmActionDraft(draft), true);
  });

  it("requires a target for targeted drafts", () => {
    assert.equal(
      canConfirmActionDraft({
        kind: "targeted",
        actionType: "steal",
        targetSeatId: null,
      }),
      false,
    );
    assert.equal(
      canConfirmActionDraft({
        kind: "targeted",
        actionType: "steal",
        targetSeatId: "seat-2",
      }),
      true,
    );
  });
});

describe("actionDraftSummary", () => {
  it("summarizes untargeted and targeted drafts for the confirmation bar", () => {
    assert.equal(
      actionDraftSummary(
        { kind: "untargeted", actionType: "exchange" },
        seats,
      ),
      "交换影响力",
    );
    assert.equal(
      actionDraftSummary(
        {
          kind: "targeted",
          actionType: "assassinate",
          targetSeatId: null,
        },
        seats,
      ),
      "刺杀 · 选择目标",
    );
    assert.equal(
      actionDraftSummary(
        {
          kind: "targeted",
          actionType: "assassinate",
          targetSeatId: "seat-2",
        },
        seats,
      ),
      "刺杀 灰狐",
    );
  });
});

describe("actionDraftToDecision", () => {
  it("builds a declare_action seat decision when the draft is complete", () => {
    assert.deepEqual(
      actionDraftToDecision({ kind: "untargeted", actionType: "tax" }),
      { type: "declare_action", action: { type: "tax" } },
    );
    assert.deepEqual(
      actionDraftToDecision({
        kind: "targeted",
        actionType: "coup",
        targetSeatId: "seat-2",
      }),
      {
        type: "declare_action",
        action: { type: "coup", targetSeatId: "seat-2" },
      },
    );
    assert.equal(
      actionDraftToDecision({
        kind: "targeted",
        actionType: "coup",
        targetSeatId: null,
      }),
      null,
    );
  });
});
