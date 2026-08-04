import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { seatModelLabel } from "./matchCopy.ts";

describe("seatModelLabel", () => {
  it("shows human identity for local human seats", () => {
    assert.equal(
      seatModelLabel({
        controller: "local_human",
        cli: null,
        modelId: null,
      }),
      "本地人类",
    );
  });

  it("shows an understandable stub placeholder label", () => {
    assert.equal(
      seatModelLabel({
        controller: "stub_agent",
        cli: "stub",
        modelId: "stub/placeholder",
      }),
      "Stub · 占位",
    );
    assert.equal(
      seatModelLabel({
        controller: "stub_agent",
        cli: "stub",
        modelId: null,
      }),
      "Stub · 占位",
    );
  });

  it("shows readable CLI · model labels without raw paths as primary text", () => {
    assert.equal(
      seatModelLabel({
        controller: "stub_agent",
        cli: "opencode",
        modelId: "openai/gpt-test",
      }),
      "OpenCode · gpt-test",
    );
    assert.equal(
      seatModelLabel({
        controller: "stub_agent",
        cli: "claude",
        modelId: "sonnet",
      }),
      "Claude Code · sonnet",
    );
    assert.equal(
      seatModelLabel({
        controller: "stub_agent",
        cli: "opencode",
        modelId: "opencode/glm-5.2",
      }),
      "OpenCode · glm-5.2",
    );
  });
});
