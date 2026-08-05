import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SeatDecision, SeatView } from "@coup/protocol";
import { createAgentRuntime } from "./agents/index.js";
import {
  pendingAgentSeatIds,
  startMatch,
  startTwoSeatMatch,
  submitHumanDecision,
  toSeatView,
  type ActiveMatch,
} from "./matchRuntime.js";
import { defaultAgentDisplayName } from "./matchSetup.js";

describe("stub match runtime", () => {
  it("starts a multi-seat match with clockwise agent display names", async () => {
    const started = await startMatch({
      matchId: "match-four",
      seed: "four-seed",
      seats: [
        {
          seatId: "seat-1",
          controller: "local_human",
          displayName: "你",
        },
        {
          seatId: "seat-2",
          controller: "stub_agent",
          displayName: defaultAgentDisplayName(0),
          cli: "stub",
        },
        {
          seatId: "seat-3",
          controller: "stub_agent",
          displayName: defaultAgentDisplayName(1),
          cli: "stub",
        },
        {
          seatId: "seat-4",
          controller: "stub_agent",
          displayName: defaultAgentDisplayName(2),
          cli: "stub",
        },
      ],
    });
    const view = toSeatView(started, started.humanSeatId);
    assert.equal(view.publicState.seats.length, 4);
    assert.equal(view.publicState.seats[0]?.displayName, "你");
    assert.equal(view.publicState.seats[1]?.displayName, "灰狐");
    assert.equal(view.publicState.seats[2]?.displayName, "白塔");
    assert.equal(view.publicState.seats[3]?.displayName, "夜枭");
    assert.equal(view.publicState.currentSeatId, "seat-1");
    assert.equal(view.publicState.seats[0]?.coins, 2);
  });

  it("projects public CLI and model ids onto agent seats (human has none)", async () => {
    const started = await startMatch({
      matchId: "match-labels",
      seed: "labels-seed",
      seats: [
        {
          seatId: "seat-1",
          controller: "local_human",
          displayName: "你",
        },
        {
          seatId: "seat-2",
          controller: "stub_agent",
          displayName: "灰狐",
          cli: "opencode",
          modelId: "openai/gpt-test",
        },
        {
          seatId: "seat-3",
          controller: "stub_agent",
          displayName: "白塔",
          cli: "stub",
          modelId: "stub/placeholder",
        },
      ],
      agentRuntime: createAgentRuntime({
        adapters: {
          opencode: {
            kind: "opencode",
            async decide(input) {
              return {
                protocolVersion: 1,
                requestId: input.view.requestId,
                stateVersion: input.view.stateVersion,
                decision: input.view.legalDecisions[0]!,
              };
            },
          },
        },
      }),
    });
    const view = toSeatView(started, started.humanSeatId);
    assert.deepEqual(
      {
        cli: view.publicState.seats[0]?.cli,
        modelId: view.publicState.seats[0]?.modelId,
      },
      { cli: null, modelId: null },
    );
    assert.deepEqual(
      {
        cli: view.publicState.seats[1]?.cli,
        modelId: view.publicState.seats[1]?.modelId,
      },
      { cli: "opencode", modelId: "openai/gpt-test" },
    );
    assert.deepEqual(
      {
        cli: view.publicState.seats[2]?.cli,
        modelId: view.publicState.seats[2]?.modelId,
      },
      { cli: "stub", modelId: "stub/placeholder" },
    );
  });

  it("keeps the latest decision rationale in match memory only", async () => {
    const agentRuntime = createAgentRuntime({
      adapters: {
        opencode: {
          kind: "opencode",
          async decide(input) {
            return {
              protocolVersion: 1,
              requestId: input.view.requestId,
              stateVersion: input.view.stateVersion,
              decision: input.view.legalDecisions[0]!,
              decisionRationale: "先攒点钱",
            };
          },
        },
      },
    });
    const started = await startMatch({
      matchId: "match-rationale",
      seed: "rationale-seed",
      seats: [
        {
          seatId: "seat-1",
          controller: "local_human",
          displayName: "你",
        },
        {
          seatId: "seat-2",
          controller: "stub_agent",
          displayName: "灰狐",
          cli: "opencode",
          modelId: "openai/gpt-test",
        },
      ],
      agentRuntime,
    });

    const afterHuman = await submitHumanDecision(
      started,
      {
        protocolVersion: 1,
        requestId: "req-human-r1",
        stateVersion: started.state.stateVersion,
        decision: { type: "declare_action", action: { type: "income" } },
      },
      { agentRuntime },
    );
    assert.equal(afterHuman.ok, true);
    if (!afterHuman.ok) return;

    assert.equal(
      afterHuman.match.decisionRationales["seat-1"]?.source,
      "template",
    );
    assert.equal(
      afterHuman.match.decisionRationales["seat-2"]?.text,
      "先攒点钱",
    );
    assert.equal(
      afterHuman.match.decisionRationales["seat-2"]?.source,
      "agent",
    );
  });


  it("auto-plays stub income after the human declares income", async () => {
    const started = await startTwoSeatMatch({
      matchId: "match-runtime",
      seed: "runtime-seed",
    });
    const before = toSeatView(started, started.humanSeatId);
    assert.equal(before.publicState.seats[0]?.coins, 1);
    assert.equal(before.publicState.seats[1]?.coins, 2);
    assert.equal(before.publicState.currentSeatId, "seat-human");
    assert.ok(
      before.legalDecisions.some(
        (decision) =>
          decision.type === "declare_action" &&
          decision.action.type === "income",
      ),
    );

    const result = await submitHumanDecision(started, {
      protocolVersion: 1,
      requestId: "req-human-1",
      stateVersion: started.state.stateVersion,
      decision: { type: "declare_action", action: { type: "income" } },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const view = toSeatView(result.match, result.match.humanSeatId);
    assert.equal(view.publicState.seats[0]?.coins, 2);
    assert.equal(view.publicState.seats[1]?.coins, 3);
    assert.equal(view.publicState.currentSeatId, "seat-human");
    assert.ok(
      view.projectedHistory.filter(
        (event) =>
          event.type === "action_resolved" && event.actionType === "income",
      ).length >= 2,
    );
  });

  it("auto-passes stub block after the human declares foreign aid", async () => {
    const started = await startTwoSeatMatch({
      matchId: "match-fa-runtime",
      seed: "runtime-seed",
    });

    const result = await submitHumanDecision(started, {
      protocolVersion: 1,
      requestId: "req-fa-1",
      stateVersion: started.state.stateVersion,
      decision: { type: "declare_action", action: { type: "foreign_aid" } },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const view = toSeatView(result.match, result.match.humanSeatId);
    assert.equal(view.publicState.seats[0]?.coins, 3);
    assert.equal(view.publicState.phase, "await_action");
    assert.equal(view.publicState.currentSeatId, "seat-human");
    assert.ok(
      view.projectedHistory.some(
        (event) =>
          event.type === "action_resolved" &&
          event.actionType === "foreign_aid" &&
          event.coinsGained === 2,
      ),
    );
    assert.ok(
      view.projectedHistory.some(
        (event) =>
          event.type === "action_resolved" && event.actionType === "income",
      ),
    );
  });

  it("can finish a match when the human assassinates twice and stub auto-plays", async () => {
    let match: ActiveMatch = await startTwoSeatMatch({
      matchId: "match-finish-runtime",
      seed: "runtime-seed",
    });

    async function humanIncome() {
      const result = await submitHumanDecision(match, {
        protocolVersion: 1,
        requestId: `req-income-${match.state.stateVersion}`,
        stateVersion: match.state.stateVersion,
        decision: { type: "declare_action", action: { type: "income" } },
      });
      assert.equal(result.ok, true);
      if (!result.ok) throw new Error("income failed");
      match = result.match;
    }

    async function humanAssassinate() {
      const result = await submitHumanDecision(match, {
        protocolVersion: 1,
        requestId: `req-assassinate-${match.state.stateVersion}`,
        stateVersion: match.state.stateVersion,
        decision: {
          type: "declare_action",
          action: { type: "assassinate", targetSeatId: "seat-stub" },
        },
      });
      assert.equal(result.ok, true);
      if (!result.ok) throw new Error("assassinate failed");
      match = result.match;
    }

    while (match.state.seats[0]!.coins < 3) {
      await humanIncome();
    }
    await humanAssassinate();
    assert.equal(
      match.state.seats[1]!.influences.filter((card) => !card.revealed).length,
      1,
    );

    while (
      match.state.status === "in_progress" &&
      match.state.seats[0]!.coins < 3
    ) {
      await humanIncome();
    }
    if (match.state.status === "in_progress") {
      await humanAssassinate();
    }

    const view = toSeatView(match, match.humanSeatId);
    assert.equal(view.publicState.status, "finished");
    assert.ok(
      view.projectedHistory.some(
        (event) =>
          event.type === "match_finished" &&
          event.winnerSeatId === "seat-human",
      ),
    );
  });

  it("advances OpenCode and Claude seats through injected adapters", async () => {
    const seen: Array<{ kind: string; seatId: string }> = [];
    const fakeDecide = async (input: {
      view: SeatView;
    }): Promise<SeatDecision> => {
      const legal = input.view.legalDecisions[0];
      if (!legal) throw new Error("no legal decisions");
      return {
        protocolVersion: 1,
        requestId: input.view.requestId,
        stateVersion: input.view.stateVersion,
        decision: legal,
      };
    };
    const agentRuntime = createAgentRuntime({
      adapters: {
        opencode: {
          kind: "opencode",
          async decide(input) {
            seen.push({ kind: "opencode", seatId: input.view.seatId });
            return fakeDecide(input);
          },
        },
        claude: {
          kind: "claude",
          async decide(input) {
            seen.push({ kind: "claude", seatId: input.view.seatId });
            return fakeDecide(input);
          },
        },
      },
    });

    const started = await startMatch({
      matchId: "match-mixed-agents",
      seed: "runtime-seed",
      agentRuntime,
      seats: [
        {
          seatId: "seat-1",
          controller: "local_human",
          displayName: "你",
        },
        {
          seatId: "seat-2",
          controller: "stub_agent",
          displayName: "灰狐",
          cli: "opencode",
          modelId: "opencode/placeholder",
        },
        {
          seatId: "seat-3",
          controller: "stub_agent",
          displayName: "白塔",
          cli: "claude",
          modelId: "claude/placeholder",
        },
      ],
    });

    const result = await submitHumanDecision(
      started,
      {
        protocolVersion: 1,
        requestId: "req-mixed-1",
        stateVersion: started.state.stateVersion,
        decision: { type: "declare_action", action: { type: "income" } },
      },
      { agentRuntime },
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.ok(seen.some((entry) => entry.kind === "opencode"));
    assert.ok(seen.some((entry) => entry.kind === "claude"));
    const view = toSeatView(result.match, result.match.humanSeatId);
    assert.equal(view.publicState.currentSeatId, "seat-1");
    assert.ok(
      view.projectedHistory.filter(
        (event) =>
          event.type === "action_resolved" && event.actionType === "income",
      ).length >= 3,
    );
  });
});

describe("pendingAgentSeatIds", () => {
  it("lists every agent still in the response queue, skipping the human", () => {
    const match = {
      humanSeatId: "seat-human",
      state: {
        status: "in_progress",
        phase: "await_action_challenge",
        responseQueue: ["seat-a", "seat-human", "seat-b"],
        seats: [
          { seatId: "seat-human", controller: "local_human" },
          { seatId: "seat-a", controller: "stub_agent" },
          { seatId: "seat-b", controller: "stub_agent" },
        ],
      },
    } as ActiveMatch;
    assert.deepEqual(pendingAgentSeatIds(match), ["seat-a", "seat-b"]);
  });
});
