import path from "node:path";
import { homedir, networkInterfaces } from "node:os";
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
  pendingAgentSeatIds,
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
import {
  listLanIpv4Candidates,
  pickDefaultLanIpv4,
  type NetIfaceMap,
} from "./lanAddresses.js";
import {
  createRoomRegistry,
  roomInvitePayload,
  type RoomRegistry,
} from "./roomRegistry.js";

export type BindMode = "local" | "host";

export type HostingState = {
  bindMode: BindMode;
  listenHost: string;
  port: number;
};

export type HostingController = {
  getState(): HostingState;
  ensureHostMode(): Promise<HostingState & { bindMode: "host" }>;
};

export type CreateAppOptions = {
  webRoot: string;
  agentRuntime?: AgentRuntime;
  /** Override capability probing (tests / fixtures). */
  probe?: (options?: CapabilityProbeOptions) => Promise<CapabilityReport>;
  /** SQLite path; defaults to ~/.coup/coup.sqlite. */
  dbPath?: string;
  /** Inject an already-open store (tests). */
  store?: MatchStore;
  /** LAN host bind / rebind control (omit in pure inject tests that stub it). */
  hosting?: HostingController;
  listNetworkInterfaces?: () => NetIfaceMap;
  rooms?: RoomRegistry;
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
  const rooms = options.rooms ?? createRoomRegistry();
  const listIfaces = options.listNetworkInterfaces ?? networkInterfaces;
  let selectedLanHost: string | null = null;

  const resumable = store.findResumableRun();
  let activeMatch: ActiveMatch | null = resumable
    ? activeMatchFromRun(resumable)
    : null;
  let agentPhase: AgentDecisionPhase | "idle" = "idle";
  let agentSeatId: string | null = null;
  let thinkingSeatIds: string[] = [];

  function lanSnapshot(port: number, code: string) {
    const candidates = listLanIpv4Candidates(listIfaces() as NetIfaceMap);
    const addresses = candidates.map((c) => c.address);
    if (selectedLanHost && !addresses.includes(selectedLanHost)) {
      selectedLanHost = null;
    }
    const lanHost =
      selectedLanHost ?? pickDefaultLanIpv4(candidates);
    selectedLanHost = lanHost;
    const room = rooms.getByCode(code);
    if (!room) return null;
    return {
      ...roomInvitePayload({
        room,
        lanHost,
        port,
        candidates: addresses,
      }),
      bindMode: options.hosting?.getState().bindMode ?? "local",
      lanOrigin: lanHost ? `http://${lanHost}:${port}` : null,
    };
  }

  function runtimeOptions() {
    return {
      agentRuntime,
      persistence,
      onAgentPhase: (phase: AgentDecisionPhase, seatId?: string) => {
        agentPhase = phase;
        if (seatId !== undefined) {
          agentSeatId = seatId;
        }
      },
      onMatchAdvanced: (match: ActiveMatch) => {
        thinkingSeatIds = pendingAgentSeatIds(match);
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
    agentSeatId = null;
    thinkingSeatIds = pendingAgentSeatIds(match);
    try {
      const next = await advanceAgentSeats(match, runtimeOptions());
      agentPhase = "idle";
      agentSeatId = null;
      thinkingSeatIds = [];
      return { ok: true, match: next };
    } catch (error) {
      agentPhase = "failed";
      thinkingSeatIds = [];
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

  app.get("/api/hosting", async (_request, reply) => {
    const state = options.hosting?.getState() ?? {
      bindMode: "local" as const,
      listenHost: "127.0.0.1",
      port: 0,
    };
    const candidates = listLanIpv4Candidates(listIfaces() as NetIfaceMap);
    return reply.send({
      ...state,
      candidates: candidates.map((c) => c.address),
      selectedHost: selectedLanHost ?? pickDefaultLanIpv4(candidates),
    });
  });

  app.post("/api/hosting/enter", async (_request, reply) => {
    if (!options.hosting) {
      return reply.code(500).send({ error: "hosting_unavailable" });
    }
    const candidates = listLanIpv4Candidates(listIfaces() as NetIfaceMap);
    const addresses = candidates.map((c) => c.address);
    const current = options.hosting.getState();
    if (current.bindMode === "host") {
      return reply.send({
        status: "ready",
        ...current,
        candidates: addresses,
        selectedHost: selectedLanHost ?? pickDefaultLanIpv4(candidates),
      });
    }

    const preferredPort = 8787;
    // LAN origins first — host should land on LAN Origin, not loopback.
    const retryOrigins = [
      ...addresses.map((ip) => `http://${ip}:${preferredPort}`),
      `http://127.0.0.1:${preferredPort}`,
    ];
    // Flush response before rebinding — server.close() waits for in-flight requests.
    const payload = {
      status: "rebinding" as const,
      preferredPort,
      candidates: addresses,
      retryOrigins,
    };
    void reply.then(
      () => {
        queueMicrotask(() => {
          void options.hosting?.ensureHostMode().catch(() => {
            /* bind errors surface on next client poll */
          });
        });
      },
      () => undefined,
    );
    return reply.send(payload);
  });

  app.post("/api/rooms", async (_request, reply) => {
    if (!options.hosting) {
      return reply.code(500).send({ error: "hosting_unavailable" });
    }
    const hostState = options.hosting.getState();
    if (hostState.bindMode !== "host") {
      return reply.code(409).send({ error: "need_host_mode" });
    }

    const candidates = listLanIpv4Candidates(listIfaces() as NetIfaceMap);
    const addresses = candidates.map((c) => c.address);
    const lanHost = selectedLanHost ?? pickDefaultLanIpv4(candidates);
    if (!lanHost) {
      return reply.code(400).send({ error: "no_lan_ipv4" });
    }
    selectedLanHost = lanHost;

    // One active room for now (spec: single room).
    for (const code of rooms.listCodes()) {
      rooms.dissolve(code);
    }
    const room = rooms.create();
    const payload = roomInvitePayload({
      room,
      lanHost,
      port: hostState.port,
      candidates: addresses,
    });
    return reply.send({
      ...payload,
      bindMode: hostState.bindMode,
      lanOrigin: `http://${lanHost}:${hostState.port}`,
    });
  });

  app.get<{ Params: { code: string } }>(
    "/api/rooms/:code",
    async (request, reply) => {
      const room = rooms.getByCode(request.params.code);
      if (!room) {
        return reply.code(404).send({ error: "room_not_found" });
      }
      const state = options.hosting?.getState();
      const port = state?.port ?? 0;
      const snap = lanSnapshot(port, room.code);
      return reply.send(snap);
    },
  );

  app.patch<{
    Params: { code: string };
    Body: { selectedHost?: string };
  }>("/api/rooms/:code", async (request, reply) => {
    const room = rooms.getByCode(request.params.code);
    if (!room) {
      return reply.code(404).send({ error: "room_not_found" });
    }
    const candidates = listLanIpv4Candidates(listIfaces() as NetIfaceMap);
    const addresses = candidates.map((c) => c.address);
    const nextHost = request.body?.selectedHost;
    if (!nextHost || !addresses.includes(nextHost)) {
      return reply.code(400).send({ error: "invalid_lan_host" });
    }
    selectedLanHost = nextHost;
    const port = options.hosting?.getState().port ?? 0;
    const snap = lanSnapshot(port, room.code);
    return reply.send(snap);
  });

  app.get("/api/matches", async (_request, reply) => {
    return reply.send({ matches: store.listRuns() });
  });

  app.get("/api/matches/current/agent-phase", async (_request, reply) => {
    return reply.send({
      phase: agentPhase,
      seatId: agentSeatId,
      thinkingSeatIds,
    });
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
      agentSeatId = null;
      thinkingSeatIds = pendingAgentSeatIds(activeMatch);
      try {
        activeMatch = await advanceAgentSeats(activeMatch, runtimeOptions());
        agentPhase = "idle";
        agentSeatId = null;
        thinkingSeatIds = [];
      } catch (error) {
        agentPhase = "failed";
        thinkingSeatIds = [];
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
      agentSeatId = null;
      thinkingSeatIds = [];
      activeMatch = await startMatch({
        seats: parsed.setup.seats,
        ...runtimeOptions(),
      });
      agentPhase = "idle";
      agentSeatId = null;
      thinkingSeatIds = [];
    } catch (error) {
      agentPhase = "failed";
      thinkingSeatIds = [];
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
      agentSeatId = null;
      thinkingSeatIds = [];
      result = await submitHumanDecision(activeMatch, body, runtimeOptions());
      agentPhase = "idle";
      agentSeatId = null;
      thinkingSeatIds = [];
    } catch (error) {
      agentPhase = "failed";
      thinkingSeatIds = [];
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

  app.setNotFoundHandler(async (request, reply) => {
    if (request.method === "GET" && !request.url.startsWith("/api")) {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({ error: "not_found" });
  });

  return app;
}
