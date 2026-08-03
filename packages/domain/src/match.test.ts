import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyCommand,
  createMatch,
  legalDecisionsFor,
  projectForSeat,
} from "./index.js";

const twoSeats = [
  { seatId: "seat-human", controller: "local_human" as const },
  { seatId: "seat-stub", controller: "stub_agent" as const },
];

describe("match domain — create and income", () => {
  it("creates an in-progress 2-seat match with 2-player starting coins", () => {
    const { state, events } = createMatch({
      matchId: "match-1",
      seed: "fixed-seed",
      seats: twoSeats,
    });

    assert.equal(state.status, "in_progress");
    assert.equal(state.stateVersion, 1);
    assert.equal(state.currentSeatId, "seat-human");
    assert.equal(state.phase, "await_action");
    assert.equal(state.seats[0]?.coins, 1);
    assert.equal(state.seats[1]?.coins, 2);
    assert.equal(state.seats[0]?.influences.length, 2);
    assert.equal(state.seats[1]?.influences.length, 2);
    assert.equal(state.courtDeck.length, 11);
    assert.ok(events.some((event) => event.type === "match_started"));
  });

  it("deals the same cards for the same seed", () => {
    const a = createMatch({
      matchId: "match-a",
      seed: "fixed-seed",
      seats: twoSeats,
    });
    const b = createMatch({
      matchId: "match-b",
      seed: "fixed-seed",
      seats: twoSeats,
    });

    assert.deepEqual(
      a.state.seats.map((seat) =>
        seat.influences.map((card) => card.character),
      ),
      b.state.seats.map((seat) =>
        seat.influences.map((card) => card.character),
      ),
    );
    assert.deepEqual(
      a.state.courtDeck.map((card) => card.character),
      b.state.courtDeck.map((card) => card.character),
    );
  });

  it("lets the current seat declare income for +1 coin and advances the turn", () => {
    const { state: initial } = createMatch({
      matchId: "match-1",
      seed: "fixed-seed",
      seats: twoSeats,
    });

    const result = applyCommand(initial, {
      type: "declare_action",
      expectedVersion: initial.stateVersion,
      seatId: "seat-human",
      action: { type: "income" },
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.state.stateVersion, initial.stateVersion + 1);
    assert.equal(result.state.seats[0]?.coins, 2);
    assert.equal(result.state.seats[1]?.coins, 2);
    assert.equal(result.state.currentSeatId, "seat-stub");
    assert.equal(result.state.phase, "await_action");
    assert.ok(
      result.events.some(
        (event) =>
          event.type === "action_resolved" &&
          event.actionType === "income" &&
          event.seatId === "seat-human",
      ),
    );
    assert.ok(
      result.events.some(
        (event) =>
          event.type === "turn_advanced" && event.seatId === "seat-stub",
      ),
    );
  });

  it("enumerates income as a legal decision while awaiting action", () => {
    const { state } = createMatch({
      matchId: "match-1",
      seed: "fixed-seed",
      seats: twoSeats,
    });

    const decisions = legalDecisionsFor(state, "seat-human");
    assert.deepEqual(decisions, [
      { type: "declare_action", action: { type: "income" } },
    ]);
    assert.deepEqual(legalDecisionsFor(state, "seat-stub"), []);
  });

  it("projects only the viewing seat's hidden characters", () => {
    const { state } = createMatch({
      matchId: "match-1",
      seed: "fixed-seed",
      seats: twoSeats,
    });

    const humanView = projectForSeat(state, "seat-human");
    const stubView = projectForSeat(state, "seat-stub");

    assert.deepEqual(
      humanView.hiddenCharacters,
      state.seats[0]?.influences.map((card) => card.character),
    );
    assert.deepEqual(
      stubView.hiddenCharacters,
      state.seats[1]?.influences.map((card) => card.character),
    );
    assert.equal(humanView.seats[1]?.influenceCount, 2);
    assert.deepEqual(humanView.seats[1]?.revealedCharacters, []);
  });
});
