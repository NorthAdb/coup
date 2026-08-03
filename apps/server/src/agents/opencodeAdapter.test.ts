import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { SeatView } from "@coup/protocol";
import {
  createOpenCodeAdapter,
  OPENCODE_DENY_ALL_CONFIG,
} from "./opencodeAdapter.js";
import type { CliRunRequest, CliRunner } from "./types.js";

function sampleView(): SeatView {
  return {
    protocolVersion: 1,
    requestId: "req-oc-1",
    matchId: "match-oc",
    stateVersion: 4,
    seatId: "seat-2",
    publicState: {
      matchId: "match-oc",
      status: "in_progress",
      stateVersion: 4,
      phase: "await_action",
      currentSeatId: "seat-2",
      activeSeatId: "seat-2",
      pendingAction: null,
      seats: [],
    },
    privateState: { hiddenCharacters: ["duke"], exchangeHand: null },
    projectedHistory: [],
    legalDecisions: [
      { type: "declare_action", action: { type: "income" } },
      { type: "pass_challenge" },
    ],
  };
}

describe("OpenCode agent seat adapter", () => {
  it("writes deny-all config, runs without --auto, and returns a listed SeatDecision", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "coup-oc-"));
    const calls: CliRunRequest[] = [];
    const runner: CliRunner = async (request) => {
      calls.push(request);
      return {
        exitCode: 0,
        stderr: "",
        stdout: `${JSON.stringify({
          type: "text",
          part: { text: '{"legalDecisionIndex":0}' },
        })}\n`,
      };
    };

    const adapter = createOpenCodeAdapter({ runner });
    const decision = await adapter.decide({
      view: sampleView(),
      modelId: "opencode/placeholder",
      cwd,
    });

    const config = JSON.parse(
      await readFile(path.join(cwd, "opencode.json"), "utf8"),
    ) as typeof OPENCODE_DENY_ALL_CONFIG;
    assert.deepEqual(config.permission, OPENCODE_DENY_ALL_CONFIG.permission);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.command, "opencode");
    assert.equal(calls[0]?.cwd, cwd);
    assert.equal(calls[0]?.args[0], "run");
    assert.ok(calls[0]?.args.includes("--format"));
    assert.ok(calls[0]?.args.includes("json"));
    assert.equal(calls[0]?.args.includes("--auto"), false);
    assert.equal(calls[0]?.args.includes("--model"), false);
    assert.deepEqual(decision.decision, {
      type: "declare_action",
      action: { type: "income" },
    });
  });

  it("passes a real model id when it is not a placeholder", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "coup-oc-model-"));
    const calls: CliRunRequest[] = [];
    const runner: CliRunner = async (request) => {
      calls.push(request);
      return {
        exitCode: 0,
        stderr: "",
        stdout: `${JSON.stringify({
          type: "text",
          part: { text: '{"legalDecisionIndex":1}' },
        })}\n`,
      };
    };

    const adapter = createOpenCodeAdapter({ runner });
    await adapter.decide({
      view: sampleView(),
      modelId: "openai/gpt-test",
      cwd,
    });

    assert.ok(calls[0]?.args.includes("--model"));
    assert.ok(calls[0]?.args.includes("openai/gpt-test"));
  });
});
