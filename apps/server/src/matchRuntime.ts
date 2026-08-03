import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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
  createAgentRuntime,
  isLegalDecisionListed,
  type AgentRuntime,
} from "./agents/index.js";
import {
  defaultAgentDisplayName,
  type CliKind,
  type MatchSetupSeatInput,
} from "./matchSetup.js";

export type SeatAgentConfig = {
  cli: CliKind;
  modelId: string | null;
};

export type ActiveMatch = {
  state: MatchState;
  events: DomainEvent[];
  humanSeatId: string;
  displayNames: Record<string, string>;
  seatAgents: Record<string, SeatAgentConfig>;
  /** Per-seat isolated cwd for CLI sessions. */
  seatWorkspaces: Record<string, string>;
};

export type MatchRuntimeOptions = {
  agentRuntime?: AgentRuntime;
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

function agentConfigFor(
  match: ActiveMatch,
  seatId: string,
): SeatAgentConfig {
  return match.seatAgents[seatId] ?? { cli: "stub", modelId: null };
}

/** Stub always picks the first enumerated legal decision. */
export function pickStubDecision(match: ActiveMatch, seatId: string) {
  const legal = legalDecisionsFor(match.state, seatId);
  return legal[0] ?? null;
}

function applySeatDecision(
  match: ActiveMatch,
  seatId: string,
  decision: LegalDecision,
): ActiveMatch {
  const result = applyCommand(
    match.state,
    decisionToCommand(seatId, decision, match.state.stateVersion),
  );
  if (!result.ok) {
    throw new Error(`agent illegal decision: ${result.reason}`);
  }
  return {
    ...match,
    state: result.state,
    events: [...match.events, ...result.events],
  };
}

async function ensureSeatWorkspace(
  match: ActiveMatch,
  seatId: string,
): Promise<string> {
  const existing = match.seatWorkspaces[seatId];
  if (existing) return existing;
  const dir = await mkdtemp(path.join(tmpdir(), `coup-${seatId}-`));
  match.seatWorkspaces[seatId] = dir;
  return dir;
}

export async function advanceAgentSeats(
  match: ActiveMatch,
  options: MatchRuntimeOptions = {},
): Promise<ActiveMatch> {
  const runtime = options.agentRuntime ?? createAgentRuntime();
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

    const config = agentConfigFor(current, seat.seatId);
    if (config.cli === "stub") {
      const decision = pickStubDecision(current, seat.seatId);
      if (!decision) {
        return current;
      }
      current = applySeatDecision(current, seat.seatId, decision);
      continue;
    }

    const view = toSeatView(current, seat.seatId);
    const cwd = await ensureSeatWorkspace(current, seat.seatId);
    const adapter = runtime.getAdapter(config.cli);
    const seatDecision = await adapter.decide({
      view,
      modelId: config.modelId,
      cwd,
    });

    if (seatDecision.protocolVersion !== 1) {
      throw new Error("agent_unsupported_protocol");
    }
    if (seatDecision.requestId !== view.requestId) {
      throw new Error("agent_request_id_mismatch");
    }
    if (seatDecision.stateVersion !== current.state.stateVersion) {
      throw new Error("agent_version_mismatch");
    }
    if (
      !isLegalDecisionListed(view.legalDecisions, seatDecision.decision)
    ) {
      throw new Error("agent_decision_not_legal");
    }

    current = applySeatDecision(current, seat.seatId, seatDecision.decision);
  }
  throw new Error("agent advance exceeded guard");
}

export async function startMatch(
  options?: {
    matchId?: string;
    seed?: string;
    seats?: MatchSetupSeatInput[];
  } & MatchRuntimeOptions,
): Promise<ActiveMatch> {
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
        cli: "stub",
        modelId: "stub/placeholder",
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
  const seatAgents: Record<string, SeatAgentConfig> = {};
  for (const seat of seats) {
    displayNames[seat.seatId] = seat.displayName;
    if (seat.controller === "stub_agent") {
      seatAgents[seat.seatId] = {
        cli: seat.cli ?? "stub",
        modelId: seat.modelId ?? null,
      };
    }
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
    seatAgents,
    seatWorkspaces: {},
  };
  return advanceAgentSeats(match, { agentRuntime: options?.agentRuntime });
}

/** @deprecated Prefer startMatch; kept for existing two-seat runtime tests. */
export async function startTwoSeatMatch(options?: {
  matchId?: string;
  seed?: string;
  agentRuntime?: AgentRuntime;
}): Promise<ActiveMatch> {
  return startMatch(options);
}

export async function submitHumanDecision(
  match: ActiveMatch,
  decision: SeatDecision,
  options: MatchRuntimeOptions = {},
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
  return {
    ok: true,
    match: await advanceAgentSeats(updated, options),
  };
}
