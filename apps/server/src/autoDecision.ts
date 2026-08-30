/**
 * 回合超时的自动决策规划（ADR-0008）。
 * 服务器在人类座位超时后，以其名义提交一次「稳妥」的合法决策：
 * 响应窗口→放弃，行动→收入（收入不合法时取第一个合法行动），
 * 证明→放弃证明，揭示/交换→按合法决策提供的第一项执行。
 * 自动决策与人类决策走完全相同的提交通路，事件与持久化一致。
 */

import { projectForSeat, type MatchState } from "@coup/domain";
import type { LegalDecision } from "@coup/protocol";

export type AutoDecisionKind =
  | "pass"
  | "income"
  | "concede"
  | "reveal"
  | "exchange"
  | "forced_action";

export type AutoDecisionPlan = {
  decision: LegalDecision;
  kind: AutoDecisionKind;
};

export function planAutoDecision(
  state: MatchState,
  seatId: string,
): AutoDecisionPlan | null {
  let legal: LegalDecision[];
  try {
    legal = projectForSeat(state, seatId).legalDecisions;
  } catch {
    return null;
  }
  if (legal.length === 0) return null;

  const passBlock = legal.find((d) => d.type === "pass_block");
  if (passBlock) return { decision: passBlock, kind: "pass" };
  const passChallenge = legal.find((d) => d.type === "pass_challenge");
  if (passChallenge) return { decision: passChallenge, kind: "pass" };
  const concede = legal.find((d) => d.type === "concede_claim");
  if (concede) return { decision: concede, kind: "concede" };

  const income = legal.find(
    (d) => d.type === "declare_action" && d.action.type === "income",
  );
  if (income) return { decision: income, kind: "income" };

  const reveal = legal.find((d) => d.type === "choose_influence_to_reveal");
  if (reveal) return { decision: reveal, kind: "reveal" };

  const exchange = legal.find((d) => d.type === "choose_exchange_cards");
  if (exchange) return { decision: exchange, kind: "exchange" };

  const anyAction = legal.find((d) => d.type === "declare_action");
  if (anyAction) return { decision: anyAction, kind: "forced_action" };

  return null;
}
