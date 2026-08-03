import type { SeatController } from "@coup/domain";

export type CliKind = "opencode" | "claude" | "stub";

export type MatchSetupSeatInput = {
  seatId: string;
  controller: SeatController;
  displayName: string;
  cli?: CliKind;
  modelId?: string | null;
};

export type ParsedMatchSetup = {
  seats: MatchSetupSeatInput[];
};

const AGENT_DISPLAY_NAMES = ["灰狐", "白塔", "夜枭", "暗羽", "赤砂"] as const;

export function defaultAgentDisplayName(agentIndex: number): string {
  return AGENT_DISPLAY_NAMES[agentIndex] ?? `Agent ${agentIndex + 1}`;
}

export function parseMatchSetup(
  body: unknown,
): { ok: true; setup: ParsedMatchSetup } | { ok: false; reason: string } {
  if (body == null || typeof body !== "object") {
    return { ok: false, reason: "invalid_body" };
  }

  const record = body as Record<string, unknown>;
  const seatsRaw = record.seats;
  if (!Array.isArray(seatsRaw)) {
    return { ok: false, reason: "seats_required" };
  }
  if (seatsRaw.length < 2 || seatsRaw.length > 6) {
    return { ok: false, reason: "seat_count_out_of_range" };
  }

  const seats: MatchSetupSeatInput[] = [];
  const seenIds = new Set<string>();

  for (let index = 0; index < seatsRaw.length; index += 1) {
    const entry = seatsRaw[index];
    if (entry == null || typeof entry !== "object") {
      return { ok: false, reason: "invalid_seat" };
    }
    const seat = entry as Record<string, unknown>;
    const seatId = seat.seatId;
    const controller = seat.controller;
    const displayName = seat.displayName;

    if (typeof seatId !== "string" || seatId.length === 0) {
      return { ok: false, reason: "invalid_seat_id" };
    }
    if (seenIds.has(seatId)) {
      return { ok: false, reason: "duplicate_seat_id" };
    }
    seenIds.add(seatId);

    if (controller !== "local_human" && controller !== "stub_agent") {
      return { ok: false, reason: "invalid_controller" };
    }
    if (typeof displayName !== "string" || displayName.trim().length === 0) {
      return { ok: false, reason: "invalid_display_name" };
    }

    if (index === 0) {
      if (controller !== "local_human") {
        return { ok: false, reason: "first_seat_must_be_local_human" };
      }
    } else if (controller !== "stub_agent") {
      return { ok: false, reason: "agent_seats_must_be_stub" };
    }

    const cli = seat.cli;
    if (
      cli !== undefined &&
      cli !== "opencode" &&
      cli !== "claude" &&
      cli !== "stub"
    ) {
      return { ok: false, reason: "invalid_cli" };
    }

    const modelId = seat.modelId;
    if (
      modelId !== undefined &&
      modelId !== null &&
      typeof modelId !== "string"
    ) {
      return { ok: false, reason: "invalid_model_id" };
    }

    seats.push({
      seatId,
      controller,
      displayName: displayName.trim(),
      cli: cli as CliKind | undefined,
      modelId: (modelId as string | null | undefined) ?? null,
    });
  }

  return { ok: true, setup: { seats } };
}
