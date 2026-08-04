export type CharacterId =
  | "duke"
  | "assassin"
  | "captain"
  | "ambassador"
  | "contessa";

export type SeatController = "local_human" | "remote_human" | "stub_agent";

export type MatchStatus = "in_progress" | "finished" | "aborted";

export type MatchPhase =
  | "await_action"
  | "await_action_challenge"
  | "await_block"
  | "await_block_challenge"
  | "await_claim_defense"
  | "await_influence_reveal"
  | "await_exchange_selection";

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
  | { type: "coup"; targetSeatId: string }
  | { type: "tax" }
  | { type: "assassinate"; targetSeatId: string }
  | { type: "steal"; targetSeatId: string }
  | { type: "exchange" };

export type BlockCharacter = "duke" | "contessa" | "captain" | "ambassador";

export type PendingAction = {
  actorSeatId: string;
  action: ActionDeclaration;
  feePaid?: number;
  blockerSeatId?: string;
  blockerClaim?: BlockCharacter;
};

export type PendingClaim = {
  seatId: string;
  character: CharacterId;
  challengerSeatId: string;
  kind: "action" | "block";
};

export type RevealFollowUp =
  | "coup_done"
  | "action_claim_proven"
  | "action_claim_conceded"
  | "block_claim_proven"
  | "block_claim_conceded"
  | "assassinate_target";

export type PendingExchange = {
  seatId: string;
  hand: InfluenceCard[];
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
  revealFollowUp: RevealFollowUp | null;
  pendingExchange: PendingExchange | null;
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
      claimedCharacter: BlockCharacter;
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
    }
  | {
      type: "choose_exchange_cards";
      expectedVersion: number;
      seatId: string;
      returnCardIds: [string, string];
    };

export type LegalDecision =
  | { type: "declare_action"; action: ActionDeclaration }
  | { type: "pass_block" }
  | { type: "declare_block"; claimedCharacter: BlockCharacter }
  | { type: "pass_challenge" }
  | { type: "challenge_claim" }
  | { type: "prove_claim"; cardId: string; character: CharacterId }
  | { type: "concede_claim" }
  | {
      type: "choose_influence_to_reveal";
      cardId: string;
      character: CharacterId;
    }
  | {
      type: "choose_exchange_cards";
      returnCardIds: [string, string];
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
      coinsStolen?: number;
      targetSeatId?: string;
    }
  | {
      type: "action_failed";
      seatId: string;
      actionType: ActionType;
      reason: "blocked" | "challenged";
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
const ASSASSINATE_COST = 3;
const FORCED_COUP_COINS = 10;

const ACTION_CLAIMS: Partial<Record<ActionType, CharacterId>> = {
  tax: "duke",
  assassinate: "assassin",
  steal: "captain",
  exchange: "ambassador",
};

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
    pendingExchange: state.pendingExchange
      ? {
          seatId: state.pendingExchange.seatId,
          hand: state.pendingExchange.hand.map((card) => ({ ...card })),
        }
      : null,
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
    revealFollowUp: null,
    pendingExchange: null,
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

function actionTargetSeatId(action: ActionDeclaration): string | undefined {
  if (
    action.type === "coup" ||
    action.type === "assassinate" ||
    action.type === "steal"
  ) {
    return action.targetSeatId;
  }
  return undefined;
}

function sortedPair(ids: [string, string]): [string, string] {
  return ids[0] <= ids[1] ? ids : [ids[1], ids[0]];
}

function combinationsOfTwo(ids: string[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      pairs.push([ids[i]!, ids[j]!]);
    }
  }
  return pairs;
}

export function activeDecidingSeatId(state: MatchState): string | null {
  if (state.status !== "in_progress") {
    return null;
  }
  switch (state.phase) {
    case "await_action":
      return state.currentSeatId;
    case "await_action_challenge":
    case "await_block":
    case "await_block_challenge":
      return state.responseQueue[0] ?? null;
    case "await_claim_defense":
      return state.pendingClaim?.seatId ?? null;
    case "await_influence_reveal":
      return state.revealSeatId;
    case "await_exchange_selection":
      return state.pendingExchange?.seatId ?? null;
  }
}

