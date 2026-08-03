import type {
  CharacterId,
  DomainEvent,
  LegalDecision,
  MatchPhase,
  MatchStatus,
  PendingAction,
  SeatController,
  BlockCharacter,
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
  /** Present only for the exchanging seat during await_exchange_selection. */
  exchangeHand: Array<{ cardId: string; character: CharacterId }> | null;
};

export type MatchPublicState = {
  matchId: string;
  status: MatchStatus;
  stateVersion: number;
  phase: MatchPhase;
  currentSeatId: string;
  activeSeatId: string | null;
  pendingAction: PendingAction | null;
  seats: PublicSeatView[];
};

/** Wire projection for one seat. */
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
  PendingAction,
  SeatController,
  BlockCharacter,
};
