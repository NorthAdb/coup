import type { SeatDecision, SeatView } from "@coup/protocol";

export type AgentCliKind = "opencode" | "claude";

export type AgentDecideInput = {
  view: SeatView;
  modelId: string | null;
  /** Isolated working directory for this seat/session. */
  cwd: string;
  /** Present on the bounded retry attempt only. */
  retry?: { previousErrorCategory: string };
};

export type AgentSeatAdapter = {
  readonly kind: AgentCliKind;
  decide(input: AgentDecideInput): Promise<SeatDecision>;
};

export type CliRunRequest = {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  stdin?: string;
};

export type CliRunResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type CliRunner = (request: CliRunRequest) => Promise<CliRunResult>;

export type AgentRuntime = {
  getAdapter(kind: AgentCliKind): AgentSeatAdapter;
};
