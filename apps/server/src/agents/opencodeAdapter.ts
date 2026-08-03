import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildSeatDecisionUserPrompt,
  extractJsonObject,
  LEGAL_DECISION_CHOICE_SCHEMA,
  parseLegalDecisionChoice,
  parseOpenCodeRunTextEvents,
  seatDecisionFromChoice,
} from "./protocol.js";
import type {
  AgentDecideInput,
  AgentSeatAdapter,
  CliRunner,
} from "./types.js";

export type OpenCodeAdapterOptions = {
  runner: CliRunner;
  command?: string;
};

/** Deny every tool/permission in the seat workspace (issue 04 / 17). */
export const OPENCODE_DENY_ALL_CONFIG = {
  $schema: "https://opencode.ai/config.json",
  permission: {
    "*": "deny",
  },
} as const;

/**
 * OpenCode seat adapter via `opencode run --format json` (research-approved
 * simplified path vs serve). Workspace config denies all tools; `--auto` is
 * never passed. Browser never sees credentials.
 */
export function createOpenCodeAdapter(
  options: OpenCodeAdapterOptions,
): AgentSeatAdapter {
  const command = options.command ?? "opencode";
  return {
    kind: "opencode",
    async decide(input: AgentDecideInput) {
      await writeFile(
        path.join(input.cwd, "opencode.json"),
        `${JSON.stringify(OPENCODE_DENY_ALL_CONFIG, null, 2)}\n`,
        "utf8",
      );

      const prompt = buildSeatDecisionUserPrompt(input.view, input.retry);
      const args = buildOpenCodeArgs({
        modelId: input.modelId,
        title: `coup-${input.view.seatId}-${input.view.requestId}`,
        prompt,
      });

      const result = await options.runner({
        command,
        args,
        cwd: input.cwd,
      });
      if (result.exitCode !== 0) {
        throw new Error(
          `opencode_exit_${result.exitCode}:${summarizeCliError(result.stderr)}`,
        );
      }

      const text = parseOpenCodeRunTextEvents(result.stdout);
      const raw = extractJsonObject(text);
      const parsed = parseLegalDecisionChoice(raw);
      if (!parsed.ok) {
        throw new Error(`opencode_choice_${parsed.reason}`);
      }
      const decision = seatDecisionFromChoice(input.view, parsed.choice);
      if (!decision.ok) {
        throw new Error(`opencode_decision_${decision.reason}`);
      }
      return decision.decision;
    },
  };
}

export function buildOpenCodeArgs(input: {
  modelId: string | null;
  title: string;
  prompt: string;
}): string[] {
  const args = ["run", "--format", "json", "--title", input.title];
  if (input.modelId && !input.modelId.endsWith("/placeholder")) {
    args.push("--model", input.modelId);
  }
  args.push(
    [
      input.prompt,
      "",
      "JSON Schema for your answer:",
      JSON.stringify(LEGAL_DECISION_CHOICE_SCHEMA),
    ].join("\n"),
  );
  return args;
}

function summarizeCliError(stderr: string): string {
  const line = stderr
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  return (line ?? "unknown").slice(0, 160);
}
