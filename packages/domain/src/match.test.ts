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
    assert.ok(
      decisions.some(
        (decision) =>
          decision.type === "declare_action" &&
          decision.action.type === "income",
      ),
    );
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

describe("match domain — foreign aid and coup", () => {
  it("opens a clockwise block window after foreign aid is declared", () => {
    const { state: initial } = createMatch({
      matchId: "match-fa",
      seed: "fixed-seed",
      seats: twoSeats,
    });

    const declared = applyCommand(initial, {
      type: "declare_action",
      expectedVersion: initial.stateVersion,
      seatId: "seat-human",
      action: { type: "foreign_aid" },
    });
    assert.equal(declared.ok, true);
    if (!declared.ok) return;

    assert.equal(declared.state.phase, "await_block");
    assert.equal(declared.state.currentSeatId, "seat-human");
    assert.deepEqual(legalDecisionsFor(declared.state, "seat-human"), []);
    assert.deepEqual(legalDecisionsFor(declared.state, "seat-stub"), [
      { type: "pass_block" },
      {
        type: "declare_block",
        claimedCharacter: "duke",
      },
    ]);
    assert.ok(
      declared.events.some(
        (event) =>
          event.type === "action_declared" &&
          event.actionType === "foreign_aid" &&
          event.seatId === "seat-human",
      ),
    );
  });

  it("resolves foreign aid for +2 coins when every seat passes the block window", () => {
    const { state: initial } = createMatch({
      matchId: "match-fa-pass",
      seed: "fixed-seed",
      seats: twoSeats,
    });

    const declared = applyCommand(initial, {
      type: "declare_action",
      expectedVersion: initial.stateVersion,
      seatId: "seat-human",
      action: { type: "foreign_aid" },
    });
    assert.equal(declared.ok, true);
    if (!declared.ok) return;

    const passed = applyCommand(declared.state, {
      type: "pass_block",
      expectedVersion: declared.state.stateVersion,
      seatId: "seat-stub",
    });
    assert.equal(passed.ok, true);
    if (!passed.ok) return;

    assert.equal(passed.state.phase, "await_action");
    assert.equal(passed.state.seats[0]?.coins, 3);
    assert.equal(passed.state.currentSeatId, "seat-stub");
    assert.ok(
      passed.events.some(
        (event) =>
          event.type === "action_resolved" &&
          event.actionType === "foreign_aid" &&
          event.coinsGained === 2,
      ),
    );
  });

  it("forces coup as the only legal action at 10 or more coins", () => {
    const { state: initial } = createMatch({
      matchId: "match-forced-coup",
      seed: "fixed-seed",
      seats: twoSeats,
    });
    const rich: typeof initial = {
      ...initial,
      seats: initial.seats.map((seat, index) =>
        index === 0 ? { ...seat, coins: 10 } : seat,
      ),
    };

    assert.deepEqual(legalDecisionsFor(rich, "seat-human"), [
      {
        type: "declare_action",
        action: { type: "coup", targetSeatId: "seat-stub" },
      },
    ]);
  });

  it("pays 7 coins for a coup and asks the target to reveal influence", () => {
    const { state: initial } = createMatch({
      matchId: "match-coup",
      seed: "fixed-seed",
      seats: twoSeats,
    });
    const funded: typeof initial = {
      ...initial,
      seats: initial.seats.map((seat, index) =>
        index === 0 ? { ...seat, coins: 7 } : seat,
      ),
    };

    const declared = applyCommand(funded, {
      type: "declare_action",
      expectedVersion: funded.stateVersion,
      seatId: "seat-human",
      action: { type: "coup", targetSeatId: "seat-stub" },
    });
    assert.equal(declared.ok, true);
    if (!declared.ok) return;

    assert.equal(declared.state.seats[0]?.coins, 0);
    assert.equal(declared.state.phase, "await_influence_reveal");
    assert.equal(declared.state.revealSeatId, "seat-stub");
    const revealChoices = legalDecisionsFor(declared.state, "seat-stub");
    assert.equal(revealChoices.length, 2);
    assert.ok(
      revealChoices.every(
        (decision) => decision.type === "choose_influence_to_reveal",
      ),
    );

    const cardId =
      revealChoices[0]?.type === "choose_influence_to_reveal"
        ? revealChoices[0].cardId
        : "";
    const revealed = applyCommand(declared.state, {
      type: "choose_influence_to_reveal",
      expectedVersion: declared.state.stateVersion,
      seatId: "seat-stub",
      cardId,
    });
    assert.equal(revealed.ok, true);
    if (!revealed.ok) return;

    assert.equal(revealed.state.phase, "await_action");
    assert.equal(revealed.state.currentSeatId, "seat-stub");
    assert.equal(revealed.state.seats[1]?.influences.filter((c) => c.revealed).length, 1);
    assert.equal(revealed.state.seats[1]?.influences.filter((c) => !c.revealed).length, 1);
  });

  it("lets the first effective block win after earlier seats pass clockwise", () => {
    const threeSeats = [
      { seatId: "seat-a", controller: "local_human" as const },
      { seatId: "seat-b", controller: "stub_agent" as const },
      { seatId: "seat-c", controller: "stub_agent" as const },
    ];
    const { state: initial } = createMatch({
      matchId: "match-clockwise",
      seed: "fixed-seed",
      seats: threeSeats,
    });

    const declared = applyCommand(initial, {
      type: "declare_action",
      expectedVersion: initial.stateVersion,
      seatId: "seat-a",
      action: { type: "foreign_aid" },
    });
    assert.equal(declared.ok, true);
    if (!declared.ok) return;

    assert.deepEqual(
      legalDecisionsFor(declared.state, "seat-b").map((d) => d.type),
      ["pass_block", "declare_block"],
    );
    assert.deepEqual(legalDecisionsFor(declared.state, "seat-c"), []);

    const passed = applyCommand(declared.state, {
      type: "pass_block",
      expectedVersion: declared.state.stateVersion,
      seatId: "seat-b",
    });
    assert.equal(passed.ok, true);
    if (!passed.ok) return;

    assert.deepEqual(legalDecisionsFor(passed.state, "seat-b"), []);
    assert.ok(
      legalDecisionsFor(passed.state, "seat-c").some(
        (decision) => decision.type === "declare_block",
      ),
    );

    const blocked = applyCommand(passed.state, {
      type: "declare_block",
      expectedVersion: passed.state.stateVersion,
      seatId: "seat-c",
      claimedCharacter: "duke",
    });
    assert.equal(blocked.ok, true);
    if (!blocked.ok) return;

    assert.equal(blocked.state.phase, "await_block_challenge");
    assert.equal(blocked.state.pendingAction?.blockerSeatId, "seat-c");
    assert.deepEqual(legalDecisionsFor(blocked.state, "seat-a").map((d) => d.type), [
      "pass_challenge",
      "challenge_claim",
    ]);
    // seat-b is next after c clockwise? seats a,b,c — after c comes a, then b
    assert.deepEqual(legalDecisionsFor(blocked.state, "seat-b"), []);
  });

  it("fails foreign aid when a duke block survives unanswered challenges", () => {
    const { state: initial } = createMatch({
      matchId: "match-blocked",
      seed: "fixed-seed",
      seats: twoSeats,
    });

    const declared = applyCommand(initial, {
      type: "declare_action",
      expectedVersion: initial.stateVersion,
      seatId: "seat-human",
      action: { type: "foreign_aid" },
    });
    assert.equal(declared.ok, true);
    if (!declared.ok) return;

    const blocked = applyCommand(declared.state, {
      type: "declare_block",
      expectedVersion: declared.state.stateVersion,
      seatId: "seat-stub",
      claimedCharacter: "duke",
    });
    assert.equal(blocked.ok, true);
    if (!blocked.ok) return;

    const passed = applyCommand(blocked.state, {
      type: "pass_challenge",
      expectedVersion: blocked.state.stateVersion,
      seatId: "seat-human",
    });
    assert.equal(passed.ok, true);
    if (!passed.ok) return;

    assert.equal(passed.state.seats[0]?.coins, 1);
    assert.equal(passed.state.phase, "await_action");
    assert.equal(passed.state.currentSeatId, "seat-stub");
    assert.ok(
      passed.events.some(
        (event) =>
          event.type === "action_failed" &&
          event.actionType === "foreign_aid" &&
          event.reason === "blocked",
      ),
    );
  });

  it("resolves foreign aid after a false block is conceded without reopening the block window", () => {
    const { state: initial } = createMatch({
      matchId: "match-false-block",
      seed: "fixed-seed",
      seats: twoSeats,
    });

    const declared = applyCommand(initial, {
      type: "declare_action",
      expectedVersion: initial.stateVersion,
      seatId: "seat-human",
      action: { type: "foreign_aid" },
    });
    assert.equal(declared.ok, true);
    if (!declared.ok) return;

    const blocked = applyCommand(declared.state, {
      type: "declare_block",
      expectedVersion: declared.state.stateVersion,
      seatId: "seat-stub",
      claimedCharacter: "duke",
    });
    assert.equal(blocked.ok, true);
    if (!blocked.ok) return;

    const challenged = applyCommand(blocked.state, {
      type: "challenge_claim",
      expectedVersion: blocked.state.stateVersion,
      seatId: "seat-human",
    });
    assert.equal(challenged.ok, true);
    if (!challenged.ok) return;

    assert.equal(challenged.state.phase, "await_claim_defense");
    assert.deepEqual(legalDecisionsFor(challenged.state, "seat-human"), []);

    const conceded = applyCommand(challenged.state, {
      type: "concede_claim",
      expectedVersion: challenged.state.stateVersion,
      seatId: "seat-stub",
    });
    assert.equal(conceded.ok, true);
    if (!conceded.ok) return;
    assert.ok(
      conceded.events.some((event) => event.type === "claim_conceded"),
    );

    assert.equal(conceded.state.phase, "await_influence_reveal");
    const reveal = legalDecisionsFor(conceded.state, "seat-stub")[0];
    assert.equal(reveal?.type, "choose_influence_to_reveal");
    if (reveal?.type !== "choose_influence_to_reveal") return;

    const revealed = applyCommand(conceded.state, {
      type: "choose_influence_to_reveal",
      expectedVersion: conceded.state.stateVersion,
      seatId: "seat-stub",
      cardId: reveal.cardId,
    });
    assert.equal(revealed.ok, true);
    if (!revealed.ok) return;

    assert.equal(revealed.state.phase, "await_action");
    assert.equal(revealed.state.seats[0]?.coins, 3);
    assert.equal(revealed.state.responseQueue.length, 0);
    assert.ok(
      revealed.events.some(
        (event) =>
          event.type === "action_resolved" &&
          event.actionType === "foreign_aid" &&
          event.coinsGained === 2,
      ),
    );
  });
});
