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
  ]);
  if (known.has(message)) return message;
  if (message.startsWith("agent ")) {
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

  async function advanceActiveOrAbort(
    match: ActiveMatch,
  ): Promise<
    | { ok: true; match: ActiveMatch }
    | { ok: false; matchId: string; error: string }
  > {
    try {
      const next = await advanceAgentSeats(match, {
        agentRuntime,
        persistence,
      });
      return { ok: true, match: next };
    } catch (error) {
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
      try {
        activeMatch = await advanceAgentSeats(activeMatch, {
          agentRuntime,
          persistence,
        });
      } catch (error) {
        store.technicalAbort(activeMatch.state.matchId, abortReasonFrom(error));
        activeMatch = null;
        return reply.code(502).send({
          error:
            error instanceof Error ? error.message : "agent_resume_failed",
          aborted: true,
          matchId: resumed.matchId,
        });
      }
      return reply.send({
        view: toSeatView(activeMatch, activeMatch.humanSeatId),
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
      activeMatch = await startMatch({
        seats: parsed.setup.seats,
        agentRuntime,
        persistence,
      });
    } catch (error) {
      const startedId = store.findResumableRun()?.matchId;
      if (startedId) {
        store.technicalAbort(startedId, abortReasonFrom(error));
      }
      activeMatch = null;
      return reply.code(502).send({
        error:
          error instanceof Error ? error.message : "agent_start_failed",
        aborted: Boolean(startedId),
        matchId: startedId ?? null,
      });
    }
    const view = toSeatView(activeMatch, activeMatch.humanSeatId);
    return reply.send({ view });
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
      view: toSeatView(activeMatch, activeMatch.humanSeatId),
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
      result = await submitHumanDecision(activeMatch, body, {
        agentRuntime,
        persistence,
      });
    } catch (error) {
      const run = store.getRun(matchId);
      if (run && run.runStatus === "in_progress") {
        store.technicalAbort(matchId, abortReasonFrom(error));
      }
      activeMatch = null;
      return reply.code(502).send({
        error:
          error instanceof Error ? error.message : "agent_decision_failed",
        aborted: true,
        matchId,
      });
    }
    if (!result.ok) {
      return reply.code(409).send({ error: result.reason });
    }
    activeMatch = result.match;
    return reply.send({
      view: toSeatView(activeMatch, activeMatch.humanSeatId, body.requestId),
    });
  });

  await app.register(fastifyStatic, {
    root: options.webRoot,
  });

  return app;
}
