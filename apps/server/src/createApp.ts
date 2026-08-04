import path from "node:path";
import { homedir } from "node:os";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import type { SeatDecision } from "@coup/protocol";
import { createAgentRuntime, type AgentRuntime } from "./agents/index.js";
import { createProcessCliRunner } from "./agents/cliRunner.js";
import {
  probeCapabilities,
  recheckSetupSeats,
  sanitizeCapabilityReport,
  type CapabilityProbeOptions,
  type CapabilityReport,
} from "./capabilityProbe.js";
import {
  advanceAgentSeats,
  startMatch,
  submitHumanDecision,
  toSeatView,
  type ActiveMatch,
  type MatchPersistence,
} from "./matchRuntime.js";
import type { AgentDecisionPhase } from "./agentDecision.js";
import { parseMatchSetup } from "./matchSetup.js";
import {
  openMatchStore,
  type MatchRunRecord,
  type MatchStore,
} from "./matchStore.js";

export type CreateAppOptions = {
  webRoot: string;
  agentRuntime?: AgentRuntime;
  /** Override capability probing (tests / fixtures). */
  probe?: (options?: CapabilityProbeOptions) => Promise<CapabilityReport>;
  /** SQLite path; defaults to ~/.coup/coup.sqlite. */
  dbPath?: string;
  /** Inject an already-open store (tests). */
  store?: MatchStore;
};

function defaultDbPath() {
  return path.join(homedir(), ".coup", "coup.sqlite");
}

export function activeMatchFromRun(run: MatchRunRecord): ActiveMatch {
  return {
    state: run.state,
    events: run.events,
    humanSeatId: run.humanSeatId,
    displayNames: run.displayNames,
    seatAgents: run.seatAgents,
    seatWorkspaces: {},
    decisionRationales: {},
  };
}

function humanFacingPayload(match: ActiveMatch, requestId?: string) {
  return {
    view: toSeatView(match, match.humanSeatId, requestId),
    decisionRationales: match.decisionRationales,
  };
}

export function persistenceForStore(store: MatchStore): MatchPersistence {
  return {
    onCreated(match) {
      const existing = store.findResumableRun();
      if (existing && existing.matchId !== match.state.matchId) {
        store.userAbort(existing.matchId);
      }
      store.createRun({
        matchId: match.state.matchId,
        humanSeatId: match.humanSeatId,
        displayNames: match.displayNames,
        seatAgents: match.seatAgents,
        state: match.state,
        events: match.events,
      });
    },
    onCommitted(match, newEvents) {
      if (newEvents.length === 0) return;
      store.commitCommand(match.state.matchId, match.state, newEvents);
    },
  };
}

function abortReasonFrom(error: unknown): string {
  if (!(error instanceof Error) || !error.message) {
    return "agent_failed";
  }
  const message = error.message;
  const colon = message.indexOf(":");
  const head = (colon >= 0 ? message.slice(0, colon) : message).trim();
  const known = new Set([
    "agent_unsupported_protocol",
    "agent_request_id_mismatch",
    "agent_version_mismatch",
    "agent_decision_not_legal",
    "agent_advance_exceeded_guard",
    "agent_start_failed",
    "agent_resume_failed",
    "agent_decision_failed",
    "agent_illegal_decision",
    "agent_timeout",
    "agent_cli_not_installed",
    "agent_cli_unsupported",
    "agent_auth_failed",
    "agent_credentials_missing",
    "agent_billing_unavailable",
    "agent_model_unavailable",
    "agent_model_forbidden",
    "agent_tools_not_denied",
    "agent_tool_permission_requested",
    "agent_isolation_violated",
    "agent_persist_failed",
    "agent_empty_output",
    "agent_invalid_json",
    "agent_schema_mismatch",
    "agent_subprocess_exited",
    "agent_session_error",
    "agent_rate_limited",
    "agent_provider_transient",
  ]);
  if (known.has(head)) return head;
  if (known.has(message)) return message;
  if (
    head.startsWith("opencode_") ||
    head.startsWith("claude_") ||
    message.startsWith("agent ")
  ) {
    return "agent_failed";
  }
  // Never persist raw CLI/model text — only a stable category token.
  return "agent_failed";
}

