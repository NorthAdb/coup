export type CharacterId =
  | "duke"
  | "assassin"
  | "captain"
  | "ambassador"
  | "contessa";

export type SeatController = "local_human" | "stub_agent";

export type MatchStatus = "in_progress" | "finished" | "aborted";

export type MatchPhase =
  | "await_action"
  | "await_block"
  | "await_block_challenge"
  | "await_claim_defense"
  | "await_influence_reveal";

export type InfluenceCard = {
  cardId: string;
  character: CharacterId;
  revealed: boolean;
};

export type SeatState = {
  seatId: string;
  controller: SeatController;
  coins: number;
  influences: InfluenceCard[];
  eliminated: boolean;
};

export type ActionDeclaration =
  | { type: "income" }
  | { type: "foreign_aid" }
  | { type: "coup"; targetSeatId: string };

export type PendingAction = {
  actorSeatId: string;
  action: ActionDeclaration;
  blockerSeatId?: string;
  blockerClaim?: CharacterId;
};

export type PendingClaim = {
  seatId: string;
  character: CharacterId;
  challengerSeatId: string;
};

export type MatchState = {
  matchId: string;
  status: MatchStatus;
  stateVersion: number;
  seed: string;
  phase: MatchPhase;
  currentSeatId: string;
  seats: SeatState[];
  courtDeck: InfluenceCard[];
  winnerSeatId: string | null;
  pendingAction: PendingAction | null;
  responseQueue: string[];
  pendingClaim: PendingClaim | null;
  revealSeatId: string | null;
};

export type DomainCommand =
  | {
      type: "declare_action";
      expectedVersion: number;
      seatId: string;
      action: ActionDeclaration;
    }
  | {
      type: "pass_block";
      expectedVersion: number;
      seatId: string;
    }
  | {
      type: "declare_block";
      expectedVersion: number;
      seatId: string;
      claimedCharacter: "duke";
    }
  | {
      type: "pass_challenge";
      expectedVersion: number;
      seatId: string;
    }
  | {
      type: "challenge_claim";
      expectedVersion: number;
      seatId: string;
    }
  | {
      type: "prove_claim";
      expectedVersion: number;
      seatId: string;
      cardId: string;
    }
  | {
      type: "concede_claim";
      expectedVersion: number;
      seatId: string;
    }
  | {
      type: "choose_influence_to_reveal";
      expectedVersion: number;
      seatId: string;
      cardId: string;
    };

export type LegalDecision =
  | { type: "declare_action"; action: ActionDeclaration }
  | { type: "pass_block" }
  | { type: "declare_block"; claimedCharacter: "duke" }
  | { type: "pass_challenge" }
  | { type: "challenge_claim" }
  | { type: "prove_claim"; cardId: string; character: CharacterId }
  | { type: "concede_claim" }
  | {
      type: "choose_influence_to_reveal";
      cardId: string;
      character: CharacterId;
    };

export type ActionType = ActionDeclaration["type"];

export type DomainEvent =
  | {
      type: "match_started";
      matchId: string;
      seatIds: string[];
      currentSeatId: string;
    }
  | {
      type: "action_declared";
      seatId: string;
      actionType: ActionType;
      targetSeatId?: string;
    }
  | {
      type: "action_resolved";
      seatId: string;
      actionType: ActionType;
      coinsGained?: number;
      targetSeatId?: string;
    }
  | {
      type: "action_failed";
      seatId: string;
      actionType: ActionType;
      reason: "blocked";
    }
  | {
      type: "block_declared";
      seatId: string;
      claimedCharacter: CharacterId;
    }
  | {
      type: "response_passed";
      seatId: string;
      responseType: "block" | "challenge";
    }
  | {
      type: "challenge_declared";
      seatId: string;
      againstSeatId: string;
    }
  | {
      type: "claim_proven";
      seatId: string;
      character: CharacterId;
    }
  | {
      type: "claim_conceded";
      seatId: string;
    }
  | {
      type: "influence_revealed";
      seatId: string;
      character: CharacterId;
    }
  | {
      type: "seat_eliminated";
      seatId: string;
    }
  | {
      type: "match_finished";
      winnerSeatId: string;
    }
  | {
      type: "turn_advanced";
      seatId: string;
    };

export type CreateMatchInput = {
  matchId: string;
  seed: string;
  seats: Array<{ seatId: string; controller: SeatController }>;
};

