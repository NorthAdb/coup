import type { SeatDecision, SeatView } from "@coup/protocol";

export type AgentCliKind = "opencode" | "claude";

export type AgentDecideInput = {
  view: SeatView;
  modelId: string | null;
  /** Isolated working directory for this seat/session. */
  cwd: string;
  /** Present on the bounded retry attempt only. */
  retry?: { previousErrorCategory: string };
  /** Cancel in-flight CLI when the attempt deadline fires. */
  abortSignal?: AbortSignal;
};

/** Adapter result: authoritative SeatDecision plus optional rationale sidecar. */
export type AgentDecideResult = SeatDecision & {
  decisionRationale?: string;
};

export type AgentSeatAdapter = {
  readonly kind: AgentCliKind;
  decide(input: AgentDecideInput): Promise<AgentDecideResult>;
};

export type CliRunRequest = {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  stdin?: string;
  /** When aborted, the runner must kill the process tree and reject. */
  abortSignal?: AbortSignal;
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
