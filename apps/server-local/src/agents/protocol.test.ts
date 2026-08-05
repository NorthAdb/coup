import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SeatView } from "@coup/protocol";
import {
  buildSeatDecisionUserPrompt,
  extractJsonObject,
  isLegalDecisionListed,
  parseClaudeStructuredOutput,
  parseLegalDecisionChoice,
  parseOpenCodeRunTextEvents,
  seatDecisionFromChoice,
} from "./protocol.js";

function sampleView(overrides?: Partial<SeatView>): SeatView {
  return {
    protocolVersion: 1,
    requestId: "req-1",
    matchId: "match-1",
    stateVersion: 3,
    seatId: "seat-2",
    publicState: {
      matchId: "match-1",
      status: "in_progress",
      stateVersion: 3,
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
          modelId: "stub/placeholder",
        },
      ],
    },
    privateState: {
      hiddenCharacters: ["duke", "assassin"],
      exchangeHand: null,
    },
    projectedHistory: [],
    legalDecisions: [
      { type: "declare_action", action: { type: "income" } },
      { type: "declare_action", action: { type: "foreign_aid" } },
    ],
    ...overrides,
  };
}

describe("agent seat protocol helpers", () => {
  it("keeps SeatView in the user prompt and asks for an index choice", () => {
    const view = sampleView();
    const prompt = buildSeatDecisionUserPrompt(view);
    assert.match(prompt, /legalDecisions/);
    assert.match(prompt, /Do not call tools/);
    assert.ok(prompt.includes(view.requestId));
    assert.ok(prompt.includes('"seatId":"seat-2"'));
  });

  it("maps a legal index onto a SeatDecision", () => {
    const view = sampleView();
    const parsed = parseLegalDecisionChoice({ legalDecisionIndex: 1 });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const decision = seatDecisionFromChoice(view, parsed.choice);
    assert.equal(decision.ok, true);
    if (!decision.ok) return;
    assert.deepEqual(decision.decision.decision, view.legalDecisions[1]);
    assert.equal(decision.decision.requestId, "req-1");
    assert.equal(decision.decision.stateVersion, 3);
  });

  it("passes through an optional decisionRationale sidecar from the choice", () => {
    const view = sampleView();
    const parsed = parseLegalDecisionChoice({
      legalDecisionIndex: 0,
      decisionRationale: "先拿收入",
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const decision = seatDecisionFromChoice(view, parsed.choice);
    assert.equal(decision.ok, true);
    if (!decision.ok) return;
    assert.equal(decision.decisionRationale, "先拿收入");
    assert.equal(
      "decisionRationale" in decision.decision,
      false,
      "authoritative SeatDecision must not carry the sidecar field",
    );
  });

  it("rejects an out-of-range legalDecisionIndex", () => {
    const view = sampleView();
    const decision = seatDecisionFromChoice(view, { legalDecisionIndex: 9 });
    assert.equal(decision.ok, false);
  });

  it("checks decisions against the enumerated legal list", () => {
    const view = sampleView();
    assert.equal(
      isLegalDecisionListed(view.legalDecisions, view.legalDecisions[0]!),
      true,
    );
    assert.equal(
      isLegalDecisionListed(view.legalDecisions, {
        type: "declare_action",
        action: { type: "tax" },
      }),
      false,
    );
  });

  it("parses OpenCode --format json text events", () => {
    const stdout = [
      JSON.stringify({
        type: "text",
        part: { text: '{"legalDecisionIndex":0}' },
      }),
      JSON.stringify({ type: "step_finish", part: {} }),
    ].join("\n");
    assert.equal(
      parseOpenCodeRunTextEvents(stdout),
      '{"legalDecisionIndex":0}',
    );
    assert.deepEqual(extractJsonObject('prefix {"legalDecisionIndex":0} suffix'), {
      legalDecisionIndex: 0,
    });
  });

  it("parses Claude structured_output payloads", () => {
    const stdout = JSON.stringify({
      result: "ok",
      structured_output: { legalDecisionIndex: 1 },
    });
    assert.deepEqual(parseClaudeStructuredOutput(stdout), {
      legalDecisionIndex: 1,
    });
  });
});