export type ApplyCommandResult =
  | { ok: true; state: MatchState; events: DomainEvent[] }
  | { ok: false; reason: string };

const CHARACTERS: CharacterId[] = [
  "duke",
  "assassin",
  "captain",
  "ambassador",
  "contessa",
];

const COUP_COST = 7;
const FORCED_COUP_COINS = 10;

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const tmp = next[i]!;
    next[i] = next[j]!;
    next[j] = tmp;
  }
  return next;
}

function buildDeck(seed: string): InfluenceCard[] {
  const cards: InfluenceCard[] = [];
  for (const character of CHARACTERS) {
    for (let copy = 0; copy < 3; copy += 1) {
      cards.push({
        cardId: `${character}-${copy + 1}`,
        character,
        revealed: false,
      });
    }
  }
  return shuffle(cards, mulberry32(hashSeed(seed)));
}

function assertUniqueSeatIds(
  seats: CreateMatchInput["seats"],
): string | undefined {
  const seen = new Set<string>();
  for (const seat of seats) {
    if (seen.has(seat.seatId)) {
      return `duplicate seatId: ${seat.seatId}`;
    }
    seen.add(seat.seatId);
  }
  return undefined;
}

function cloneState(state: MatchState): MatchState {
  return {
    ...state,
    seats: state.seats.map((seat) => ({
      ...seat,
      influences: seat.influences.map((card) => ({ ...card })),
    })),
    courtDeck: state.courtDeck.map((card) => ({ ...card })),
    pendingAction: state.pendingAction
      ? { ...state.pendingAction }
      : null,
    responseQueue: [...state.responseQueue],
    pendingClaim: state.pendingClaim ? { ...state.pendingClaim } : null,
  };
}

export function createMatch(input: CreateMatchInput): {
  state: MatchState;
  events: DomainEvent[];
} {
  if (input.seats.length < 2 || input.seats.length > 6) {
    throw new Error("match requires 2–6 seats");
  }
  const duplicate = assertUniqueSeatIds(input.seats);
  if (duplicate) {
    throw new Error(duplicate);
  }

  const deck = buildDeck(input.seed);
  const seats: SeatState[] = input.seats.map((seat, index) => {
    const influences = [deck.shift()!, deck.shift()!];
    const coins =
      input.seats.length === 2 ? (index === 0 ? 1 : 2) : 2;
    return {
      seatId: seat.seatId,
      controller: seat.controller,
      coins,
      influences,
      eliminated: false,
    };
  });

  const state: MatchState = {
    matchId: input.matchId,
    status: "in_progress",
    stateVersion: 1,
    seed: input.seed,
    phase: "await_action",
    currentSeatId: seats[0]!.seatId,
    seats,
    courtDeck: deck,
    winnerSeatId: null,
    pendingAction: null,
    responseQueue: [],
    pendingClaim: null,
    revealSeatId: null,
  };

  const events: DomainEvent[] = [
    {
      type: "match_started",
      matchId: state.matchId,
      seatIds: seats.map((seat) => seat.seatId),
      currentSeatId: state.currentSeatId,
    },
  ];

  return { state, events };
}

function findSeat(state: MatchState, seatId: string): SeatState | undefined {
  return state.seats.find((seat) => seat.seatId === seatId);
}

function livingSeats(state: MatchState): SeatState[] {
  return state.seats.filter((seat) => !seat.eliminated);
}

function nextLivingSeatId(state: MatchState, fromSeatId: string): string {
  const index = state.seats.findIndex((seat) => seat.seatId === fromSeatId);
  if (index < 0) {
    throw new Error(`unknown seat: ${fromSeatId}`);
  }
  for (let offset = 1; offset <= state.seats.length; offset += 1) {
    const seat = state.seats[(index + offset) % state.seats.length]!;
    if (!seat.eliminated) {
      return seat.seatId;
    }
  }
  throw new Error("no living seats");
}

/** Clockwise living seats after `fromSeatId`, excluding that seat. */
function clockwiseResponders(
  state: MatchState,
  fromSeatId: string,
): string[] {
  const result: string[] = [];
  let cursor = fromSeatId;
  for (let i = 0; i < state.seats.length - 1; i += 1) {
    cursor = nextLivingSeatId(state, cursor);
    if (cursor === fromSeatId) {
      break;
    }
    result.push(cursor);
  }
  return result;
}

