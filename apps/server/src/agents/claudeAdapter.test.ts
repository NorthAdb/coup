import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SeatView } from "@coup/protocol";
import { buildClaudeArgs, createClaudeAdapter } from "./claudeAdapter.js";
import type { CliRunRequest, CliRunner } from "./types.js";

function sampleView(): SeatView {
  return {
    protocolVersion: 1,
    requestId: "req-claude-1",
    matchId: "match-claude",
    stateVersion: 5,
    seatId: "seat-3",
    publicState: {
      matchId: "match-claude",
      status: "in_progress",
      stateVersion: 5,
      phase: "await_action_challenge",
      currentSeatId: "seat-1",
      activeSeatId: "seat-3",
      pendingAction: null,
      seats: [],
    },
    privateState: { hiddenCharacters: ["contessa"], exchangeHand: null },
    projectedHistory: [],
    legalDecisions: [
      { type: "pass_challenge" },
      { type: "challenge_claim" },
    ],
  };
}

describe("Claude Code agent seat adapter", () => {
  it("disables tools and returns a structured SeatDecision", async () => {
    const calls: CliRunRequest[] = [];
    const runner: CliRunner = async (request) => {
      calls.push(request);
      return {
        exitCode: 0,
        stderr: "",
        stdout: JSON.stringify({
          structured_output: { legalDecisionIndex: 1 },
        }),
      };
    };

    const adapter = createClaudeAdapter({ runner });
    const decision = await adapter.decide({
      view: sampleView(),
      modelId: "claude/placeholder",
      cwd: process.cwd(),
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.command, "claude");
    const args = calls[0]?.args ?? [];
    assert.ok(args.includes("-p"));
    assert.ok(args.includes("--output-format"));
    assert.ok(args.includes("json"));
    assert.ok(args.includes("--json-schema"));
    assert.ok(args.includes("--permission-mode"));
    assert.ok(args.includes("dontAsk"));
    assert.ok(args.includes("--tools"));
    assert.ok(args.includes(""));
    assert.ok(args.includes("--disallowedTools"));
    assert.ok(args.includes("*"));
    assert.equal(args.includes("--dangerously-skip-permissions"), false);
    assert.equal(args.includes("bypassPermissions"), false);
    assert.deepEqual(decision.decision, { type: "challenge_claim" });
  });

  it("assembles locked-down argv without bypass flags", () => {
    const args = buildClaudeArgs({
      modelId: null,
      prompt: "choose",
    });
    assert.ok(args.includes("--tools"));
    assert.ok(args.includes(""));
    assert.ok(args.includes("--disallowedTools"));
    assert.ok(args.includes("*"));
    assert.ok(args.includes("dontAsk"));
    assert.equal(args.includes("--dangerously-skip-permissions"), false);
    assert.equal(args.includes("bypassPermissions"), false);
  });
});