function decisionsEqual(a: LegalDecision, b: LegalDecision): boolean {
  if (a.type !== b.type) {
    return false;
  }
  switch (a.type) {
    case "declare_action": {
      if (b.type !== "declare_action" || a.action.type !== b.action.type) {
        return false;
      }
      const aTarget = actionTargetSeatId(a.action);
      const bTarget = actionTargetSeatId(b.action);
      return aTarget === bTarget;
    }
    case "declare_block":
      return (
        b.type === "declare_block" &&
        a.claimedCharacter === b.claimedCharacter
      );
    case "prove_claim":
      return b.type === "prove_claim" && a.cardId === b.cardId;
    case "choose_influence_to_reveal":
      return b.type === "choose_influence_to_reveal" && a.cardId === b.cardId;
    case "choose_exchange_cards":
      return (
        b.type === "choose_exchange_cards" &&
        (() => {
          const left = sortedPair(a.returnCardIds);
          const right = sortedPair(b.returnCardIds);
          return left[0] === right[0] && left[1] === right[1];
        })()
      );
    default:
      return true;
  }
}

function actionTargets(state: MatchState, actorSeatId: string): string[] {
  return livingSeats(state)
    .filter((seat) => seat.seatId !== actorSeatId)
    .map((seat) => seat.seatId);
}

function stealTargets(state: MatchState, actorSeatId: string): string[] {
  return livingSeats(state)
    .filter((seat) => seat.seatId !== actorSeatId && seat.coins >= 1)
    .map((seat) => seat.seatId);
}

