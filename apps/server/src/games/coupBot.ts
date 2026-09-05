/**
 * Coup 机器人启发式（AI 队友）。
 *
 * 从该座位的合法决策投影（projectForSeat）中挑一条：
 * 行动按 政变（≥10 强制）→ 收税 → 偷窃 → 暗杀 → 交换 → 收入 的优先级，
 * 防御上只拦偷窃（自称船长）、不轻信挑战、被抓自认（交牌最稳）。
 * 全部决策来自 legalDecisions，保证合法性；规划本身确定性（无随机）。
 */

import { projectForSeat, type MatchState } from "@coup/domain";
import type { LegalDecision } from "@coup/protocol";

export function planCoupBotDecision(
  state: MatchState,
  seatId: string,
): LegalDecision | null {
  let legal: LegalDecision[];
  try {
    legal = projectForSeat(state, seatId).legalDecisions;
  } catch {
    return null;
  }
  if (legal.length === 0) return null;

  // —— 防御性决策（谁欠响应就轮到谁，先于行动判断）——

  const block = legal.find((d) => d.type === "declare_block");
  const passBlock = legal.find((d) => d.type === "pass_block");
  if (passBlock || block) {
    // 只拦针对自己的偷窃（自称船长）；外国援助与其它动作不拦。
    const pending = state.pendingAction;
    const stealOnMe =
      pending?.action.type === "steal" && pending.actorSeatId !== seatId;
    if (stealOnMe && block) {
      return { type: "declare_block", claimedCharacter: "captain" };
    }
    if (passBlock) return passBlock;
    return block!;
  }

  const passChallenge = legal.find((d) => d.type === "pass_challenge");
  if (passChallenge) return passChallenge; // 不轻信挑战。

  const concede = legal.find((d) => d.type === "concede_claim");
  if (concede) return concede; // 被抓自认最稳。

  const reveal = legal.find((d) => d.type === "choose_influence_to_reveal");
  if (reveal) return reveal; // 交出第一张（投影保证合法）。

  const exchange = legal.find((d) => d.type === "choose_exchange_cards");
  if (exchange) return exchange;

  // —— 行动决策 ——

  const actions = legal.filter(
    (d): d is Extract<LegalDecision, { type: "declare_action" }> =>
      d.type === "declare_action",
  );
  if (actions.length === 0) return legal[0]!;

  const me = state.seats.find((s) => s.seatId === seatId);
  const rivals = state.seats.filter(
    (s) => s.seatId !== seatId && !s.eliminated && s.influences.length > 0,
  );
  const richest = [...rivals].sort((a, b) => b.coins - a.coins)[0];
  const strongest = [...rivals].sort((a, b) => b.influences.length - a.influences.length)[0];

  const pick = (type: string) => actions.find((d) => d.action.type === type);

  // ≥10 枚必须政变：打最富的对手。
  if ((me?.coins ?? 0) >= 10 && richest) {
    const coup = actions.find(
      (d) => d.action.type === "coup" && d.action.targetSeatId === richest.seatId,
    );
    if (coup) return coup;
  }
  const tax = pick("tax");
  if (tax) return tax;
  // 偷最富的（对方有钱才值得）。
  if (richest && richest.coins > 0) {
    const steal = actions.find(
      (d) => d.action.type === "steal" && d.action.targetSeatId === richest.seatId,
    );
    if (steal) return steal;
  }
  // 暗杀影响力最高者。
  if ((me?.coins ?? 0) >= 3 && strongest) {
    const assassinate = actions.find(
      (d) =>
        d.action.type === "assassinate" &&
        d.action.targetSeatId === strongest.seatId,
    );
    if (assassinate) return assassinate;
  }
  return pick("income") ?? actions[0]!;
}
