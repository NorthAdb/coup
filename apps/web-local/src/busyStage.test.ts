import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { busyStageOverride } from "./busyStage.ts";

describe("busyStageOverride", () => {
  it("replaces a stale your-turn stage while agent seats are blocking", () => {
    const override = busyStageOverride({
      busy: true,
      agentPhase: "retrying",
      seats: [
        { seatId: "seat-2", displayName: "灰狐" },
        { seatId: "seat-3", displayName: "白塔" },
      ],
    });
    assert.ok(override);
    assert.equal(override.eyebrow, "等待其他座位");
    assert.deepEqual(override.titleParts, [
      { type: "seat", seatId: "seat-2", text: "灰狐" },
      { type: "text", text: "、" },
      { type: "seat", seatId: "seat-3", text: "白塔" },
      { type: "text", text: " 正在重试…" },
    ]);
    assert.match(override.text, /正在决策/);
  });

  it("does not override when the desk is not busy", () => {
    assert.equal(
      busyStageOverride({
        busy: false,
        agentPhase: "retrying",
        seats: [{ seatId: "seat-2", displayName: "灰狐" }],
      }),
      null,
    );
  });
});