function blockOptionsFor(
  state: MatchState,
  seatId: string,
): LegalDecision[] {
  const pending = state.pendingAction;
  if (!pending) return [];

  if (pending.action.type === "foreign_aid") {
    return [
      { type: "pass_block" },
      { type: "declare_block", claimedCharacter: "duke" },
    ];
  }

  if (pending.action.type === "assassinate") {
    if (pending.action.targetSeatId !== seatId) return [];
    return [
      { type: "pass_block" },
      { type: "declare_block", claimedCharacter: "contessa" },
    ];
  }

  if (pending.action.type === "steal") {
    if (pending.action.targetSeatId !== seatId) return [];
    return [
      { type: "pass_block" },
      { type: "declare_block", claimedCharacter: "ambassador" },
      { type: "declare_block", claimedCharacter: "captain" },
    ];
  }

  return [];
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
        { type: "declare_action", action: { type: "tax" } },
        { type: "declare_action", action: { type: "exchange" } },
      ];
      if (seat.coins >= ASSASSINATE_COST) {
        for (const targetSeatId of actionTargets(state, seatId)) {
          decisions.push({
            type: "declare_action",
            action: { type: "assassinate", targetSeatId },
          });
        }
      }
      for (const targetSeatId of stealTargets(state, seatId)) {
        decisions.push({
          type: "declare_action",
          action: { type: "steal", targetSeatId },
        });
      }
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
    case "await_action_challenge":
    case "await_block_challenge":
      return [{ type: "pass_challenge" }, { type: "challenge_claim" }];
    case "await_block":
      return blockOptionsFor(state, seatId);
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
    case "await_exchange_selection": {
      if (!state.pendingExchange || state.pendingExchange.seatId !== seatId) {
        return [];
      }
      const ids = state.pendingExchange.hand.map((card) => card.cardId);
      return combinationsOfTwo(ids).map((returnCardIds) => ({
        type: "choose_exchange_cards" as const,
        returnCardIds,
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
  exchangeHand: Array<{ cardId: string; character: CharacterId }> | null;
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

  const exchangeHand =
    state.pendingExchange?.seatId === seatId
      ? state.pendingExchange.hand.map((card) => ({
          cardId: card.cardId,
          character: card.character,
        }))
      : null;

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
    exchangeHand,
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

function clearTurnEphemera(
  patch: Partial<MatchState> = {},
): Partial<MatchState> {
  return {
    pendingAction: null,
    responseQueue: [],
    pendingClaim: null,
    revealSeatId: null,
    revealFollowUp: null,
    pendingExchange: null,
    ...patch,
  };
}

function advanceTurn(state: MatchState, events: DomainEvent[]): MatchState {
  const nextSeatId = nextLivingSeatId(state, state.currentSeatId);
  events.push({ type: "turn_advanced", seatId: nextSeatId });
  return patchState(state, {
    phase: "await_action",
    currentSeatId: nextSeatId,
    ...clearTurnEphemera(),
  });
}

function finishIfSoleSurvivor(
  state: MatchState,
  events: DomainEvent[],
): MatchState | null {
  const alive = livingSeats(state);
  if (alive.length !== 1) {
    return null;
  }
  const winnerSeatId = alive[0]!.seatId;
  events.push({ type: "match_finished", winnerSeatId });
  return patchState(state, {
    status: "finished",
    phase: "await_action",
    winnerSeatId,
    ...clearTurnEphemera(),
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
  return advanceTurn(patchState(state, { seats, ...clearTurnEphemera() }), events);
}

function resolveTax(state: MatchState, events: DomainEvent[]): MatchState {
  const actorId = state.pendingAction!.actorSeatId;
  const seats = state.seats.map((seat) =>
    seat.seatId === actorId ? { ...seat, coins: seat.coins + 3 } : seat,
  );
  events.push({
    type: "action_resolved",
    seatId: actorId,
    actionType: "tax",
    coinsGained: 3,
  });
  return advanceTurn(patchState(state, { seats, ...clearTurnEphemera() }), events);
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
  return advanceTurn(patchState(state, { seats, ...clearTurnEphemera() }), events);
}

function resolveSteal(state: MatchState, events: DomainEvent[]): MatchState {
  const pending = state.pendingAction!;
  if (pending.action.type !== "steal") {
    throw new Error("expected steal pending action");
  }
  const target = findSeat(state, pending.action.targetSeatId)!;
  const stolen = Math.min(2, target.coins);
  const seats = state.seats.map((seat) => {
    if (seat.seatId === pending.actorSeatId) {
      return { ...seat, coins: seat.coins + stolen };
    }
    if (seat.seatId === target.seatId) {
      return { ...seat, coins: seat.coins - stolen };
    }
    return seat;
  });
  events.push({
    type: "action_resolved",
    seatId: pending.actorSeatId,
    actionType: "steal",
    coinsStolen: stolen,
    targetSeatId: target.seatId,
  });
  return advanceTurn(patchState(state, { seats, ...clearTurnEphemera() }), events);
}

function beginExchangeSelection(state: MatchState): MatchState {
  const pending = state.pendingAction!;
  const actor = findSeat(state, pending.actorSeatId)!;
  const deck = [...state.courtDeck];
  const drawn = [deck.shift()!, deck.shift()!];
  const hidden = actor.influences.filter((card) => !card.revealed);
  const hand = [...hidden, ...drawn];
  return patchState(state, {
    courtDeck: deck,
    phase: "await_exchange_selection",
    pendingExchange: { seatId: pending.actorSeatId, hand },
    responseQueue: [],
    pendingClaim: null,
    revealSeatId: null,
    revealFollowUp: null,
  });
}

function failAction(
  state: MatchState,
  events: DomainEvent[],
  reason: "blocked" | "challenged",
  refundFee: boolean,
): MatchState {
  const pending = state.pendingAction!;
  let seats = state.seats;
  if (refundFee && (pending.feePaid ?? 0) > 0) {
    seats = seats.map((seat) =>
      seat.seatId === pending.actorSeatId && !seat.eliminated
        ? { ...seat, coins: seat.coins + (pending.feePaid ?? 0) }
        : seat,
    );
  }
  events.push({
    type: "action_failed",
    seatId: pending.actorSeatId,
    actionType: pending.action.type,
    reason,
  });
  return advanceTurn(
    patchState(state, { seats, ...clearTurnEphemera() }),
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
  const seats = state.seats.map((seat) =>
    seat.seatId === pending.actorSeatId
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
    revealFollowUp: "coup_done",
    responseQueue: [],
    pendingClaim: null,
    pendingExchange: null,
  });
}

function beginAssassinateReveal(
  state: MatchState,
  events: DomainEvent[],
): MatchState {
  const pending = state.pendingAction!;
  if (pending.action.type !== "assassinate") {
    throw new Error("expected assassinate pending action");
  }
  events.push({
    type: "action_resolved",
    seatId: pending.actorSeatId,
    actionType: "assassinate",
    targetSeatId: pending.action.targetSeatId,
  });
  const target = findSeat(state, pending.action.targetSeatId)!;
  if (target.eliminated) {
    return advanceTurn(patchState(state, clearTurnEphemera()), events);
  }
  return patchState(state, {
    phase: "await_influence_reveal",
    revealSeatId: pending.action.targetSeatId,
    revealFollowUp: "assassinate_target",
    responseQueue: [],
    pendingClaim: null,
    pendingExchange: null,
  });
}

function openBlockWindow(state: MatchState): MatchState {
  const pending = state.pendingAction!;
  if (pending.action.type === "foreign_aid") {
    return patchState(state, {
      phase: "await_block",
      responseQueue: clockwiseResponders(state, pending.actorSeatId),
      pendingClaim: null,
      revealSeatId: null,
      revealFollowUp: null,
    });
  }
  if (
    pending.action.type === "assassinate" ||
    pending.action.type === "steal"
  ) {
    const targetId = pending.action.targetSeatId;
    const target = findSeat(state, targetId);
    if (!target || target.eliminated) {
      return continueUnresolvedAction(state, []);
    }
    return patchState(state, {
      phase: "await_block",
      responseQueue: [targetId],
      pendingClaim: null,
      revealSeatId: null,
      revealFollowUp: null,
    });
  }
  return continueUnresolvedAction(state, []);
}

function continueUnresolvedAction(
  state: MatchState,
  events: DomainEvent[],
): MatchState {
  const pending = state.pendingAction!;
  switch (pending.action.type) {
    case "tax":
      return resolveTax(state, events);
    case "foreign_aid":
      return resolveForeignAid(state, events);
    case "steal":
      return resolveSteal(state, events);
    case "exchange":
      return beginExchangeSelection(state);
    case "assassinate":
      return beginAssassinateReveal(state, events);
    default:
      return advanceTurn(patchState(state, clearTurnEphemera()), events);
  }
}

function afterActionChallengeSurvived(
  state: MatchState,
  events: DomainEvent[],
): MatchState {
  const pending = state.pendingAction!;
  if (
    pending.action.type === "foreign_aid" ||
    pending.action.type === "assassinate" ||
    pending.action.type === "steal"
  ) {
    return openBlockWindow(state);
  }
  return continueUnresolvedAction(state, events);
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

  const finished = finishIfSoleSurvivor(next, events);
  if (finished) {
    return finished;
  }

  const followUp = next.revealFollowUp;
  next = patchState(next, { revealFollowUp: null, revealSeatId: null });

  switch (followUp) {
    case "coup_done":
    case "assassinate_target":
      return advanceTurn(patchState(next, clearTurnEphemera()), events);
    case "action_claim_proven":
      return afterActionChallengeSurvived(next, events);
    case "action_claim_conceded":
      return failAction(next, events, "challenged", true);
    case "block_claim_proven":
      return failAction(next, events, "blocked", false);
    case "block_claim_conceded":
      return continueUnresolvedAction(next, events);
    default:
      return advanceTurn(patchState(next, clearTurnEphemera()), events);
  }
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

function applyExchangeReturn(
  state: MatchState,
  returnCardIds: [string, string],
  events: DomainEvent[],
): MatchState {
  const pending = state.pendingExchange!;
  const returnSet = new Set(returnCardIds);
  const kept = pending.hand.filter((card) => !returnSet.has(card.cardId));
  const returned = pending.hand.filter((card) => returnSet.has(card.cardId));
  const actor = findSeat(state, pending.seatId)!;
  const revealed = actor.influences.filter((card) => card.revealed);
  const seats = state.seats.map((seat) =>
    seat.seatId === pending.seatId
      ? { ...seat, influences: [...revealed, ...kept] }
      : seat,
  );
  const random = mulberry32(
    hashSeed(
      `${state.seed}:exchange:${state.stateVersion}:${returnCardIds.join(",")}`,
    ),
  );
  const courtDeck = shuffle(
    [...state.courtDeck, ...returned.map((card) => ({ ...card, revealed: false }))],
    random,
  );
  events.push({
    type: "action_resolved",
    seatId: pending.seatId,
    actionType: "exchange",
  });
  return advanceTurn(
    patchState(state, {
      seats,
      courtDeck,
      ...clearTurnEphemera(),
    }),
    events,
  );
}

function beginActionChallenge(
  state: MatchState,
  actorSeatId: string,
  action: ActionDeclaration,
  feePaid = 0,
): MatchState {
  let seats = state.seats;
  if (feePaid > 0) {
    seats = seats.map((seat) =>
      seat.seatId === actorSeatId
        ? { ...seat, coins: seat.coins - feePaid }
        : seat,
    );
  }
  return patchState(state, {
    seats,
    phase: "await_action_challenge",
    pendingAction: {
      actorSeatId,
      action,
      feePaid: feePaid > 0 ? feePaid : undefined,
    },
    responseQueue: clockwiseResponders(state, actorSeatId),
    pendingClaim: null,
    revealSeatId: null,
    revealFollowUp: null,
    pendingExchange: null,
  });
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
    case "choose_exchange_cards":
      return {
        type: "choose_exchange_cards",
        returnCardIds: command.returnCardIds,
      };
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
      const targetSeatId = actionTargetSeatId(command.action);
      events.push({
        type: "action_declared",
        seatId: command.seatId,
        actionType: command.action.type,
        ...(targetSeatId ? { targetSeatId } : {}),
      });

      if (command.action.type === "income") {
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
        next = patchState(working, {
          phase: "await_block",
          pendingAction: {
            actorSeatId: command.seatId,
            action: command.action,
          },
          responseQueue: clockwiseResponders(working, command.seatId),
          pendingClaim: null,
          revealSeatId: null,
          revealFollowUp: null,
          pendingExchange: null,
        });
        break;
      }

      if (command.action.type === "coup") {
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

      if (command.action.type === "assassinate") {
        next = beginActionChallenge(
          working,
          command.seatId,
          command.action,
          ASSASSINATE_COST,
        );
        break;
      }

      next = beginActionChallenge(working, command.seatId, command.action);
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
          ? continueUnresolvedAction(
              patchState(working, { responseQueue: [] }),
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
      if (remaining.length > 0) {
        next = patchState(working, { responseQueue: remaining });
        break;
      }
      if (working.phase === "await_action_challenge") {
        next = afterActionChallengeSurvived(
          patchState(working, { responseQueue: [] }),
          events,
        );
        break;
      }
      // Block challenge window fully passed → block succeeds
      next = failAction(
        patchState(working, { responseQueue: [] }),
        events,
        "blocked",
        false,
      );
      break;
    }

    case "challenge_claim": {
      if (working.phase === "await_action_challenge") {
        const claimCharacter =
          ACTION_CLAIMS[working.pendingAction!.action.type];
        if (!claimCharacter) {
          return { ok: false, reason: "illegal_decision" };
        }
        events.push({
          type: "challenge_declared",
          seatId: command.seatId,
          againstSeatId: working.pendingAction!.actorSeatId,
        });
        next = patchState(working, {
          phase: "await_claim_defense",
          responseQueue: [],
          pendingClaim: {
            seatId: working.pendingAction!.actorSeatId,
            character: claimCharacter,
            challengerSeatId: command.seatId,
            kind: "action",
          },
        });
        break;
      }

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
          kind: "block",
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
        revealFollowUp:
          claim.kind === "action" ? "action_claim_proven" : "block_claim_proven",
      });
      break;
    }

    case "concede_claim": {
      const claim = working.pendingClaim!;
      events.push({ type: "claim_conceded", seatId: command.seatId });
      if (claim.kind === "action") {
        next = patchState(working, {
          phase: "await_influence_reveal",
          revealSeatId: claim.seatId,
          pendingClaim: null,
          revealFollowUp: "action_claim_conceded",
        });
        break;
      }
      next = patchState(working, {
        phase: "await_influence_reveal",
        revealSeatId: claim.seatId,
        pendingClaim: null,
        revealFollowUp: "block_claim_conceded",
        pendingAction: {
          actorSeatId: working.pendingAction!.actorSeatId,
          action: working.pendingAction!.action,
          feePaid: working.pendingAction!.feePaid,
        },
      });
      break;
    }

    case "choose_influence_to_reveal":
      next = applyReveal(working, command.seatId, command.cardId, events);
      break;

    case "choose_exchange_cards":
      next = applyExchangeReturn(working, command.returnCardIds, events);
      break;
  }

  return { ok: true, state: commit(next), events };
}
