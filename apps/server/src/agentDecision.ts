import type { SeatDecision, SeatView } from "@coup/protocol";

export const AGENT_FIRST_ATTEMPT_MS = 30_000;
export const AGENT_RETRY_ATTEMPT_MS = 15_000;

export type AgentErrorKind = "recoverable" | "unrecoverable";

export type AgentAttemptSignal = {
  /** Soft deadline budget for this attempt (not wall-clock absolute). */
  deadlineMs: number;
  aborted: boolean;
  /** Abort in-flight CLI work when the attempt deadline fires. */
  abortSignal: AbortSignal;
  /** Set on the retry attempt with a sanitized prior error category. */
  previousErrorCategory?: string;
};

export type DecideWithBoundedRetryInput = {
  buildView: (requestId: string) => SeatView;
  decide: (
    view: SeatView,
    signal: AgentAttemptSignal,
  ) => Promise<SeatDecision>;
  attemptIndexBase: number;
  stateVersion: number;
  seatId: string;
  /** Override attempt budgets (tests). Defaults: 30s then 15s. */
  deadlinesMs?: [number, number];
  onPhase?: (phase: AgentDecisionPhase) => void;
};

export type AgentDecisionPhase =
  | "thinking"
  | "validating"
  | "retrying"
  | "failed";

const UNRECOVERABLE_CODES = new Set([
  "agent_cli_not_installed",
  "agent_cli_unsupported",
  "agent_unsupported_protocol",
  "agent_auth_failed",
  "agent_credentials_missing",
  "agent_billing_unavailable",
  "agent_model_unavailable",
  "agent_model_forbidden",
  "agent_tools_not_denied",
  "agent_tool_permission_requested",
  "agent_isolation_violated",
  "agent_persist_failed",
]);

const RECOVERABLE_CODES = new Set([
  "agent_timeout",
  "agent_decision_not_legal",
  "agent_request_id_mismatch",
  "agent_version_mismatch",
  "agent_empty_output",
  "agent_invalid_json",
  "agent_schema_mismatch",
  "agent_subprocess_exited",
  "agent_session_error",
  "agent_rate_limited",
  "agent_provider_transient",
]);

function errorCode(error: unknown): string {
  if (!(error instanceof Error) || !error.message) {
    return "agent_failed";
  }
  const message = error.message;
  const colon = message.indexOf(":");
  const head = (colon >= 0 ? message.slice(0, colon) : message).trim();
  return head || "agent_failed";
}

/**
 * Classifies adapter / validation failures for bounded retry (issue 06).
 * Unknown codes default to recoverable so a single flaky response can retry;
 * explicit unrecoverable tokens abort immediately.
 */
export function classifyAgentError(error: unknown): AgentErrorKind {
  const code = errorCode(error);
  if (UNRECOVERABLE_CODES.has(code)) {
    return "unrecoverable";
  }
  if (RECOVERABLE_CODES.has(code)) {
    return "recoverable";
  }
  // Adapter-specific parse / exit failures are recoverable (one retry).
  if (
    code.startsWith("opencode_choice_") ||
    code.startsWith("opencode_decision_") ||
    code.startsWith("opencode_exit_") ||
    code.startsWith("claude_choice_") ||
    code.startsWith("claude_decision_") ||
    code.startsWith("claude_exit_")
  ) {
    return "recoverable";
  }
  if (code.startsWith("agent_")) {
    // Prefer fail-closed for unknown agent_* safety codes.
    if (
      code.includes("auth") ||
      code.includes("credential") ||
      code.includes("tool") ||
      code.includes("isolation") ||
      code.includes("persist")
    ) {
      return "unrecoverable";
    }
  }
  return "recoverable";
}

function requestIdFor(
  stateVersion: number,
  seatId: string,
  attempt: number,
): string {
  return `req-${stateVersion}-${seatId}-a${attempt}`;
}

async function raceWithDeadline<T>(
  work: Promise<T>,
  deadlineMs: number,
  signal: AgentAttemptSignal,
  abortController: AbortController,
): Promise<T> {
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      if (!settled) {
        signal.aborted = true;
        abortController.abort();
        reject(new Error("agent_timeout"));
      }
    }, deadlineMs);
  });

  try {
    const result = await Promise.race([work, timeout]);
    settled = true;
    return result;
  } catch (error) {
    settled = true;
    signal.aborted = true;
    if (!abortController.signal.aborted) {
      abortController.abort();
    }
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Two-attempt Agent decision: 30s then optional 15s retry on recoverable errors.
 * Each attempt uses a fresh requestId; late responses from prior attempts are ignored.
 */
export async function decideWithBoundedRetry(
  input: DecideWithBoundedRetryInput,
): Promise<SeatDecision> {
  const deadlines = input.deadlinesMs ?? [
    AGENT_FIRST_ATTEMPT_MS,
    AGENT_RETRY_ATTEMPT_MS,
  ];
  let lastError: unknown = new Error("agent_decision_failed");

  for (let attempt = 0; attempt < deadlines.length; attempt += 1) {
    const attemptNumber = input.attemptIndexBase + attempt;
    const requestId = requestIdFor(
      input.stateVersion,
      input.seatId,
      attemptNumber,
    );
    const view = input.buildView(requestId);
    const deadlineMs = deadlines[attempt]!;
    const abortController = new AbortController();
    const signal: AgentAttemptSignal = {
      deadlineMs,
      aborted: false,
      abortSignal: abortController.signal,
      previousErrorCategory:
        attempt === 0 ? undefined : errorCode(lastError),
    };

    input.onPhase?.(attempt === 0 ? "thinking" : "retrying");

    try {
      const work = input.decide(view, signal).then((decision) => {
        // Discard late / mismatched responses (stale requestId or aborted).
        if (signal.aborted || decision.requestId !== view.requestId) {
          throw new Error("agent_request_id_mismatch");
        }
        if (decision.stateVersion !== view.stateVersion) {
          throw new Error("agent_version_mismatch");
        }
        if (decision.protocolVersion !== 1) {
          throw new Error("agent_unsupported_protocol");
        }
        return decision;
      });
      // Late losers must not surface as unhandled rejections.
      void work.catch(() => undefined);

      return await raceWithDeadline(work, deadlineMs, signal, abortController);
    } catch (error) {
      lastError = error;
      const kind = classifyAgentError(error);
      if (kind === "unrecoverable") {
        input.onPhase?.("failed");
        throw error instanceof Error
          ? error
          : new Error("agent_decision_failed");
      }
      // Recoverable: only one retry.
      if (attempt === 0) {
        continue;
      }
    }
  }

  input.onPhase?.("failed");
  throw lastError instanceof Error &&
    classifyAgentError(lastError) === "recoverable"
    ? new Error("agent_decision_failed")
    : lastError instanceof Error
      ? lastError
      : new Error("agent_decision_failed");
}
