export type CharacterId =
  | "duke"
  | "assassin"
  | "captain"
  | "ambassador"
  | "contessa";

export type SeatController = "local_human" | "stub_agent";

export type MatchStatus = "in_progress" | "finished" | "aborted";

export type MatchPhase = "await_action";

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
};

export type ActionDeclaration = {
  type: "income";
};

export type DomainCommand = {
  type: "declare_action";
  expectedVersion: number;
  seatId: string;
  action: ActionDeclaration;
};

export type LegalDecision = {
  type: "declare_action";
  action: ActionDeclaration;
};

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
      actionType: "income";
    }
  | {
      type: "action_resolved";
      seatId: string;
      actionType: "income";
      coinsGained: number;
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

export function legalDecisionsFor(
  state: MatchState,
  seatId: string,
): LegalDecision[] {
  if (state.status !== "in_progress") {
    return [];
  }
  if (state.phase !== "await_action") {
    return [];
  }
  if (state.currentSeatId !== seatId) {
    return [];
  }
  const seat = findSeat(state, seatId);
  if (!seat || seat.eliminated) {
    return [];
  }
  return [{ type: "declare_action", action: { type: "income" } }];
}

export type SeatProjection = {
  matchId: string;
  stateVersion: number;
  seatId: string;
  status: MatchStatus;
  phase: MatchPhase;
  currentSeatId: string;
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

  if (command.type !== "declare_action") {
    return { ok: false, reason: "unsupported_command" };
  }

  const legal = legalDecisionsFor(state, command.seatId);
  const allowed = legal.some(
    (decision) =>
      decision.type === "declare_action" &&
      decision.action.type === command.action.type,
  );
  if (!allowed) {
    return { ok: false, reason: "illegal_decision" };
  }

  const seats = state.seats.map((seat) =>
    seat.seatId === command.seatId
      ? { ...seat, coins: seat.coins + 1 }
      : seat,
  );
  const nextSeatId = nextLivingSeatId(state, command.seatId);

  const nextState: MatchState = {
    ...state,
    stateVersion: state.stateVersion + 1,
    seats,
    currentSeatId: nextSeatId,
    phase: "await_action",
  };

  const events: DomainEvent[] = [
    {
      type: "action_declared",
      seatId: command.seatId,
      actionType: "income",
    },
    {
      type: "action_resolved",
      seatId: command.seatId,
      actionType: "income",
      coinsGained: 1,
    },
    {
      type: "turn_advanced",
      seatId: nextSeatId,
    },
  ];

  return { ok: true, state: nextState, events };
}
