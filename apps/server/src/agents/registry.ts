import { createClaudeAdapter } from "./claudeAdapter.js";
import { createProcessCliRunner } from "./cliRunner.js";
import { createOpenCodeAdapter } from "./opencodeAdapter.js";
import type { AgentRuntime, AgentSeatAdapter, CliRunner } from "./types.js";

export type CreateAgentRuntimeOptions = {
  runner?: CliRunner;
  /** Override adapters (tests / stub orchestration). */
  adapters?: Partial<Record<"opencode" | "claude", AgentSeatAdapter>>;
};

export function createAgentRuntime(
  options: CreateAgentRuntimeOptions = {},
): AgentRuntime {
  const runner = options.runner ?? createProcessCliRunner();
  const openCode =
    options.adapters?.opencode ?? createOpenCodeAdapter({ runner });
  const claude =
    options.adapters?.claude ?? createClaudeAdapter({ runner });

  return {
    getAdapter(kind) {
      return kind === "opencode" ? openCode : claude;
    },
  };
}
