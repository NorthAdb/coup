import type { LegalDecision } from "@coup/protocol";
import { ACTION_LABEL } from "./matchCopy.js";

export type UntargetedActionType =
  | "income"
  | "foreign_aid"
  | "tax"
  | "exchange";

export type TargetedActionType = "coup" | "assassinate" | "steal";

export type ActionDraft =
  | { kind: "untargeted"; actionType: UntargetedActionType }
  | {
      kind: "targeted";
      actionType: TargetedActionType;
      targetSeatId: string | null;
    };

export function canConfirmActionDraft(draft: ActionDraft): boolean {
  if (draft.kind === "untargeted") return true;
  return draft.targetSeatId != null;
}

export function actionDraftSummary(
  draft: ActionDraft,
  seats: readonly { seatId: string; displayName: string }[],
): string {
  const label = ACTION_LABEL[draft.actionType] ?? draft.actionType;
  if (draft.kind === "untargeted") {
    if (draft.actionType === "exchange") return "交换影响力";
    return label;
  }
  if (draft.targetSeatId == null) {
    return `${label} · 选择目标`;
  }
  const target =
    seats.find((seat) => seat.seatId === draft.targetSeatId)?.displayName ??
    draft.targetSeatId;
  return `${label} ${target}`;
}

export function actionDraftToDecision(draft: ActionDraft): LegalDecision | null {
  if (draft.kind === "untargeted") {
    return {
      type: "declare_action",
      action: { type: draft.actionType },
    };
  }
  if (draft.targetSeatId == null) return null;
  return {
    type: "declare_action",
    action: {
      type: draft.actionType,
      targetSeatId: draft.targetSeatId,
    },
  };
}
