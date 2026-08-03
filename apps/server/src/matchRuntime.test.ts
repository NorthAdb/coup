import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  startTwoSeatMatch,
  submitHumanDecision,
  toSeatView,
} from "./matchRuntime.js";

describe("stub match runtime", () => {
  it("auto-plays stub income after the human declares income", () => {
    const started = startTwoSeatMatch({
      matchId: "match-runtime",
      seed: "runtime-seed",
    });
    const before = toSeatView(started, started.humanSeatId);
    assert.equal(before.publicState.seats[0]?.coins, 1);
    assert.equal(before.publicState.seats[1]?.coins, 2);
    assert.equal(before.publicState.currentSeatId, "seat-human");
    assert.ok(
      before.legalDecisions.some(
        (decision) =>
          decision.type === "declare_action" &&
          decision.action.type === "income",
      ),
    );

    const result = submitHumanDecision(started, {
      protocolVersion: 1,
      requestId: "req-human-1",
      stateVersion: started.state.stateVersion,
      decision: { type: "declare_action", action: { type: "income" } },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const view = toSeatView(result.match, result.match.humanSeatId);
    assert.equal(view.publicState.seats[0]?.coins, 2);
    assert.equal(view.publicState.seats[1]?.coins, 3);
    assert.equal(view.publicState.currentSeatId, "seat-human");
    assert.ok(
      view.projectedHistory.filter(
        (event) =>
          event.type === "action_resolved" && event.actionType === "income",
      ).length >= 2,
    );
  });
});
