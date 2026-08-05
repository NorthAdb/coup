import type { LegalDecision, SeatDecision, SeatView } from "@coup/protocol";

/** Structured choice schema shared by OpenCode / Claude adapters. */
export const LEGAL_DECISION_CHOICE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    legalDecisionIndex: {
      type: "integer",
      minimum: 0,
      description: "0-based index into SeatView.legalDecisions",
    },
    decisionRationale: {
      type: "string",
      description:
        "Optional one-sentence public rationale for the choice. Do not include hidden cards, chain-of-thought, or tool output.",
    },
  },
  required: ["legalDecisionIndex"],
} as const;

export type LegalDecisionChoice = {
  legalDecisionIndex: number;
  decisionRationale?: string;
};

/**
 * User-message payload only. Display names and history stay out of system
 * instruction regions (issue 04).
 */
export function buildSeatDecisionUserPrompt(
  view: SeatView,
  retry?: { previousErrorCategory: string },
): string {
  const lines = [
    "You are a Coup seat controller.",
    "Choose exactly one entry from legalDecisions by 0-based index.",
    "You may include an optional short decisionRationale (one sentence).",
    "Do not invent actions, targets, characters, or card ids.",
    "Do not reveal hidden cards, chain-of-thought, or raw transcripts.",
    "Do not call tools, read files, run shell commands, or use the network.",
    "Return only structured output matching the provided JSON schema.",
  ];
  if (retry) {
    lines.push(
      "",
      `Previous attempt failed (${retry.previousErrorCategory}). Choose again from the legalDecisions listed below.`,
      "Do not repeat an illegal choice.",
    );
  }
  lines.push("", "SeatView JSON:", JSON.stringify(view));
  return lines.join("\n");
}

export function parseLegalDecisionChoice(
  value: unknown,
): { ok: true; choice: LegalDecisionChoice } | { ok: false; reason: string } {
  if (value == null || typeof value !== "object") {
    return { ok: false, reason: "choice_not_object" };
  }
  const record = value as Record<string, unknown>;
  const index = record.legalDecisionIndex;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
    return { ok: false, reason: "invalid_legal_decision_index" };
  }
  const rationale = record.decisionRationale;
  if (
    rationale !== undefined &&
    rationale !== null &&
    typeof rationale !== "string"
  ) {
    return { ok: false, reason: "invalid_decision_rationale" };
  }
  return {
    ok: true,
    choice: {
      legalDecisionIndex: index,
      ...(typeof rationale === "string" ? { decisionRationale: rationale } : {}),
    },
  };
}

export function seatDecisionFromChoice(
  view: SeatView,
  choice: LegalDecisionChoice,
):
  | { ok: true; decision: SeatDecision; decisionRationale?: string }
  | { ok: false; reason: string } {
  const legal = view.legalDecisions[choice.legalDecisionIndex];
  if (!legal) {
    return { ok: false, reason: "legal_decision_index_out_of_range" };
  }
  return {
    ok: true,
    decision: {
      protocolVersion: 1,
      requestId: view.requestId,
      stateVersion: view.stateVersion,
      decision: legal,
    },
    ...(choice.decisionRationale !== undefined
      ? { decisionRationale: choice.decisionRationale }
      : {}),
  };
}

export function isLegalDecisionListed(
  legalDecisions: LegalDecision[],
  decision: LegalDecision,
): boolean {
  return legalDecisions.some(
    (entry) => JSON.stringify(entry) === JSON.stringify(decision),
  );
}

/** Extract a JSON object from free-form model text (OpenCode run path). */
export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) {
      throw new Error("json_object_not_found");
    }
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

export function parseOpenCodeRunTextEvents(stdout: string): string {
  const chunks: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (event == null || typeof event !== "object") continue;
    const record = event as Record<string, unknown>;
    if (record.type !== "text") continue;
    const part = record.part;
    if (part == null || typeof part !== "object") continue;
    const text = (part as Record<string, unknown>).text;
    if (typeof text === "string" && text.trim()) {
      chunks.push(text);
    }
  }
  if (chunks.length === 0) {
    throw new Error("opencode_text_event_missing");
  }
  return chunks.join("\n");
}

export function parseClaudeStructuredOutput(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error("claude_empty_stdout");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(trimmed);
  } catch {
    // stream-json or trailing noise: take the last JSON object line
    const lines = trimmed.split(/\r?\n/).filter((line) => line.trim());
    const last = lines[lines.length - 1];
    if (!last) throw new Error("claude_stdout_not_json");
    payload = JSON.parse(last);
  }
  if (payload == null || typeof payload !== "object") {
    throw new Error("claude_payload_not_object");
  }
  const record = payload as Record<string, unknown>;
  if ("structured_output" in record) {
    return record.structured_output;
  }
  if ("legalDecisionIndex" in record) {
    return record;
  }
  throw new Error("claude_structured_output_missing");
}
