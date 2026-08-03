import {
  buildSeatDecisionUserPrompt,
  LEGAL_DECISION_CHOICE_SCHEMA,
  parseClaudeStructuredOutput,
  parseLegalDecisionChoice,
  seatDecisionFromChoice,
} from "./protocol.js";
import type {
  AgentDecideInput,
  AgentSeatAdapter,
  CliRunner,
} from "./types.js";

export type ClaudeAdapterOptions = {
  runner: CliRunner;
  command?: string;
};

/**
 * Claude Code seat adapter via `claude -p` JSON + `--json-schema`.
 * Tools are disabled with `--tools ""` and `--disallowedTools "*"`;
 * `--permission-mode dontAsk` denies anything not pre-allowed.
 * No API key is configured by the app — local CLI login state is reused.
 */
export function createClaudeAdapter(
  options: ClaudeAdapterOptions,
): AgentSeatAdapter {
  const command = options.command ?? "claude";
  return {
    kind: "claude",
    async decide(input: AgentDecideInput) {
      const prompt = buildSeatDecisionUserPrompt(input.view);
      const args = buildClaudeArgs({
        modelId: input.modelId,
        prompt,
      });

      const result = await options.runner({
        command,
        args,
        cwd: input.cwd,
      });
      if (result.exitCode !== 0) {
        throw new Error(
          `claude_exit_${result.exitCode}:${summarizeCliError(result.stderr)}`,
        );
      }

      const raw = parseClaudeStructuredOutput(result.stdout);
      const parsed = parseLegalDecisionChoice(raw);
      if (!parsed.ok) {
        throw new Error(`claude_choice_${parsed.reason}`);
      }
      const decision = seatDecisionFromChoice(input.view, parsed.choice);
      if (!decision.ok) {
        throw new Error(`claude_decision_${decision.reason}`);
      }
      return decision.decision;
    },
  };
}

export function buildClaudeArgs(input: {
  modelId: string | null;
  prompt: string;
}): string[] {
  const args = [
    "-p",
    input.prompt,
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(LEGAL_DECISION_CHOICE_SCHEMA),
    "--permission-mode",
    "dontAsk",
    "--tools",
    "",
    "--disallowedTools",
    "*",
    "--no-session-persistence",
  ];
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
