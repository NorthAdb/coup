import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import type { SeatDecision } from "@coup/protocol";
import { createAgentRuntime, type AgentRuntime } from "./agents/index.js";
import {
  startMatch,
  submitHumanDecision,
  toSeatView,
  type ActiveMatch,
} from "./matchRuntime.js";
import { parseMatchSetup } from "./matchSetup.js";

export type CreateAppOptions = {
  webRoot: string;
  agentRuntime?: AgentRuntime;
};

export async function createApp(options: CreateAppOptions) {
  const app = Fastify({ logger: false });
  let activeMatch: ActiveMatch | null = null;
  const agentRuntime = options.agentRuntime ?? createAgentRuntime();

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

    try {
      activeMatch = await startMatch({
        seats: parsed.setup.seats,
        agentRuntime,
      });
    } catch (error) {
      return reply.code(502).send({
        error:
          error instanceof Error ? error.message : "agent_start_failed",
      });
    }
    const view = toSeatView(activeMatch, activeMatch.humanSeatId);
    return reply.send({ view });
  });

  app.get("/api/matches/current", async (_request, reply) => {
    if (!activeMatch) {
      return reply.code(404).send({ error: "no_active_match" });
    }
    return reply.send({
      view: toSeatView(activeMatch, activeMatch.humanSeatId),
    });
  });

  app.post("/api/matches/current/decision", async (request, reply) => {
    if (!activeMatch) {
      return reply.code(404).send({ error: "no_active_match" });
    }
    const body = request.body as SeatDecision;
    let result: Awaited<ReturnType<typeof submitHumanDecision>>;
    try {
      result = await submitHumanDecision(activeMatch, body, { agentRuntime });
    } catch (error) {
      return reply.code(502).send({
        error:
          error instanceof Error ? error.message : "agent_decision_failed",
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
