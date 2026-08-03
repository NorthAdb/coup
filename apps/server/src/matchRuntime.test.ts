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

  it("auto-passes stub block after the human declares foreign aid", () => {
    const started = startTwoSeatMatch({
      matchId: "match-fa-runtime",
      seed: "runtime-seed",
    });

    const result = submitHumanDecision(started, {
      protocolVersion: 1,
      requestId: "req-fa-1",
      stateVersion: started.state.stateVersion,
      decision: { type: "declare_action", action: { type: "foreign_aid" } },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const view = toSeatView(result.match, result.match.humanSeatId);
    assert.equal(view.publicState.seats[0]?.coins, 3);
    assert.equal(view.publicState.phase, "await_action");
    assert.equal(view.publicState.currentSeatId, "seat-human");
    assert.ok(
      view.projectedHistory.some(
        (event) =>
          event.type === "action_resolved" &&
          event.actionType === "foreign_aid" &&
          event.coinsGained === 2,
      ),
    );
    assert.ok(
      view.projectedHistory.some(
        (event) =>
          event.type === "action_resolved" && event.actionType === "income",
      ),
    );
  });

  it("can finish a match when the human assassinates twice and stub auto-plays", () => {
    let match = startTwoSeatMatch({
      matchId: "match-finish-runtime",
      seed: "runtime-seed",
    });

    function humanIncome() {
      const result = submitHumanDecision(match, {
        protocolVersion: 1,
        requestId: `req-income-${match.state.stateVersion}`,
        stateVersion: match.state.stateVersion,
        decision: { type: "declare_action", action: { type: "income" } },
      });
      assert.equal(result.ok, true);
      if (!result.ok) throw new Error("income failed");
      match = result.match;
    }

    function humanAssassinate() {
      const result = submitHumanDecision(match, {
        protocolVersion: 1,
        requestId: `req-assassinate-${match.state.stateVersion}`,
        stateVersion: match.state.stateVersion,
        decision: {
          type: "declare_action",
          action: { type: "assassinate", targetSeatId: "seat-stub" },
        },
      });
      assert.equal(result.ok, true);
      if (!result.ok) throw new Error("assassinate failed");
      match = result.match;
    }

    while (match.state.seats[0]!.coins < 3) {
      humanIncome();
    }
    humanAssassinate();
    assert.equal(
      match.state.seats[1]!.influences.filter((card) => !card.revealed).length,
      1,
    );

    while (
      match.state.status === "in_progress" &&
      match.state.seats[0]!.coins < 3
    ) {
      humanIncome();
    }
    if (match.state.status === "in_progress") {
      humanAssassinate();
    }

    const view = toSeatView(match, match.humanSeatId);
    assert.equal(view.publicState.status, "finished");
    assert.ok(
      view.projectedHistory.some(
        (event) =>
          event.type === "match_finished" &&
          event.winnerSeatId === "seat-human",
      ),
    );
  });
});
