import type { CharacterId, LegalDecision } from "@coup/domain";

export type DecisionRationaleSource = "agent" | "template";

export type DecisionRationaleEntry = {
  text: string;
  source: DecisionRationaleSource;
};

const ACTION_LABEL: Record<string, string> = {
  income: "收入",
  foreign_aid: "外援",
  coup: "政变",
  tax: "征税",
  assassinate: "刺杀",
  steal: "偷窃",
  exchange: "交换",
};

const CHARACTER_LABEL: Record<CharacterId, string> = {
  duke: "公爵",
  assassin: "刺客",
  captain: "队长",
  ambassador: "大使",
  contessa: "伯爵夫人",
};

export type ResolveRationaleContext = {
  seatNames: Record<string, string>;
};

function seatName(ctx: ResolveRationaleContext, seatId: string): string {
  return ctx.seatNames[seatId] ?? seatId;
}

export function templateDecisionRationale(
  decision: LegalDecision,
  ctx: ResolveRationaleContext,
): string {
  switch (decision.type) {
    case "declare_action": {
      const action = ACTION_LABEL[decision.action.type] ?? decision.action.type;
      if (
        decision.action.type === "coup" ||
        decision.action.type === "assassinate" ||
        decision.action.type === "steal"
      ) {
        return `选择声明${action} → ${seatName(ctx, decision.action.targetSeatId)}`;
      }
      return `选择声明${action}`;
    }
    case "pass_block":
      return "选择放弃阻挡";
    case "declare_block":
      return `选择阻挡 · ${CHARACTER_LABEL[decision.claimedCharacter]}`;
    case "pass_challenge":
      return "选择放弃质疑";
    case "challenge_claim":
      return "选择质疑";
    case "prove_claim":
      return `选择证明${CHARACTER_LABEL[decision.character]}`;
    case "concede_claim":
      return "选择放弃证明";
    case "choose_influence_to_reveal":
      return `选择揭示${CHARACTER_LABEL[decision.character]}`;
    case "choose_exchange_cards":
      return "选择归还宫廷两张牌";
  }
}

/** Prefer optional agent sidecar text; otherwise template from the decision. */
export function resolveDecisionRationale(
  decision: LegalDecision,
  agentText: string | null | undefined,
  ctx: ResolveRationaleContext,
): DecisionRationaleEntry {
  const trimmed = agentText?.trim();
  if (trimmed) {
    return { text: trimmed, source: "agent" };
  }
  return {
    text: templateDecisionRationale(decision, ctx),
    source: "template",
  };
}