export function activeDecidingSeatId(state: MatchState): string | null {
  if (state.status !== "in_progress") {
    return null;
  }
  switch (state.phase) {
    case "await_action":
      return state.currentSeatId;
    case "await_block":
    case "await_block_challenge":
      return state.responseQueue[0] ?? null;
    case "await_claim_defense":
      return state.pendingClaim?.seatId ?? null;
    case "await_influence_reveal":
      return state.revealSeatId;
  }
}

function decisionsEqual(a: LegalDecision, b: LegalDecision): boolean {
  if (a.type !== b.type) {
    return false;
  }
  switch (a.type) {
    case "declare_action":
      return (
        b.type === "declare_action" &&
        a.action.type === b.action.type &&
        (a.action.type !== "coup" ||
          (b.action.type === "coup" &&
            a.action.targetSeatId === b.action.targetSeatId))
      );
    case "declare_block":
      return (
        b.type === "declare_block" &&
        a.claimedCharacter === b.claimedCharacter
      );
    case "prove_claim":
      return b.type === "prove_claim" && a.cardId === b.cardId;
    case "choose_influence_to_reveal":
      return b.type === "choose_influence_to_reveal" && a.cardId === b.cardId;
    default:
      return true;
  }
}

function actionTargets(state: MatchState, actorSeatId: string): string[] {
  return livingSeats(state)
    .filter((seat) => seat.seatId !== actorSeatId)
    .map((seat) => seat.seatId);
}

export function legalDecisionsFor(
  state: MatchState,
  seatId: string,
): LegalDecision[] {
  if (state.status !== "in_progress") {
    return [];
  }
  const seat = findSeat(state, seatId);
  if (!seat || seat.eliminated) {
    return [];
  }
  if (activeDecidingSeatId(state) !== seatId) {
    return [];
  }

  switch (state.phase) {
    case "await_action": {
      if (seat.coins >= FORCED_COUP_COINS) {
        return actionTargets(state, seatId).map((targetSeatId) => ({
          type: "declare_action" as const,
          action: { type: "coup" as const, targetSeatId },
        }));
      }
      const decisions: LegalDecision[] = [
        { type: "declare_action", action: { type: "income" } },
        { type: "declare_action", action: { type: "foreign_aid" } },
      ];
      if (seat.coins >= COUP_COST) {
        for (const targetSeatId of actionTargets(state, seatId)) {
          decisions.push({
            type: "declare_action",
            action: { type: "coup", targetSeatId },
          });
        }
      }
      return decisions;
    }
    case "await_block": {
      if (!state.pendingAction || state.pendingAction.action.type !== "foreign_aid") {
        return [];
      }
      return [
        { type: "pass_block" },
        { type: "declare_block", claimedCharacter: "duke" },
      ];
    }
    case "await_block_challenge":
      return [{ type: "pass_challenge" }, { type: "challenge_claim" }];
    case "await_claim_defense": {
      if (!state.pendingClaim || state.pendingClaim.seatId !== seatId) {
        return [];
      }
      const matching = seat.influences.filter(
        (card) =>
          !card.revealed && card.character === state.pendingClaim!.character,
      );
      return [
        ...matching.map((card) => ({
          type: "prove_claim" as const,
          cardId: card.cardId,
          character: card.character,
        })),
        { type: "concede_claim" },
      ];
    }
    case "await_influence_reveal": {
      return seat.influences
        .filter((card) => !card.revealed)
        .map((card) => ({
          type: "choose_influence_to_reveal" as const,
          cardId: card.cardId,
          character: card.character,
        }));
    }
  }
}

export type SeatProjection = {
  matchId: string;
  stateVersion: number;
  seatId: string;
  status: MatchStatus;
  phase: MatchPhase;
  currentSeatId: string;
  activeSeatId: string | null;
  pendingAction: PendingAction | null;
  seats: Array<{
    seatId: string;
    controller: SeatController;
    coins: number;
    eliminated: boolean;
    revealedCharacters: CharacterId[];
    influenceCount: number;
  }>;
  hiddenCharacters: CharacterId[];
  legalDecisions: LegalDecision[];
};

