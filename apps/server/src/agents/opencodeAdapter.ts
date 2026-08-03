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

      const prompt = buildOpenCodeStdinPrompt(input.view, input.retry);
      const args = buildOpenCodeArgs({
        modelId: input.modelId,
        title: `coup-${input.view.seatId}-${input.view.requestId}`,
      });

      // Windows cmd argv length / escaping mangles large SeatView prompts when
      // passed as positional args under `shell: true`. Send the body on stdin.
      const result = await options.runner({
        command,
        args,
        cwd: input.cwd,
        stdin: prompt,
        abortSignal: input.abortSignal,
      });
      if (result.exitCode !== 0) {
        throw new Error(
          `opencode_exit_${result.exitCode}:${summarizeCliError(result.stderr)}`,
        );
      }

      let text: string;
      let raw: unknown;
      try {
        text = parseOpenCodeRunTextEvents(result.stdout);
        raw = extractJsonObject(text);
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : "parse_failed";
        throw new Error(`opencode_choice_${reason}`);
      }
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

export function buildOpenCodeStdinPrompt(
  view: AgentDecideInput["view"],
  retry?: AgentDecideInput["retry"],
): string {
  return [
    buildSeatDecisionUserPrompt(view, retry),
    "",
    "JSON Schema for your answer:",
    JSON.stringify(LEGAL_DECISION_CHOICE_SCHEMA),
  ].join("\n");
}

export function buildOpenCodeArgs(input: {
  modelId: string | null;
  title: string;
}): string[] {
  const args = ["run", "--format", "json", "--title", input.title];
  if (input.modelId && !input.modelId.endsWith("/placeholder")) {
    args.push("--model", input.modelId);
  }
  return args;
}

function summarizeCliError(stderr: string): string {
  const line = stderr
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  return (line ?? "unknown").slice(0, 160);
}
