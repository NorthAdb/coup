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
      const prompt = buildSeatDecisionUserPrompt(input.view, input.retry);
      const args = buildClaudeArgs({ modelId: input.modelId });

      // Same Windows argv limit as OpenCode: keep flags short, prompt on stdin.
      const result = await options.runner({
        command,
        args,
        cwd: input.cwd,
        stdin: prompt,
        abortSignal: input.abortSignal,
      });
      if (result.exitCode !== 0) {
        throw new Error(
          `claude_exit_${result.exitCode}:${summarizeCliError(result.stderr)}`,
        );
      }

      let raw: unknown;
      try {
        raw = parseClaudeStructuredOutput(result.stdout);
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : "parse_failed";
        throw new Error(`claude_choice_${reason}`);
      }
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

export function buildClaudeArgs(input: { modelId: string | null }): string[] {
  const args = [
    "-p",
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