export function projectForSeat(
  state: MatchState,
  seatId: string,
): SeatProjection {
  const self = findSeat(state, seatId);
  if (!self) {
    throw new Error(`unknown seat: ${seatId}`);
  }

  return {
    matchId: state.matchId,
    stateVersion: state.stateVersion,
    seatId,
    status: state.status,
    phase: state.phase,
    currentSeatId: state.currentSeatId,
    activeSeatId: activeDecidingSeatId(state),
    pendingAction: state.pendingAction,
    seats: state.seats.map((seat) => ({
      seatId: seat.seatId,
      controller: seat.controller,
      coins: seat.coins,
      eliminated: seat.eliminated,
      revealedCharacters: seat.influences
        .filter((card) => card.revealed)
        .map((card) => card.character),
      influenceCount: seat.influences.filter((card) => !card.revealed).length,
    })),
    hiddenCharacters: self.influences
      .filter((card) => !card.revealed)
      .map((card) => card.character),
    legalDecisions: legalDecisionsFor(state, seatId),
  };
}

function patchState(
  state: MatchState,
  patch: Partial<MatchState>,
): MatchState {
  return { ...state, ...patch };
}

function commit(state: MatchState): MatchState {
  return { ...state, stateVersion: state.stateVersion + 1 };
}

function advanceTurn(state: MatchState, events: DomainEvent[]): MatchState {
  const nextSeatId = nextLivingSeatId(state, state.currentSeatId);
  events.push({ type: "turn_advanced", seatId: nextSeatId });
  return patchState(state, {
    phase: "await_action",
    currentSeatId: nextSeatId,
    pendingAction: null,
    responseQueue: [],
    pendingClaim: null,
    revealSeatId: null,
  });
}

function resolveIncome(state: MatchState, events: DomainEvent[]): MatchState {
  const actorId = state.pendingAction?.actorSeatId ?? state.currentSeatId;
  const seats = state.seats.map((seat) =>
    seat.seatId === actorId ? { ...seat, coins: seat.coins + 1 } : seat,
  );
  events.push({
    type: "action_resolved",
    seatId: actorId,
    actionType: "income",
    coinsGained: 1,
  });
  return advanceTurn(patchState(state, { seats, pendingAction: null }), events);
}

function resolveForeignAid(
  state: MatchState,
  events: DomainEvent[],
): MatchState {
  const actorId = state.pendingAction!.actorSeatId;
  const seats = state.seats.map((seat) =>
    seat.seatId === actorId ? { ...seat, coins: seat.coins + 2 } : seat,
  );
  events.push({
    type: "action_resolved",
    seatId: actorId,
    actionType: "foreign_aid",
    coinsGained: 2,
  });
  return advanceTurn(patchState(state, { seats, pendingAction: null }), events);
}

function failForeignAidBlocked(
  state: MatchState,
  events: DomainEvent[],
): MatchState {
  const actorId = state.pendingAction!.actorSeatId;
  events.push({
    type: "action_failed",
    seatId: actorId,
    actionType: "foreign_aid",
    reason: "blocked",
  });
  return advanceTurn(
    patchState(state, {
      pendingAction: null,
      responseQueue: [],
      pendingClaim: null,
    }),
    events,
  );
}

function beginCoupReveal(
  state: MatchState,
  events: DomainEvent[],
): MatchState {
  const pending = state.pendingAction!;
  if (pending.action.type !== "coup") {
    throw new Error("expected coup pending action");
  }
  const actor = findSeat(state, pending.actorSeatId)!;
  const seats = state.seats.map((seat) =>
    seat.seatId === actor.seatId
      ? { ...seat, coins: seat.coins - COUP_COST }
      : seat,
  );
  events.push({
    type: "action_resolved",
    seatId: pending.actorSeatId,
    actionType: "coup",
    targetSeatId: pending.action.targetSeatId,
  });
  return patchState(state, {
    seats,
    phase: "await_influence_reveal",
    revealSeatId: pending.action.targetSeatId,
    responseQueue: [],
    pendingClaim: null,
  });
}

