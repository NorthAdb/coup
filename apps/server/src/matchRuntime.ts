import type {
  DomainCommand,
  DomainEvent,
  MatchState,
} from "@coup/domain";
import {
  activeDecidingSeatId,
  applyCommand,
  createMatch,
  legalDecisionsFor,
  projectForSeat,
} from "@coup/domain";
import type { LegalDecision, SeatDecision, SeatView } from "@coup/protocol";
import {
  defaultAgentDisplayName,
  type MatchSetupSeatInput,
} from "./matchSetup.js";

export type ActiveMatch = {
  state: MatchState;
  events: DomainEvent[];
  humanSeatId: string;
  displayNames: Record<string, string>;
};

function displayNameFor(match: ActiveMatch, seatId: string): string {
  return match.displayNames[seatId] ?? seatId;
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
      seats: projection.seats.map((seat) => ({
        seatId: seat.seatId,
        controller: seat.controller,
        displayName: displayNameFor(match, seat.seatId),
        coins: seat.coins,
        eliminated: seat.eliminated,
        revealedCharacters: seat.revealedCharacters,
        influenceCount: seat.influenceCount,
      })),
    },
    privateState: {
      hiddenCharacters: projection.hiddenCharacters,
      exchangeHand: projection.exchangeHand,
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
    case "choose_exchange_cards":
      return {
        type: "choose_exchange_cards",
        expectedVersion: stateVersion,
        seatId,
        returnCardIds: decision.returnCardIds,
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
  for (let guard = 0; guard < 256; guard += 1) {
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

export function startMatch(options?: {
  matchId?: string;
  seed?: string;
  seats?: MatchSetupSeatInput[];
}): ActiveMatch {
  const seats =
    options?.seats ??
    ([
      {
        seatId: "seat-human",
        controller: "local_human",
        displayName: "你",
      },
      {
        seatId: "seat-stub",
        controller: "stub_agent",
        displayName: defaultAgentDisplayName(0),
      },
    ] satisfies MatchSetupSeatInput[]);

  const created = createMatch({
    matchId: options?.matchId ?? `match-${Date.now()}`,
    seed: options?.seed ?? `seed-${Date.now()}`,
    seats: seats.map((seat) => ({
      seatId: seat.seatId,
      controller: seat.controller,
    })),
  });

  const displayNames: Record<string, string> = {};
  for (const seat of seats) {
    displayNames[seat.seatId] = seat.displayName;
  }

  const humanSeat = seats.find((seat) => seat.controller === "local_human");
  if (!humanSeat) {
    throw new Error("match requires a local human seat");
  }

  const match: ActiveMatch = {
    state: created.state,
    events: created.events,
    humanSeatId: humanSeat.seatId,
    displayNames,
  };
  return advanceStubSeats(match);
}

/** @deprecated Prefer startMatch; kept for existing two-seat runtime tests. */
export function startTwoSeatMatch(options?: {
  matchId?: string;
  seed?: string;
}): ActiveMatch {
  return startMatch(options);
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
