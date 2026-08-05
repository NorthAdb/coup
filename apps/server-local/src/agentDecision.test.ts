import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SeatDecision, SeatView } from "@coup/protocol";
import {
  AGENT_FIRST_ATTEMPT_MS,
  AGENT_RETRY_ATTEMPT_MS,
  classifyAgentError,
  decideWithBoundedRetry,
} from "./agentDecision.js";
import { createAgentRuntime } from "./agents/index.js";
import {
  startMatch,
  submitHumanDecision,
  toSeatView,
} from "./matchRuntime.js";

function baseView(overrides: Partial<SeatView> = {}): SeatView {
  return {
    protocolVersion: 1,
    requestId: "req-base",
    matchId: "match-1",
    stateVersion: 1,
    seatId: "seat-2",
    publicState: {
      matchId: "match-1",
      status: "in_progress",
      stateVersion: 1,
      phase: "await_action",
      currentSeatId: "seat-2",
      activeSeatId: "seat-2",
      pendingAction: null,
      seats: [
        {
          seatId: "seat-1",
          controller: "local_human",
          displayName: "你",
          coins: 2,
          eliminated: false,
          revealedCharacters: [],
          influenceCount: 2,
          cli: null,
          modelId: null,
        },
        {
          seatId: "seat-2",
          controller: "stub_agent",
          displayName: "灰狐",
          coins: 2,
          eliminated: false,
          revealedCharacters: [],
          influenceCount: 2,
          cli: "stub",
          modelId: null,
        },
      ],
    },
    privateState: { hiddenCharacters: [], exchangeHand: null },
    projectedHistory: [],
    legalDecisions: [{ type: "declare_action", action: { type: "income" } }],
    ...overrides,
  };
}

function legalDecision(view: SeatView): SeatDecision {
  const decision = view.legalDecisions[0];
  if (!decision) throw new Error("no_legal_decision");
  return {
    protocolVersion: 1,
    requestId: view.requestId,
    stateVersion: view.stateVersion,
    decision,
  };
}

function waitBriefly(ms = 40): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe("agent error classification", () => {
  it("marks timeout and illegal decisions as recoverable", () => {
    assert.equal(classifyAgentError(new Error("agent_timeout")), "recoverable");
    assert.equal(
      classifyAgentError(new Error("agent_decision_not_legal")),
      "recoverable",
    );
    assert.equal(
      classifyAgentError(new Error("opencode_choice_invalid_json")),
      "recoverable",
    );
  });

  it("marks auth and missing CLI as unrecoverable", () => {
    assert.equal(
      classifyAgentError(new Error("agent_cli_not_installed")),
      "unrecoverable",
    );
    assert.equal(
      classifyAgentError(new Error("agent_auth_failed")),
      "unrecoverable",
    );
    assert.equal(
      classifyAgentError(new Error("agent_tools_not_denied")),
      "unrecoverable",
    );
    assert.equal(
      classifyAgentError(new Error("agent_unsupported_protocol")),
      "unrecoverable",
    );
  });
});

