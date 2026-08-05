import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CliRunRequest, CliRunner } from "./agents/types.js";
import {
  CLAUDE_ALIAS_MODELS,
  isClaudeAuthenticated,
  parseOpenCodeModels,
  probeCapabilities,
  recheckSetupSeats,
  seatReadiness,
  type CapabilityReport,
} from "./capabilityProbe.js";

function assertNoSecrets(payload: unknown): string[] {
  const blob = JSON.stringify(payload).toLowerCase();
  const offenders: string[] = [];
  for (const needle of [
    "oauth_token",
    "apikey",
    "api_key",
    "apikeyhelper",
    "authorization",
    "auth.json",
    "authmethod",
    "cookie",
  ]) {
    if (blob.includes(needle)) offenders.push(needle);
  }
  return offenders;
}

function fixtureRunner(
  handlers: Record<string, (request: CliRunRequest) => { stdout: string; stderr?: string; exitCode: number }>,
): CliRunner {
  return async (request) => {
    const key = `${request.command} ${request.args.join(" ")}`;
    const handler = handlers[key];
    if (!handler) {
      return { stdout: "", stderr: `unexpected:${key}`, exitCode: 127 };
    }
    const result = handler(request);
    return {
      stdout: result.stdout,
      stderr: result.stderr ?? "",
      exitCode: result.exitCode,
    };
  };
}

describe("capability probe", () => {
  it("reports ready OpenCode with sanitized model ids only", async () => {
    const report = await probeCapabilities({
      runner: fixtureRunner({
        "opencode --version": () => ({ stdout: "1.18.10\n", exitCode: 0 }),
        "opencode providers list": () => ({
          stdout: "secret-provider-token=abc\n",
          stderr: "Credentials ~/.local/share/opencode/auth.json\n",
          exitCode: 0,
        }),
        "opencode models": () => ({
          stdout: "openai/gpt-test\nanthropic/claude-test\n",
          exitCode: 0,
        }),
        "claude --version": () => ({ stdout: "missing\n", exitCode: 127 }),
      }),
    });

    assert.equal(report.clis.opencode.status, "ready");
    assert.equal(report.clis.opencode.version, "1.18.10");
    assert.deepEqual(report.clis.opencode.models, [
      { id: "openai/gpt-test", label: "gpt-test（openai）" },
      { id: "anthropic/claude-test", label: "claude-test（anthropic）" },
    ]);
    assert.equal(assertNoSecrets(report.clis.opencode).length, 0);
    assert.equal(report.clis.opencode.hint.includes("auth.json"), false);
  });

  it("maps missing CLI to not_installed", async () => {
    const report = await probeCapabilities({
      runner: fixtureRunner({
        "opencode --version": () => ({ stdout: "", exitCode: 127 }),
        "claude --version": () => ({ stdout: "", exitCode: 127 }),
      }),
    });
    assert.equal(report.clis.opencode.status, "not_installed");
    assert.equal(report.clis.claude.status, "not_installed");
    assert.equal(report.clis.opencode.models.length, 0);
  });

  it("maps failed OpenCode auth to not_authenticated without leaking stderr", async () => {
    const report = await probeCapabilities({
      runner: fixtureRunner({
        "opencode --version": () => ({ stdout: "1.18.10\n", exitCode: 0 }),
        "opencode providers list": () => ({
          stdout: "",
          stderr: "login required oauth_token=secret",
          exitCode: 1,
        }),
        "claude --version": () => ({ stdout: "", exitCode: 127 }),
      }),
    });
    assert.equal(report.clis.opencode.status, "not_authenticated");
    assert.equal(assertNoSecrets(report).length, 0);
  });

  it("maps empty OpenCode model list to no_models", async () => {
    const report = await probeCapabilities({
      runner: fixtureRunner({
        "opencode --version": () => ({ stdout: "1.18.10\n", exitCode: 0 }),
        "opencode providers list": () => ({ stdout: "", exitCode: 0 }),
        "opencode models": () => ({ stdout: "\n", exitCode: 0 }),
        "claude --version": () => ({ stdout: "", exitCode: 127 }),
      }),
    });
    assert.equal(report.clis.opencode.status, "no_models");
  });

  it("exposes Claude alias models when auth JSON says loggedIn, without auth fields", async () => {
    const report = await probeCapabilities({
      runner: fixtureRunner({
        "opencode --version": () => ({ stdout: "", exitCode: 127 }),
        "claude --version": () => ({
          stdout: "2.1.220 (Claude Code)\n",
          exitCode: 0,
        }),
        "claude auth status": () => ({
          stdout: JSON.stringify({
            loggedIn: true,
            authMethod: "oauth_token",
            apiProvider: "firstParty",
            apiKeySource: "apiKeyHelper",
            email: "user@example.com",
          }),
          exitCode: 0,
        }),
      }),
    });

    assert.equal(report.clis.claude.status, "ready");
    assert.equal(report.clis.claude.version, "2.1.220");
    assert.deepEqual(report.clis.claude.models, CLAUDE_ALIAS_MODELS);
    assert.equal(assertNoSecrets(report).length, 0);
    const blob = JSON.stringify(report);
    assert.equal(blob.includes("oauth_token"), false);
    assert.equal(blob.includes("apiKeyHelper"), false);
    assert.equal(blob.includes("user@example.com"), false);
  });

  it("treats Claude loggedIn:false as not_authenticated", async () => {
    const report = await probeCapabilities({
      runner: fixtureRunner({
        "opencode --version": () => ({ stdout: "", exitCode: 127 }),
        "claude --version": () => ({
          stdout: "2.1.220 (Claude Code)\n",
          exitCode: 0,
        }),
        "claude auth status": () => ({
          stdout: JSON.stringify({ loggedIn: false, authMethod: "none" }),
          exitCode: 0,
        }),
      }),
    });
    assert.equal(report.clis.claude.status, "not_authenticated");
    assert.equal(report.clis.claude.models.length, 0);
  });
});

