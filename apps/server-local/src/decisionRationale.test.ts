import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveDecisionRationale,
  type DecisionRationaleEntry,
} from "./decisionRationale.js";

describe("resolveDecisionRationale", () => {
  it("prefers trimmed agent text and marks source as agent", () => {
    const result = resolveDecisionRationale(
      { type: "declare_action", action: { type: "income" } },
      "  先拿钱再说  ",
      { seatNames: {} },
    );
    assert.deepEqual(result, {
      text: "先拿钱再说",
      source: "agent",
    } satisfies DecisionRationaleEntry);
  });

  it("falls back to a template from the structured decision", () => {
    assert.deepEqual(
      resolveDecisionRationale(
        { type: "declare_action", action: { type: "tax" } },
        null,
        { seatNames: {} },
      ),
      { text: "选择声明征税", source: "template" },
    );
    assert.deepEqual(
      resolveDecisionRationale(
        {
          type: "declare_action",
          action: { type: "steal", targetSeatId: "seat-2" },
        },
        "   ",
        { seatNames: { "seat-2": "灰狐" } },
      ),
      { text: "选择声明偷窃 → 灰狐", source: "template" },
    );
    assert.deepEqual(
      resolveDecisionRationale(
        { type: "declare_block", claimedCharacter: "contessa" },
        undefined,
        { seatNames: {} },
      ),
      { text: "选择阻挡 · 伯爵夫人", source: "template" },
    );
    assert.deepEqual(
      resolveDecisionRationale({ type: "pass_challenge" }, null, {
        seatNames: {},
      }),
      { text: "选择放弃质疑", source: "template" },
    );
  });
});
