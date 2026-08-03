import type {
  CharacterId,
  DomainEvent,
  LegalDecision,
  MatchPhase,
  MatchStatus,
  SeatController,
} from "@coup/domain";

export type ProtocolVersion = 1;

export type PublicSeatView = {
  seatId: string;
  controller: SeatController;
  displayName: string;
  coins: number;
  eliminated: boolean;
  revealedCharacters: CharacterId[];
  influenceCount: number;
};

export type PrivateSeatState = {
  hiddenCharacters: CharacterId[];
};

export type MatchPublicState = {
  matchId: string;
  status: MatchStatus;
  stateVersion: number;
  phase: MatchPhase;
  currentSeatId: string;
  seats: PublicSeatView[];
};

/** Wire projection for one seat — ticket 13 subset. */
export type SeatView = {
  protocolVersion: ProtocolVersion;
  requestId: string;
  matchId: string;
  stateVersion: number;
  seatId: string;
  publicState: MatchPublicState;
  privateState: PrivateSeatState;
  projectedHistory: DomainEvent[];
  legalDecisions: LegalDecision[];
};

export type SeatDecision = {
  protocolVersion: ProtocolVersion;
  requestId: string;
  stateVersion: number;
  decision: LegalDecision;
};

export type {
  CharacterId,
  DomainEvent,
  LegalDecision,
  MatchPhase,
  MatchStatus,
  SeatController,
};