describe("decideWithBoundedRetry", () => {
  it("retries once with a new requestId after a recoverable failure", async () => {
    const requestIds: string[] = [];
    const retryCategories: Array<string | undefined> = [];
    let calls = 0;
    const decision = await decideWithBoundedRetry({
      buildView: (requestId) => baseView({ requestId }),
      decide: async (view, signal) => {
        requestIds.push(view.requestId);
        retryCategories.push(signal.previousErrorCategory);
        calls += 1;
        if (calls === 1) {
          throw new Error("agent_decision_not_legal");
        }
        return legalDecision(view);
      },
      attemptIndexBase: 1,
      stateVersion: 1,
      seatId: "seat-2",
    });

    assert.equal(calls, 2);
    assert.equal(requestIds.length, 2);
    assert.notEqual(requestIds[0], requestIds[1]);
    assert.equal(retryCategories[0], undefined);
    assert.equal(retryCategories[1], "agent_decision_not_legal");
    assert.equal(decision.requestId, requestIds[1]);
    assert.equal(decision.decision.type, "declare_action");
  });

  it("does not retry unrecoverable errors", async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        decideWithBoundedRetry({
          buildView: (requestId) => baseView({ requestId }),
          decide: async () => {
            calls += 1;
            throw new Error("agent_auth_failed");
          },
          attemptIndexBase: 1,
          stateVersion: 1,
          seatId: "seat-2",
        }),
      (error: unknown) =>
        error instanceof Error && error.message === "agent_auth_failed",
    );
    assert.equal(calls, 1);
  });

  it("times out the first attempt then retries once within the second budget", async () => {
    const deadlines: number[] = [];
    let calls = 0;

    await assert.rejects(
      () =>
        decideWithBoundedRetry({
          buildView: (requestId) => baseView({ requestId }),
          decide: async (_view, signal) => {
            calls += 1;
            deadlines.push(signal.deadlineMs);
            return await new Promise<SeatDecision>(() => {
              /* hang until deadline */
            });
          },
          attemptIndexBase: 1,
          stateVersion: 1,
          seatId: "seat-2",
          deadlinesMs: [40, 40],
        }),
      (error: unknown) =>
        error instanceof Error && error.message === "agent_decision_failed",
    );
    assert.equal(calls, 2);
    assert.deepEqual(deadlines, [40, 40]);
  });

  it("discards a late response from the first attempt after retry starts", async () => {
    let calls = 0;
    const firstResolve: Array<(value: SeatDecision) => void> = [];

    const pending = decideWithBoundedRetry({
      buildView: (requestId) => baseView({ requestId }),
      decide: async (view) => {
        calls += 1;
        if (calls === 1) {
          return await new Promise<SeatDecision>((resolve) => {
            firstResolve.push(resolve);
          });
        }
        return legalDecision(view);
      },
      attemptIndexBase: 1,
      stateVersion: 1,
      seatId: "seat-2",
      deadlinesMs: [40, 5_000],
    });

    await waitBriefly(60);

    // Late first response arrives with the old requestId; must be ignored.
    assert.equal(firstResolve.length, 1);
    firstResolve[0]!(
      legalDecision(baseView({ requestId: "req-stale-should-ignore" })),
    );

    const decision = await pending;
    assert.equal(calls, 2);
    assert.notEqual(decision.requestId, "req-stale-should-ignore");
    assert.equal(decision.decision.type, "declare_action");
  });

  it("uses production 30s / 15s budgets by default", () => {
    assert.equal(AGENT_FIRST_ATTEMPT_MS, 30_000);
    assert.equal(AGENT_RETRY_ATTEMPT_MS, 15_000);
  });
});

describe("match runtime agent pacing", () => {
  it("retries a recoverable adapter failure then advances the match", async () => {
    const requestIds: string[] = [];
    let calls = 0;
    const agentRuntime = createAgentRuntime({
      adapters: {
        opencode: {
          kind: "opencode",
          async decide(input) {
            requestIds.push(input.view.requestId);
            calls += 1;
            if (calls === 1) {
              throw new Error("agent_decision_not_legal");
            }
            return legalDecision(input.view);
          },
        },
      },
    });

    const started = await startMatch({
      matchId: "match-retry",
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
          modelId: "openai/gpt-test",
        },
      ],
    });

    const beforeVersion = started.state.stateVersion;
    const result = await submitHumanDecision(
      started,
      {
        protocolVersion: 1,
        requestId: "req-human-retry",
        stateVersion: started.state.stateVersion,
        decision: { type: "declare_action", action: { type: "income" } },
      },
      { agentRuntime },
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(calls, 2);
    assert.equal(requestIds.length, 2);
    assert.notEqual(requestIds[0], requestIds[1]);
    assert.ok(result.match.state.stateVersion > beforeVersion);
    const view = toSeatView(result.match, result.match.humanSeatId);
    assert.equal(view.publicState.currentSeatId, "seat-1");
  });

  it("aborts without mutating authority after two recoverable failures", async () => {
    let calls = 0;
    const agentRuntime = createAgentRuntime({
      adapters: {
        opencode: {
          kind: "opencode",
          async decide() {
            calls += 1;
            throw new Error("agent_decision_not_legal");
          },
        },
      },
    });

    const started = await startMatch({
      matchId: "match-double-fail",
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
          modelId: "openai/gpt-test",
        },
      ],
    });
    const snapshotVersion = started.state.stateVersion;
    const snapshotEvents = started.events.length;

    await assert.rejects(
      () =>
        submitHumanDecision(
          started,
          {
            protocolVersion: 1,
            requestId: "req-human-fail",
            stateVersion: started.state.stateVersion,
            decision: { type: "declare_action", action: { type: "income" } },
          },
          { agentRuntime },
        ),
      (error: unknown) =>
        error instanceof Error && error.message === "agent_decision_failed",
    );

    assert.equal(calls, 2);
    // Input match object is not mutated; agent never applied a decision onto it.
    assert.equal(started.state.stateVersion, snapshotVersion);
    assert.equal(started.events.length, snapshotEvents);
  });
});