describe("parseOpenCodeModels", () => {
  it("extracts provider/model tokens with readable labels", () => {
    assert.deepEqual(
      parseOpenCodeModels("openai/gpt-4\nfoo\nopencode/big-pickle\n"),
      [
        { id: "openai/gpt-4", label: "gpt-4（openai）" },
        { id: "opencode/big-pickle", label: "big-pickle（opencode）" },
      ],
    );
  });
});

describe("isClaudeAuthenticated", () => {
  it("prefers loggedIn boolean over exit code", () => {
    assert.equal(
      isClaudeAuthenticated({
        ok: true,
        exitCode: 0,
        stdout: '{"loggedIn":false}',
      }),
      false,
    );
    assert.equal(
      isClaudeAuthenticated({
        ok: false,
        exitCode: 1,
        stdout: '{"loggedIn":true}',
      }),
      true,
    );
  });
});

describe("seatReadiness", () => {
  const ready: CapabilityReport["clis"]["opencode"] = {
    cli: "opencode",
    status: "ready",
    version: "1.18.10",
    models: [{ id: "openai/gpt-test", label: "openai/gpt-test" }],
    hint: "ok",
  };

  it("marks missing selected model as model_invalid", () => {
    assert.equal(seatReadiness(ready, "openai/missing"), "model_invalid");
    assert.equal(seatReadiness(ready, "openai/gpt-test"), "ready");
  });

  it("propagates upstream capability status", () => {
    assert.equal(
      seatReadiness({ ...ready, status: "not_installed", models: [] }, "x"),
      "not_installed",
    );
  });

  it("allows stub seats without probing models during recheck", () => {
    const result = recheckSetupSeats(
      [
        { cli: "stub", modelId: "stub/placeholder" },
        { cli: "opencode", modelId: "openai/gpt-test" },
      ],
      {
        clis: {
          opencode: ready,
          claude: {
            cli: "claude",
            status: "not_installed",
            version: null,
            models: [],
            hint: "x",
          },
        },
      },
    );
    assert.equal(result.ok, true);
  });
});