function afterRevealChecks(
  state: MatchState,
  revealedSeatId: string,
  events: DomainEvent[],
): MatchState {
  const target = findSeat(state, revealedSeatId)!;
  const hiddenLeft = target.influences.filter((card) => !card.revealed).length;
  let next = state;
  if (hiddenLeft === 0 && !target.eliminated) {
    const seats = next.seats.map((seat) =>
      seat.seatId === revealedSeatId
        ? { ...seat, eliminated: true, coins: 0 }
        : seat,
    );
    events.push({ type: "seat_eliminated", seatId: revealedSeatId });
    next = patchState(next, { seats });
  }

  const alive = livingSeats(next);
  if (alive.length === 1) {
    const winnerSeatId = alive[0]!.seatId;
    events.push({ type: "match_finished", winnerSeatId });
    return patchState(next, {
      status: "finished",
      phase: "await_action",
      winnerSeatId,
      pendingAction: null,
      responseQueue: [],
      pendingClaim: null,
      revealSeatId: null,
    });
  }

  if (next.pendingAction?.action.type === "coup") {
    return advanceTurn(
      patchState(next, {
        pendingAction: null,
        revealSeatId: null,
      }),
      events,
    );
  }

  // Block challenge aftermath: proven block → fail action; failed block → resolve aid
  if (next.pendingAction?.action.type === "foreign_aid") {
    if (next.pendingAction.blockerSeatId) {
      // blocker still marked → block held (challenger revealed)
      return failForeignAidBlocked(next, events);
    }
    return resolveForeignAid(next, events);
  }

  return advanceTurn(next, events);
}

function applyReveal(
  state: MatchState,
  seatId: string,
  cardId: string,
  events: DomainEvent[],
): MatchState {
  const seat = findSeat(state, seatId)!;
  const card = seat.influences.find((entry) => entry.cardId === cardId)!;

  const seats = state.seats.map((entry) => {
    if (entry.seatId !== seatId) return entry;
    return {
      ...entry,
      influences: entry.influences.map((influence) =>
        influence.cardId === cardId
          ? { ...influence, revealed: true }
          : influence,
      ),
    };
  });
  events.push({
    type: "influence_revealed",
    seatId,
    character: card.character,
  });

  return afterRevealChecks(
    patchState(state, {
      seats,
      revealSeatId: null,
    }),
    seatId,
    events,
  );
}

function replaceProvenCard(
  state: MatchState,
  seatId: string,
  cardId: string,
): MatchState {
  const random = mulberry32(
    hashSeed(`${state.seed}:prove:${state.stateVersion}:${cardId}`),
  );
  const seat = findSeat(state, seatId)!;
  const proven = seat.influences.find((card) => card.cardId === cardId)!;
  const remainingInfluences = seat.influences.filter(
    (card) => card.cardId !== cardId,
  );
  const deck = shuffle(
    [...state.courtDeck, { ...proven, revealed: false }],
    random,
  );
  const drawn = deck.shift()!;
  const seats = state.seats.map((entry) =>
    entry.seatId === seatId
      ? { ...entry, influences: [...remainingInfluences, drawn] }
      : entry,
  );
  return {
    ...state,
    seats,
    courtDeck: deck,
  };
}

function decisionFromCommand(
  command: DomainCommand,
  state: MatchState,
): LegalDecision {
  switch (command.type) {
    case "declare_action":
      return { type: "declare_action", action: command.action };
    case "pass_block":
      return { type: "pass_block" };
    case "declare_block":
      return {
        type: "declare_block",
        claimedCharacter: command.claimedCharacter,
      };
    case "pass_challenge":
      return { type: "pass_challenge" };
    case "challenge_claim":
      return { type: "challenge_claim" };
    case "prove_claim": {
      const seat = findSeat(state, command.seatId);
      const card = seat?.influences.find(
        (entry) => entry.cardId === command.cardId,
      );
      return {
        type: "prove_claim",
        cardId: command.cardId,
        character: card!.character,
      };
    }
    case "concede_claim":
      return { type: "concede_claim" };
    case "choose_influence_to_reveal": {
      const seat = findSeat(state, command.seatId);
      const card = seat?.influences.find(
        (entry) => entry.cardId === command.cardId,
      );
      return {
        type: "choose_influence_to_reveal",
        cardId: command.cardId,
        character: card!.character,
      };
    }
  }
}

