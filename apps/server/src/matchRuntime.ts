import type { DomainCommand, DomainEvent, MatchState } from "@coup/domain";
import {
  applyCommand,
  createMatch,
  projectForSeat,
} from "@coup/domain";
import type { LegalDecision, SeatDecision, SeatView } from "@coup/protocol";
import type { MatchSetupSeatInput } from "./matchSetup.js";

export type ActiveMatch = {
  state: MatchState;
  events: DomainEvent[];
  humanSeatId: string;
  displayNames: Record<string, string>;
};

export type MatchPersistence = {
  onCreated(match: ActiveMatch, roomCode?: string): void;
  onCommitted(match: ActiveMatch, newEvents: DomainEvent[]): void;
};

export type MatchRuntimeOptions = {
  persistence?: MatchPersistence;
  roomCode?: string;
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
        cli: null,
        modelId: null,
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

function commitApplied(
  previous: ActiveMatch,
  next: ActiveMatch,
  persistence: MatchPersistence | undefined,
): ActiveMatch {
  const newEvents = next.events.slice(previous.events.length);
  persistence?.onCommitted(next, newEvents);
  return next;
}

export async function startMatch(
  options: {
    matchId?: string;
    seed?: string;
    seats: MatchSetupSeatInput[];
  } & MatchRuntimeOptions,
): Promise<ActiveMatch> {
  const { seats, persistence, roomCode } = options;
  const created = createMatch({
    matchId: options.matchId ?? `match-${Date.now()}`,
    seed: options.seed ?? `seed-${Date.now()}`,
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
  persistence?.onCreated(match, roomCode);
  return match;
}

export async function submitHumanDecision(
  match: ActiveMatch,
  decision: SeatDecision,
  options: MatchRuntimeOptions & { actingSeatId?: string } = {},
): Promise<{ ok: true; match: ActiveMatch } | { ok: false; reason: string }> {
  if (decision.protocolVersion !== 1) {
    return { ok: false, reason: "unsupported_protocol" };
  }
  if (!decision.requestId) {
    return { ok: false, reason: "missing_request_id" };
  }
  if (decision.stateVersion !== match.state.stateVersion) {
    return { ok: false, reason: "version_mismatch" };
  }

  const actingSeatId = options.actingSeatId ?? match.humanSeatId;
  const seat = match.state.seats.find((entry) => entry.seatId === actingSeatId);
  if (
    !seat ||
    (seat.controller !== "local_human" && seat.controller !== "remote_human")
  ) {
    return { ok: false, reason: "not_human_seat" };
  }

  const result = applyCommand(
    match.state,
    decisionToCommand(
      actingSeatId,
      decision.decision,
      decision.stateVersion,
    ),
  );
  if (!result.ok) {
    return result;
  }

  return {
    ok: true,
    match: commitApplied(
      match,
      {
        ...match,
        state: result.state,
        events: [...match.events, ...result.events],
      },
      options.persistence,
    ),
  };
}
