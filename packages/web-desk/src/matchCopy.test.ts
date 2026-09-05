import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { seatModelLabel } from "./matchCopy.js";

describe("seatModelLabel", () => {
  it("shows human identity for local human seats", () => {
    assert.equal(
      seatModelLabel({
        controller: "local_human",
        cli: null,
        modelId: null,
      }),
      "房主",
    );
  });

  it("shows remote human identity without agent CLI labels", () => {
    assert.equal(
      seatModelLabel({
        controller: "remote_human",
        cli: null,
        modelId: null,
      }),
      "玩家",
    );
  });

  it("shows an understandable stub placeholder label", () => {
    assert.equal(
      seatModelLabel({
        controller: "stub_agent",
        cli: "stub",
        modelId: "stub/placeholder",
      }),
      "AI · 占位",
    );
    assert.equal(
      seatModelLabel({
        controller: "stub_agent",
        cli: "stub",
        modelId: null,
      }),
      "AI · 占位",
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