export function applyCommand(
  state: MatchState,
  command: DomainCommand,
): ApplyCommandResult {
  if (command.expectedVersion !== state.stateVersion) {
    return { ok: false, reason: "version_mismatch" };
  }
  if (state.status !== "in_progress") {
    return { ok: false, reason: "match_not_in_progress" };
  }

  const legal = legalDecisionsFor(state, command.seatId);
  const wanted = decisionFromCommand(command, state);
  if (!legal.some((decision) => decisionsEqual(decision, wanted))) {
    return { ok: false, reason: "illegal_decision" };
  }

  const working = cloneState(state);
  const events: DomainEvent[] = [];

  let next: MatchState;

  switch (command.type) {
    case "declare_action": {
      if (command.action.type === "income") {
        events.push({
          type: "action_declared",
          seatId: command.seatId,
          actionType: "income",
        });
        next = resolveIncome(
          patchState(working, {
            pendingAction: {
              actorSeatId: command.seatId,
              action: command.action,
            },
          }),
          events,
        );
        break;
      }

      if (command.action.type === "foreign_aid") {
        events.push({
          type: "action_declared",
          seatId: command.seatId,
          actionType: "foreign_aid",
        });
        next = patchState(working, {
          phase: "await_block",
          pendingAction: {
            actorSeatId: command.seatId,
            action: command.action,
          },
          responseQueue: clockwiseResponders(working, command.seatId),
          pendingClaim: null,
          revealSeatId: null,
        });
        break;
      }

      events.push({
        type: "action_declared",
        seatId: command.seatId,
        actionType: "coup",
        targetSeatId: command.action.targetSeatId,
      });
      next = beginCoupReveal(
        patchState(working, {
          pendingAction: {
            actorSeatId: command.seatId,
            action: command.action,
          },
        }),
        events,
      );
      break;
    }

    case "pass_block": {
      events.push({
        type: "response_passed",
        seatId: command.seatId,
        responseType: "block",
      });
      const remaining = working.responseQueue.slice(1);
      next =
        remaining.length === 0
          ? resolveForeignAid(
              patchState(working, {
                responseQueue: [],
                phase: "await_action",
              }),
              events,
            )
          : patchState(working, { responseQueue: remaining });
      break;
    }

    case "declare_block": {
      events.push({
        type: "block_declared",
        seatId: command.seatId,
        claimedCharacter: command.claimedCharacter,
      });
      next = patchState(working, {
        phase: "await_block_challenge",
        pendingAction: {
          ...working.pendingAction!,
          blockerSeatId: command.seatId,
          blockerClaim: command.claimedCharacter,
        },
        responseQueue: clockwiseResponders(working, command.seatId),
        pendingClaim: null,
      });
      break;
    }

    case "pass_challenge": {
      events.push({
        type: "response_passed",
        seatId: command.seatId,
        responseType: "challenge",
      });
      const remaining = working.responseQueue.slice(1);
      next =
        remaining.length === 0
          ? failForeignAidBlocked(
              patchState(working, { responseQueue: [] }),
              events,
            )
          : patchState(working, { responseQueue: remaining });
      break;
    }

    case "challenge_claim": {
      const pending = working.pendingAction!;
      events.push({
        type: "challenge_declared",
        seatId: command.seatId,
        againstSeatId: pending.blockerSeatId!,
      });
      next = patchState(working, {
        phase: "await_claim_defense",
        responseQueue: [],
        pendingClaim: {
          seatId: pending.blockerSeatId!,
          character: pending.blockerClaim!,
          challengerSeatId: command.seatId,
        },
      });
      break;
    }

    case "prove_claim": {
      const claim = working.pendingClaim!;
      const proven = replaceProvenCard(working, command.seatId, command.cardId);
      events.push({
        type: "claim_proven",
        seatId: command.seatId,
        character: claim.character,
      });
      next = patchState(proven, {
        phase: "await_influence_reveal",
        revealSeatId: claim.challengerSeatId,
        pendingClaim: null,
      });
      break;
    }

    case "concede_claim": {
      const claim = working.pendingClaim!;
      events.push({ type: "claim_conceded", seatId: command.seatId });
      next = patchState(working, {
        phase: "await_influence_reveal",
        revealSeatId: claim.seatId,
        pendingClaim: null,
        pendingAction: {
          actorSeatId: working.pendingAction!.actorSeatId,
          action: working.pendingAction!.action,
        },
      });
      break;
    }

    case "choose_influence_to_reveal":
      next = applyReveal(working, command.seatId, command.cardId, events);
      break;
  }

  return { ok: true, state: commit(next), events };
}
