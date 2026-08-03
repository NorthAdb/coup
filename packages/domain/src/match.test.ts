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

describe("match domain — role actions", () => {
  it("opens an action-challenge window after tax and resolves +3 when all pass", () => {
    const { state: initial } = createMatch({
      matchId: "match-tax",
      seed: "fixed-seed",
      seats: twoSeats,
    });

    const declared = applyCommand(initial, {
      type: "declare_action",
      expectedVersion: initial.stateVersion,
      seatId: "seat-human",
      action: { type: "tax" },
    });
    assert.equal(declared.ok, true);
    if (!declared.ok) return;

    assert.equal(declared.state.phase, "await_action_challenge");
    assert.deepEqual(legalDecisionsFor(declared.state, "seat-stub").map((d) => d.type), [
      "pass_challenge",
      "challenge_claim",
    ]);

    const passed = applyCommand(declared.state, {
      type: "pass_challenge",
      expectedVersion: declared.state.stateVersion,
      seatId: "seat-stub",
    });
    assert.equal(passed.ok, true);
    if (!passed.ok) return;

    assert.equal(passed.state.seats[0]?.coins, 4);
    assert.equal(passed.state.phase, "await_action");
    assert.equal(passed.state.currentSeatId, "seat-stub");
    assert.ok(
      passed.events.some(
        (event) =>
          event.type === "action_resolved" &&
          event.actionType === "tax" &&
          event.coinsGained === 3,
      ),
    );
  });

  it("refunds assassinate fee when the assassin claim is successfully challenged", () => {
    const { state: initial } = createMatch({
      matchId: "match-assassinate-refund",
      seed: "fixed-seed",
      seats: twoSeats,
    });
    const funded = {
      ...initial,
      seats: initial.seats.map((seat, index) =>
        index === 0
          ? {
              ...seat,
              coins: 3,
              influences: seat.influences.map((card, cardIndex) =>
                cardIndex === 0
                  ? { ...card, character: "duke" as const }
                  : { ...card, character: "contessa" as const },
              ),
            }
          : seat,
      ),
    };

    const declared = applyCommand(funded, {
      type: "declare_action",
      expectedVersion: funded.stateVersion,
      seatId: "seat-human",
      action: { type: "assassinate", targetSeatId: "seat-stub" },
    });
    assert.equal(declared.ok, true);
    if (!declared.ok) return;
    assert.equal(declared.state.seats[0]?.coins, 0);
    assert.equal(declared.state.phase, "await_action_challenge");

    const challenged = applyCommand(declared.state, {
      type: "challenge_claim",
      expectedVersion: declared.state.stateVersion,
      seatId: "seat-stub",
    });
    assert.equal(challenged.ok, true);
    if (!challenged.ok) return;

    const conceded = applyCommand(challenged.state, {
      type: "concede_claim",
      expectedVersion: challenged.state.stateVersion,
      seatId: "seat-human",
    });
    assert.equal(conceded.ok, true);
    if (!conceded.ok) return;

    const reveal = legalDecisionsFor(conceded.state, "seat-human")[0];
    assert.equal(reveal?.type, "choose_influence_to_reveal");
    if (reveal?.type !== "choose_influence_to_reveal") return;

    const revealed = applyCommand(conceded.state, {
      type: "choose_influence_to_reveal",
      expectedVersion: conceded.state.stateVersion,
      seatId: "seat-human",
      cardId: reveal.cardId,
    });
    assert.equal(revealed.ok, true);
    if (!revealed.ok) return;

    assert.equal(revealed.state.seats[0]?.coins, 3);
    assert.ok(
      revealed.events.some(
        (event) =>
          event.type === "action_failed" &&
          event.actionType === "assassinate" &&
          event.reason === "challenged",
      ),
    );
  });

  it("keeps the assassinate fee when a contessa block succeeds", () => {
    const { state: initial } = createMatch({
      matchId: "match-assassinate-block",
      seed: "fixed-seed",
      seats: twoSeats,
    });
    const funded = {
      ...initial,
      seats: initial.seats.map((seat, index) =>
        index === 0 ? { ...seat, coins: 3 } : seat,
      ),
    };

    const declared = applyCommand(funded, {
      type: "declare_action",
      expectedVersion: funded.stateVersion,
      seatId: "seat-human",
      action: { type: "assassinate", targetSeatId: "seat-stub" },
    });
    assert.equal(declared.ok, true);
    if (!declared.ok) return;

    const passedChallenge = applyCommand(declared.state, {
      type: "pass_challenge",
      expectedVersion: declared.state.stateVersion,
      seatId: "seat-stub",
    });
    assert.equal(passedChallenge.ok, true);
    if (!passedChallenge.ok) return;
    assert.equal(passedChallenge.state.phase, "await_block");
    assert.deepEqual(
      legalDecisionsFor(passedChallenge.state, "seat-stub").map((d) =>
        d.type === "declare_block" ? d.claimedCharacter : d.type,
      ),
      ["pass_block", "contessa"],
    );

    const blocked = applyCommand(passedChallenge.state, {
      type: "declare_block",
      expectedVersion: passedChallenge.state.stateVersion,
      seatId: "seat-stub",
      claimedCharacter: "contessa",
    });
    assert.equal(blocked.ok, true);
    if (!blocked.ok) return;

    const passedBlockChallenge = applyCommand(blocked.state, {
      type: "pass_challenge",
      expectedVersion: blocked.state.stateVersion,
      seatId: "seat-human",
    });
    assert.equal(passedBlockChallenge.ok, true);
    if (!passedBlockChallenge.ok) return;

    assert.equal(passedBlockChallenge.state.seats[0]?.coins, 0);
    assert.ok(
      passedBlockChallenge.events.some(
        (event) =>
          event.type === "action_failed" &&
          event.actionType === "assassinate" &&
          event.reason === "blocked",
      ),
    );
  });

  it("steals up to 2 coins after the action challenge and block windows pass", () => {
    const { state: initial } = createMatch({
      matchId: "match-steal",
      seed: "fixed-seed",
      seats: twoSeats,
    });
    const ready = {
      ...initial,
      seats: initial.seats.map((seat, index) =>
        index === 1 ? { ...seat, coins: 2 } : seat,
      ),
    };

    const declared = applyCommand(ready, {
      type: "declare_action",
      expectedVersion: ready.stateVersion,
      seatId: "seat-human",
      action: { type: "steal", targetSeatId: "seat-stub" },
    });
    assert.equal(declared.ok, true);
    if (!declared.ok) return;

    const passedAction = applyCommand(declared.state, {
      type: "pass_challenge",
      expectedVersion: declared.state.stateVersion,
      seatId: "seat-stub",
    });
    assert.equal(passedAction.ok, true);
    if (!passedAction.ok) return;
    assert.equal(passedAction.state.phase, "await_block");

    const passedBlock = applyCommand(passedAction.state, {
      type: "pass_block",
      expectedVersion: passedAction.state.stateVersion,
      seatId: "seat-stub",
    });
    assert.equal(passedBlock.ok, true);
    if (!passedBlock.ok) return;

    assert.equal(passedBlock.state.seats[0]?.coins, 3);
    assert.equal(passedBlock.state.seats[1]?.coins, 0);
    assert.ok(
      passedBlock.events.some(
        (event) =>
          event.type === "action_resolved" &&
          event.actionType === "steal" &&
          event.coinsStolen === 2,
      ),
    );
  });

  it("lets exchange keep secrecy by resolving without publishing kept card ids", () => {
    const { state: initial } = createMatch({
      matchId: "match-exchange",
      seed: "fixed-seed",
      seats: twoSeats,
    });

    const declared = applyCommand(initial, {
      type: "declare_action",
      expectedVersion: initial.stateVersion,
      seatId: "seat-human",
      action: { type: "exchange" },
    });
    assert.equal(declared.ok, true);
    if (!declared.ok) return;

    const passed = applyCommand(declared.state, {
      type: "pass_challenge",
      expectedVersion: declared.state.stateVersion,
      seatId: "seat-stub",
    });
    assert.equal(passed.ok, true);
    if (!passed.ok) return;
    assert.equal(passed.state.phase, "await_exchange_selection");

    const humanView = projectForSeat(passed.state, "seat-human");
    const stubView = projectForSeat(passed.state, "seat-stub");
    assert.equal(humanView.exchangeHand?.length, 4);
    assert.equal(stubView.exchangeHand, null);

    const choice = legalDecisionsFor(passed.state, "seat-human")[0];
    assert.equal(choice?.type, "choose_exchange_cards");
    if (choice?.type !== "choose_exchange_cards") return;

    const returned = applyCommand(passed.state, {
      type: "choose_exchange_cards",
      expectedVersion: passed.state.stateVersion,
      seatId: "seat-human",
      returnCardIds: choice.returnCardIds,
    });
    assert.equal(returned.ok, true);
    if (!returned.ok) return;

    assert.equal(returned.state.phase, "await_action");
    assert.equal(returned.state.currentSeatId, "seat-stub");
    assert.equal(
      returned.state.seats[0]?.influences.filter((card) => !card.revealed).length,
      2,
    );
    assert.equal(returned.state.courtDeck.length, 11);
    assert.ok(
      returned.events.some(
        (event) =>
          event.type === "action_resolved" && event.actionType === "exchange",
      ),
    );
    assert.ok(
      returned.events.every(
        (event) =>
          event.type !== "action_resolved" ||
          event.actionType !== "exchange" ||
          !("returnCardIds" in event),
      ),
    );
  });

  it("proves a tax claim then makes the challenger reveal influence", () => {
    const { state: initial } = createMatch({
      matchId: "match-tax-prove",
      seed: "fixed-seed",
      seats: twoSeats,
    });
    const withDuke = {
      ...initial,
      seats: initial.seats.map((seat, index) =>
        index === 0
          ? {
              ...seat,
              influences: [
                { ...seat.influences[0]!, character: "duke" as const },
                seat.influences[1]!,
              ],
            }
          : seat,
      ),
    };

    const declared = applyCommand(withDuke, {
      type: "declare_action",
      expectedVersion: withDuke.stateVersion,
      seatId: "seat-human",
      action: { type: "tax" },
    });
    assert.equal(declared.ok, true);
    if (!declared.ok) return;

    const challenged = applyCommand(declared.state, {
      type: "challenge_claim",
      expectedVersion: declared.state.stateVersion,
      seatId: "seat-stub",
    });
    assert.equal(challenged.ok, true);
    if (!challenged.ok) return;

    const dukeCard = challenged.state.seats[0]!.influences.find(
      (card) => !card.revealed && card.character === "duke",
    );
    assert.ok(dukeCard);

    const proven = applyCommand(challenged.state, {
      type: "prove_claim",
      expectedVersion: challenged.state.stateVersion,
      seatId: "seat-human",
      cardId: dukeCard!.cardId,
    });
    assert.equal(proven.ok, true);
    if (!proven.ok) return;
    assert.ok(proven.events.some((event) => event.type === "claim_proven"));
    assert.equal(proven.state.phase, "await_influence_reveal");
    assert.equal(proven.state.revealSeatId, "seat-stub");

    const reveal = legalDecisionsFor(proven.state, "seat-stub")[0];
    assert.equal(reveal?.type, "choose_influence_to_reveal");
    if (reveal?.type !== "choose_influence_to_reveal") return;

    const revealed = applyCommand(proven.state, {
      type: "choose_influence_to_reveal",
      expectedVersion: proven.state.stateVersion,
      seatId: "seat-stub",
      cardId: reveal.cardId,
    });
    assert.equal(revealed.ok, true);
    if (!revealed.ok) return;

    assert.equal(revealed.state.seats[0]?.coins, 4);
    assert.equal(
      revealed.state.seats[1]?.influences.filter((card) => card.revealed).length,
      1,
    );
  });

  it("can remove two influences in one assassinate when the target loses a challenge then the hit", () => {
    const { state: initial } = createMatch({
      matchId: "match-double-loss",
      seed: "fixed-seed",
      seats: twoSeats,
    });
    const setup = {
      ...initial,
      seats: initial.seats.map((seat, index) =>
        index === 0
          ? {
              ...seat,
              coins: 3,
              influences: [
                { ...seat.influences[0]!, character: "assassin" as const },
                seat.influences[1]!,
              ],
            }
          : seat,
      ),
    };

    const declared = applyCommand(setup, {
      type: "declare_action",
      expectedVersion: setup.stateVersion,
      seatId: "seat-human",
      action: { type: "assassinate", targetSeatId: "seat-stub" },
    });
    assert.equal(declared.ok, true);
    if (!declared.ok) return;

    const challenged = applyCommand(declared.state, {
      type: "challenge_claim",
      expectedVersion: declared.state.stateVersion,
      seatId: "seat-stub",
    });
    assert.equal(challenged.ok, true);
    if (!challenged.ok) return;

    const assassinCard = challenged.state.seats[0]!.influences.find(
      (card) => !card.revealed && card.character === "assassin",
    );
    assert.ok(assassinCard);

    const proven = applyCommand(challenged.state, {
      type: "prove_claim",
      expectedVersion: challenged.state.stateVersion,
      seatId: "seat-human",
      cardId: assassinCard!.cardId,
    });
    assert.equal(proven.ok, true);
    if (!proven.ok) return;

    const firstReveal = legalDecisionsFor(proven.state, "seat-stub")[0];
    assert.equal(firstReveal?.type, "choose_influence_to_reveal");
    if (firstReveal?.type !== "choose_influence_to_reveal") return;

    const afterChallengeLoss = applyCommand(proven.state, {
      type: "choose_influence_to_reveal",
      expectedVersion: proven.state.stateVersion,
      seatId: "seat-stub",
      cardId: firstReveal.cardId,
    });
    assert.equal(afterChallengeLoss.ok, true);
    if (!afterChallengeLoss.ok) return;
    assert.equal(afterChallengeLoss.state.phase, "await_block");

    const passedBlock = applyCommand(afterChallengeLoss.state, {
      type: "pass_block",
      expectedVersion: afterChallengeLoss.state.stateVersion,
      seatId: "seat-stub",
    });
    assert.equal(passedBlock.ok, true);
    if (!passedBlock.ok) return;
    assert.equal(passedBlock.state.phase, "await_influence_reveal");

    const secondReveal = legalDecisionsFor(passedBlock.state, "seat-stub")[0];
    assert.equal(secondReveal?.type, "choose_influence_to_reveal");
    if (secondReveal?.type !== "choose_influence_to_reveal") return;

    const finished = applyCommand(passedBlock.state, {
      type: "choose_influence_to_reveal",
      expectedVersion: passedBlock.state.stateVersion,
      seatId: "seat-stub",
      cardId: secondReveal.cardId,
    });
    assert.equal(finished.ok, true);
    if (!finished.ok) return;

    assert.equal(finished.state.status, "finished");
    assert.equal(finished.state.winnerSeatId, "seat-human");
    assert.equal(finished.state.seats[1]?.eliminated, true);
    assert.equal(finished.state.seats[1]?.coins, 0);
  });

  it("does not refund assassinate coins onto an eliminated actor seat", () => {
    const { state: initial } = createMatch({
      matchId: "match-no-refund-dead",
      seed: "fixed-seed",
      seats: twoSeats,
    });
    const setup = {
      ...initial,
      seats: initial.seats.map((seat, index) =>
        index === 0
          ? {
              ...seat,
              coins: 3,
              influences: [
                {
                  ...seat.influences[0]!,
                  character: "duke" as const,
                  revealed: true,
                },
                { ...seat.influences[1]!, character: "contessa" as const },
              ],
            }
          : seat,
      ),
    };

    const declared = applyCommand(setup, {
      type: "declare_action",
      expectedVersion: setup.stateVersion,
      seatId: "seat-human",
      action: { type: "assassinate", targetSeatId: "seat-stub" },
    });
    assert.equal(declared.ok, true);
    if (!declared.ok) return;

    const challenged = applyCommand(declared.state, {
      type: "challenge_claim",
      expectedVersion: declared.state.stateVersion,
      seatId: "seat-stub",
    });
    assert.equal(challenged.ok, true);
    if (!challenged.ok) return;

    const conceded = applyCommand(challenged.state, {
      type: "concede_claim",
      expectedVersion: challenged.state.stateVersion,
      seatId: "seat-human",
    });
    assert.equal(conceded.ok, true);
    if (!conceded.ok) return;

    const reveal = legalDecisionsFor(conceded.state, "seat-human")[0];
    assert.equal(reveal?.type, "choose_influence_to_reveal");
    if (reveal?.type !== "choose_influence_to_reveal") return;

    const revealed = applyCommand(conceded.state, {
      type: "choose_influence_to_reveal",
      expectedVersion: conceded.state.stateVersion,
      seatId: "seat-human",
      cardId: reveal.cardId,
    });
    assert.equal(revealed.ok, true);
    if (!revealed.ok) return;

    assert.equal(revealed.state.status, "finished");
    assert.equal(revealed.state.winnerSeatId, "seat-stub");
    assert.equal(revealed.state.seats[0]?.eliminated, true);
    assert.equal(revealed.state.seats[0]?.coins, 0);
  });

  it("does not reopen the block window after a false steal block is conceded", () => {
    const { state: initial } = createMatch({
      matchId: "match-steal-false-block",
      seed: "fixed-seed",
      seats: twoSeats,
    });

    const declared = applyCommand(initial, {
      type: "declare_action",
      expectedVersion: initial.stateVersion,
      seatId: "seat-human",
      action: { type: "steal", targetSeatId: "seat-stub" },
    });
    assert.equal(declared.ok, true);
    if (!declared.ok) return;

    const passedAction = applyCommand(declared.state, {
      type: "pass_challenge",
      expectedVersion: declared.state.stateVersion,
      seatId: "seat-stub",
    });
    assert.equal(passedAction.ok, true);
    if (!passedAction.ok) return;

    const blocked = applyCommand(passedAction.state, {
      type: "declare_block",
      expectedVersion: passedAction.state.stateVersion,
      seatId: "seat-stub",
      claimedCharacter: "captain",
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

    const conceded = applyCommand(challenged.state, {
      type: "concede_claim",
      expectedVersion: challenged.state.stateVersion,
      seatId: "seat-stub",
    });
    assert.equal(conceded.ok, true);
    if (!conceded.ok) return;

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
    assert.equal(revealed.state.responseQueue.length, 0);
    assert.equal(revealed.state.seats[0]?.coins, 3);
    assert.equal(revealed.state.seats[1]?.coins, 0);
    assert.ok(
      revealed.events.some(
        (event) =>
          event.type === "action_resolved" &&
          event.actionType === "steal" &&
          event.coinsStolen === 2,
      ),
    );
  });

  it("finishes the match when only one living seat remains after a coup", () => {
    const { state: initial } = createMatch({
      matchId: "match-finish",
      seed: "fixed-seed",
      seats: twoSeats,
    });
    const almostDone = {
      ...initial,
      seats: initial.seats.map((seat, index) =>
        index === 0
          ? { ...seat, coins: 7 }
          : {
              ...seat,
              influences: [
                { ...seat.influences[0]!, revealed: true },
                seat.influences[1]!,
              ],
            },
      ),
    };

    const declared = applyCommand(almostDone, {
      type: "declare_action",
      expectedVersion: almostDone.stateVersion,
      seatId: "seat-human",
      action: { type: "coup", targetSeatId: "seat-stub" },
    });
    assert.equal(declared.ok, true);
    if (!declared.ok) return;

    const reveal = legalDecisionsFor(declared.state, "seat-stub")[0];
    assert.equal(reveal?.type, "choose_influence_to_reveal");
    if (reveal?.type !== "choose_influence_to_reveal") return;

    const revealed = applyCommand(declared.state, {
      type: "choose_influence_to_reveal",
      expectedVersion: declared.state.stateVersion,
      seatId: "seat-stub",
      cardId: reveal.cardId,
    });
    assert.equal(revealed.ok, true);
    if (!revealed.ok) return;

    assert.equal(revealed.state.status, "finished");
    assert.equal(revealed.state.winnerSeatId, "seat-human");
    assert.equal(revealed.state.seats[1]?.eliminated, true);
    assert.ok(
      revealed.events.some(
        (event) =>
          event.type === "match_finished" &&
          event.winnerSeatId === "seat-human",
      ),
    );
  });
});