export async function createApp(options: CreateAppOptions) {
  const app = Fastify({ logger: false });
  const store =
    options.store ?? openMatchStore(options.dbPath ?? defaultDbPath());
  const persistence = persistenceForStore(store);
  const agentRuntime = options.agentRuntime ?? createAgentRuntime();
  const runProbe =
    options.probe ??
    (() => probeCapabilities({ runner: createProcessCliRunner() }));

  const resumable = store.findResumableRun();
  let activeMatch: ActiveMatch | null = resumable
    ? activeMatchFromRun(resumable)
    : null;
  let agentPhase: AgentDecisionPhase | "idle" = "idle";

  function runtimeOptions() {
    return {
      agentRuntime,
      persistence,
      onAgentPhase: (phase: AgentDecisionPhase) => {
        agentPhase = phase;
      },
    };
  }

  async function advanceActiveOrAbort(
    match: ActiveMatch,
  ): Promise<
    | { ok: true; match: ActiveMatch }
    | { ok: false; matchId: string; error: string }
  > {
    agentPhase = "thinking";
    try {
      const next = await advanceAgentSeats(match, runtimeOptions());
      agentPhase = "idle";
      return { ok: true, match: next };
    } catch (error) {
      agentPhase = "failed";
      const matchId = match.state.matchId;
      const run = store.getRun(matchId);
      if (run && run.runStatus === "in_progress") {
        store.technicalAbort(matchId, abortReasonFrom(error));
      }
      return {
        ok: false,
        matchId,
        error: abortReasonFrom(error),
      };
    }
  }

  app.addHook("onClose", async () => {
    store.close();
  });

  app.get("/api/capabilities", async (_request, reply) => {
    const report = sanitizeCapabilityReport(await runProbe());
    return reply.send(report);
  });

  app.get("/api/matches", async (_request, reply) => {
    return reply.send({ matches: store.listRuns() });
  });

  app.get("/api/matches/current/agent-phase", async (_request, reply) => {
    return reply.send({ phase: agentPhase });
  });

  app.get<{ Params: { matchId: string } }>(
    "/api/matches/:matchId/events",
    async (request, reply) => {
      const run = store.getRun(request.params.matchId);
      if (!run) {
        return reply.code(404).send({ error: "match_not_found" });
      }
      return reply.send({
        matchId: run.matchId,
        runStatus: run.runStatus,
        winnerSeatId: run.winnerSeatId,
        events: store.listEvents(run.matchId),
      });
    },
  );

  app.post<{ Params: { matchId: string } }>(
    "/api/matches/:matchId/resume",
    async (request, reply) => {
      const source = store.getRun(request.params.matchId);
      if (!source) {
        return reply.code(404).send({ error: "match_not_found" });
      }
      if (
        source.runStatus !== "technical_abort"
      ) {
        return reply.code(409).send({ error: "match_not_resumable" });
      }

      const existing = store.findResumableRun();
      if (existing) {
        store.userAbort(existing.matchId);
      }

      const resumed = store.createResumeRun(
        source.matchId,
        `match-${Date.now()}`,
      );
      activeMatch = activeMatchFromRun(resumed);
      agentPhase = "thinking";
      try {
        activeMatch = await advanceAgentSeats(activeMatch, runtimeOptions());
        agentPhase = "idle";
      } catch (error) {
        agentPhase = "failed";
        store.technicalAbort(activeMatch.state.matchId, abortReasonFrom(error));
        activeMatch = null;
        return reply.code(502).send({
          error: abortReasonFrom(error),
          aborted: true,
          matchId: resumed.matchId,
        });
      }
      return reply.send({
        ...humanFacingPayload(activeMatch),
        resumedFromMatchId: source.matchId,
      });
    },
  );

  app.post("/api/matches", async (request, reply) => {
    const body =
      request.body === undefined || request.body === null
        ? {
            seats: [
              {
                seatId: "seat-human",
                controller: "local_human",
                displayName: "你",
              },
              {
                seatId: "seat-stub",
                controller: "stub_agent",
                displayName: "灰狐",
                cli: "stub",
                modelId: "stub/placeholder",
              },
            ],
          }
        : request.body;

    const parsed = parseMatchSetup(body);
    if (!parsed.ok) {
      return reply.code(400).send({ error: parsed.reason });
    }

    const report = await runProbe();
    const gate = recheckSetupSeats(parsed.setup.seats, report);
    if (!gate.ok) {
      return reply.code(400).send({
        error: gate.reason,
        hint: gate.hint,
      });
    }

    try {
      agentPhase = "thinking";
      activeMatch = await startMatch({
        seats: parsed.setup.seats,
        ...runtimeOptions(),
      });
      agentPhase = "idle";
    } catch (error) {
      agentPhase = "failed";
      const startedId = store.findResumableRun()?.matchId;
      if (startedId) {
        store.technicalAbort(startedId, abortReasonFrom(error));
      }
      activeMatch = null;
      return reply.code(502).send({
        error: abortReasonFrom(error),
        aborted: Boolean(startedId),
        matchId: startedId ?? null,
      });
    }
    return reply.send(humanFacingPayload(activeMatch));
  });

  app.get("/api/matches/current", async (_request, reply) => {
    if (!activeMatch) {
      const again = store.findResumableRun();
      if (again) {
        activeMatch = activeMatchFromRun(again);
      }
    }
    if (!activeMatch) {
      return reply.code(404).send({ error: "no_active_match" });
    }

    const advanced = await advanceActiveOrAbort(activeMatch);
    if (!advanced.ok) {
      activeMatch = null;
      return reply.code(502).send({
        error: advanced.error,
        aborted: true,
        matchId: advanced.matchId,
      });
    }
    activeMatch = advanced.match;

    return reply.send({
      ...humanFacingPayload(activeMatch),
      matchId: activeMatch.state.matchId,
    });
  });

  app.post("/api/matches/current/decision", async (request, reply) => {
    if (!activeMatch) {
      return reply.code(404).send({ error: "no_active_match" });
    }
    const body = request.body as SeatDecision;
    const matchId = activeMatch.state.matchId;
    let result: Awaited<ReturnType<typeof submitHumanDecision>>;
    try {
      agentPhase = "thinking";
      result = await submitHumanDecision(activeMatch, body, runtimeOptions());
      agentPhase = "idle";
    } catch (error) {
      agentPhase = "failed";
      const run = store.getRun(matchId);
      if (run && run.runStatus === "in_progress") {
        store.technicalAbort(matchId, abortReasonFrom(error));
      }
      activeMatch = null;
      return reply.code(502).send({
        error: abortReasonFrom(error),
        aborted: true,
        matchId,
      });
    }
    if (!result.ok) {
      return reply.code(409).send({ error: result.reason });
    }
    activeMatch = result.match;
    return reply.send(humanFacingPayload(activeMatch, body.requestId));
  });

  await app.register(fastifyStatic, {
    root: options.webRoot,
  });

  return app;
}
