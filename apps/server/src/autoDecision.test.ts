import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMatch } from "@coup/domain";
import { planAutoDecision } from "./autoDecision.js";
import type { ActiveMatch } from "./matchRuntime.js";

function matchWithTwoSeats(): ActiveMatch {
  const created = createMatch({
    matchId: "match-test",
    seed: "seed-test",
    seats: [
      { seatId: "1", controller: "local_human" },
      { seatId: "2", controller: "remote_human" },
    ],
  });
  return {
    state: created.state,
    events: created.events,
    humanSeatId: "1",
    displayNames: { "1": "你", "2": "Alice" },
  };
}

describe("planAutoDecision", () => {
  it("prefers income during the action phase", () => {
    const match = matchWithTwoSeats();
    const plan = planAutoDecision(match.state, "1");
    assert.notEqual(plan, null);
    assert.equal(plan?.decision.type, "declare_action");
    assert.ok(plan?.decision.type === "declare_action");
    assert.equal(plan?.decision.action.type, "income");
    assert.equal(plan?.kind, "income");
  });

  it("returns null for a seat with no pending decision context", () => {
    const match = matchWithTwoSeats();
    // 2 号座当前不欠决策：projectForSeat 不抛错但没有合法决策集合时返回 null。
    const plan = planAutoDecision(match.state, "2");
    assert.equal(plan, null);
  });
});
