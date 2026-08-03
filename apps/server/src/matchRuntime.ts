import type {
  DomainCommand,
  DomainEvent,
  MatchState,
  SeatController,
} from "@coup/domain";
import {
  activeDecidingSeatId,
  applyCommand,
  createMatch,
  legalDecisionsFor,
  projectForSeat,
} from "@coup/domain";
import type { LegalDecision, SeatDecision, SeatView } from "@coup/protocol";

export type ActiveMatch = {
  state: MatchState;
  events: DomainEvent[];
  humanSeatId: string;
};

function displayNameFor(
  seatId: string,
  controller: SeatController,
  index: number,
): string {
  if (controller === "local_human") {
    return "你";
  }
  return `Stub ${index}`;
}

export function toSeatView(
  match: ActiveMatch,
  seatId: string,
  requestId = `req-${match.state.stateVersion}-${seatId}`,
): SeatView {
  const projection = projectForSeat(match.state, seatId);
  return {
    protocolVersion: 1,
    requestId,
    matchId: projection.matchId,
    stateVersion: projection.stateVersion,
    seatId,
    publicState: {
      matchId: projection.matchId,
      status: projection.status,
      stateVersion: projection.stateVersion,
      phase: projection.phase,
      currentSeatId: projection.currentSeatId,
      activeSeatId: projection.activeSeatId,
      pendingAction: projection.pendingAction,
      seats: projection.seats.map((seat, index) => ({
        seatId: seat.seatId,
        controller: seat.controller,
        displayName: displayNameFor(seat.seatId, seat.controller, index),
        coins: seat.coins,
        eliminated: seat.eliminated,
        revealedCharacters: seat.revealedCharacters,
        influenceCount: seat.influenceCount,
      })),
    },
    privateState: {
      hiddenCharacters: projection.hiddenCharacters,
    },
    projectedHistory: match.events,
    legalDecisions: projection.legalDecisions,
  };
}

function decisionToCommand(
  seatId: string,
  decision: LegalDecision,
  stateVersion: number,
): DomainCommand {
  switch (decision.type) {
    case "declare_action":
      return {
        type: "declare_action",
        expectedVersion: stateVersion,
        seatId,
        action: decision.action,
      };
    case "pass_block":
      return { type: "pass_block", expectedVersion: stateVersion, seatId };
    case "declare_block":
      return {
        type: "declare_block",
        expectedVersion: stateVersion,
        seatId,
        claimedCharacter: decision.claimedCharacter,
      };
    case "pass_challenge":
      return { type: "pass_challenge", expectedVersion: stateVersion, seatId };
    case "challenge_claim":
      return {
        type: "challenge_claim",
        expectedVersion: stateVersion,
        seatId,
      };
    case "prove_claim":
      return {
        type: "prove_claim",
        expectedVersion: stateVersion,
        seatId,
        cardId: decision.cardId,
      };
    case "concede_claim":
      return {
        type: "concede_claim",
        expectedVersion: stateVersion,
        seatId,
      };
    case "choose_influence_to_reveal":
      return {
        type: "choose_influence_to_reveal",
        expectedVersion: stateVersion,
        seatId,
        cardId: decision.cardId,
      };
  }
}

/** Stub always picks the first enumerated legal decision. */
export function pickStubDecision(match: ActiveMatch, seatId: string) {
  const legal = legalDecisionsFor(match.state, seatId);
  return legal[0] ?? null;
}

export function advanceStubSeats(match: ActiveMatch): ActiveMatch {
  let current = match;
  for (let guard = 0; guard < 64; guard += 1) {
    const activeSeatId = activeDecidingSeatId(current.state);
    if (!activeSeatId) {
      return current;
    }
    const seat = current.state.seats.find(
      (entry) => entry.seatId === activeSeatId,
    );
    if (!seat || seat.controller !== "stub_agent") {
      return current;
    }
    const decision = pickStubDecision(current, seat.seatId);
    if (!decision) {
      return current;
    }
    const result = applyCommand(
      current.state,
      decisionToCommand(seat.seatId, decision, current.state.stateVersion),
    );
    if (!result.ok) {
      throw new Error(`stub illegal decision: ${result.reason}`);
    }
    current = {
      ...current,
      state: result.state,
      events: [...current.events, ...result.events],
    };
  }
  throw new Error("stub advance exceeded guard");
}

export function startTwoSeatMatch(options?: {
  matchId?: string;
  seed?: string;
}): ActiveMatch {
  const created = createMatch({
    matchId: options?.matchId ?? `match-${Date.now()}`,
    seed: options?.seed ?? `seed-${Date.now()}`,
    seats: [
      { seatId: "seat-human", controller: "local_human" },
      { seatId: "seat-stub", controller: "stub_agent" },
    ],
  });

  const match: ActiveMatch = {
    state: created.state,
    events: created.events,
    humanSeatId: "seat-human",
  };
  return advanceStubSeats(match);
}

export function submitHumanDecision(
  match: ActiveMatch,
  decision: SeatDecision,
): { ok: true; match: ActiveMatch } | { ok: false; reason: string } {
  if (decision.protocolVersion !== 1) {
    return { ok: false, reason: "unsupported_protocol" };
  }
  if (!decision.requestId) {
    return { ok: false, reason: "missing_request_id" };
  }
  if (decision.stateVersion !== match.state.stateVersion) {
    return { ok: false, reason: "version_mismatch" };
  }

  const result = applyCommand(
    match.state,
    decisionToCommand(
      match.humanSeatId,
      decision.decision,
      decision.stateVersion,
    ),
  );
  if (!result.ok) {
    return result;
  }

  const updated: ActiveMatch = {
    ...match,
    state: result.state,
    events: [...match.events, ...result.events],
  };
  return { ok: true, match: advanceStubSeats(updated) };
}
