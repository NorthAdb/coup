import { useEffect, useState } from "react";
import type { LegalDecision, SeatView } from "@coup/protocol";
import { SetupPage } from "./SetupPage";
import {
  buildCreateMatchPayload,
  loadSetupDraft,
  saveSetupDraft,
  type MatchSetupDraft,
} from "./matchSetup";

const CHARACTER_LABEL: Record<string, string> = {
  duke: "公爵",
  assassin: "刺客",
  captain: "队长",
  ambassador: "大使",
  contessa: "伯爵夫人",
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

type TargetAction = "coup" | "assassinate" | "steal";

function eventText(
  event: SeatView["projectedHistory"][number],
  seats: SeatView["publicState"]["seats"],
): string {
  const name = (seatId: string) =>
    seats.find((seat) => seat.seatId === seatId)?.displayName ?? seatId;

  switch (event.type) {
    case "match_started":
      return "对局开始";
    case "action_declared": {
      const target =
        event.targetSeatId != null ? ` → ${name(event.targetSeatId)}` : "";
      return `${name(event.seatId)} 声明${ACTION_LABEL[event.actionType] ?? event.actionType}${target}`;
    }
    case "action_resolved": {
      if (event.actionType === "coup" && event.targetSeatId) {
        return `${name(event.seatId)} 政变命中 ${name(event.targetSeatId)}`;
      }
      if (event.actionType === "assassinate" && event.targetSeatId) {
        return `${name(event.seatId)} 刺杀命中 ${name(event.targetSeatId)}`;
      }
      if (event.actionType === "steal" && event.coinsStolen != null) {
        return `${name(event.seatId)} 偷走 ${event.coinsStolen} 枚（${name(event.targetSeatId ?? "")}）`;
      }
      if (event.actionType === "exchange") {
        return `${name(event.seatId)} 完成交换`;
      }
      if (event.coinsGained != null) {
        return `${name(event.seatId)} 获得 ${event.coinsGained} 枚钱币`;
      }
      return `${name(event.seatId)} 行动结算`;
    }
    case "action_failed": {
      const why = event.reason === "blocked" ? "被阻挡" : "被质疑推翻";
      return `${name(event.seatId)} 的${ACTION_LABEL[event.actionType] ?? event.actionType}${why}`;
    }
    case "block_declared":
      return `${name(event.seatId)} 声明阻挡（${CHARACTER_LABEL[event.claimedCharacter] ?? event.claimedCharacter}）`;
    case "response_passed":
      return `${name(event.seatId)} 放弃${event.responseType === "block" ? "阻挡" : "质疑"}`;
    case "challenge_declared":
      return `${name(event.seatId)} 质疑 ${name(event.againstSeatId)}`;
    case "claim_proven":
      return `${name(event.seatId)} 证明了 ${CHARACTER_LABEL[event.character] ?? event.character}`;
    case "claim_conceded":
      return `${name(event.seatId)} 放弃证明`;
    case "influence_revealed":
      return `${name(event.seatId)} 揭示 ${CHARACTER_LABEL[event.character] ?? event.character}`;
    case "seat_eliminated":
      return `${name(event.seatId)} 被淘汰`;
    case "match_finished":
      return `${name(event.winnerSeatId)} 获胜`;
    case "turn_advanced":
      return `轮到 ${name(event.seatId)}`;
    default:
      return "事件";
  }
}

function hasAction(
  decisions: LegalDecision[],
  actionType: "income" | "foreign_aid" | "tax" | "exchange",
): boolean {
  return decisions.some(
    (decision) =>
      decision.type === "declare_action" &&
      decision.action.type === actionType,
  );
}

function targetsFor(
  decisions: LegalDecision[],
  actionType: TargetAction,
): string[] {
  return decisions
    .filter(
      (decision): decision is Extract<LegalDecision, { type: "declare_action" }> =>
        decision.type === "declare_action" &&
        decision.action.type === actionType,
    )
    .map((decision) => {
      const action = decision.action;
      if (
        action.type === "coup" ||
        action.type === "assassinate" ||
        action.type === "steal"
      ) {
        return action.targetSeatId;
      }
      return "";
    })
    .filter(Boolean);
}

function phaseHint(phase: SeatView["publicState"]["phase"]): string {
  switch (phase) {
    case "await_action_challenge":
      return "可质疑此次角色声明";
    case "await_block":
      return "可声明阻挡或放弃";
    case "await_block_challenge":
      return "可质疑此次阻挡";
    case "await_claim_defense":
      return "证明或放弃证明";
    case "await_influence_reveal":
      return "选择失去的影响力";
    case "await_exchange_selection":
      return "选择归还宫廷的两张牌";
    default:
      return "请响应";
  }
}

export function App() {
  const [view, setView] = useState<SeatView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [setupDraft, setSetupDraft] = useState<MatchSetupDraft>(() =>
    loadSetupDraft(),
  );
  const [pendingTarget, setPendingTarget] = useState<TargetAction | null>(
    null,
  );
  const [exchangeSelected, setExchangeSelected] = useState<string[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/matches/current");
        if (response.ok) {
          const body = (await response.json()) as { view: SeatView };
          setView(body.view);
        }
      } catch {
        // no active match yet
      }
    })();
  }, []);

  function updateSetupDraft(draft: MatchSetupDraft) {
    setSetupDraft(draft);
    saveSetupDraft(draft);
  }

  async function startMatch() {
    setBusy(true);
    setError(null);
    setPendingTarget(null);
    setExchangeSelected([]);
    saveSetupDraft(setupDraft);
    try {
      const response = await fetch("/api/matches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildCreateMatchPayload(setupDraft)),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "无法创建对局");
      }
      const body = (await response.json()) as { view: SeatView };
      setView(body.view);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setBusy(false);
    }
  }

  function returnToSetup() {
    setView(null);
    setPendingTarget(null);
    setExchangeSelected([]);
    setError(null);
  }

  async function submitDecision(decision: LegalDecision, label: string) {
    if (!view) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/matches/current/decision", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          protocolVersion: 1,
          requestId: `req-${view.stateVersion}-${label}`,
          stateVersion: view.stateVersion,
          decision,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "提交失败");
      }
      const body = (await response.json()) as { view: SeatView };
      setView(body.view);
      setPendingTarget(null);
      setExchangeSelected([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败");
    } finally {
      setBusy(false);
    }
  }

  const decisions = view?.legalDecisions ?? [];
  const canIncome = hasAction(decisions, "income");
  const canForeignAid = hasAction(decisions, "foreign_aid");
  const canTax = hasAction(decisions, "tax");
  const canExchange = hasAction(decisions, "exchange");
  const coupTargetIds = targetsFor(decisions, "coup");
  const assassinateTargetIds = targetsFor(decisions, "assassinate");
  const stealTargetIds = targetsFor(decisions, "steal");
  const activeTargetIds =
    pendingTarget === "coup"
      ? coupTargetIds
      : pendingTarget === "assassinate"
        ? assassinateTargetIds
        : pendingTarget === "steal"
          ? stealTargetIds
          : [];
  const responseDecisions = decisions.filter((decision) =>
    [
      "pass_block",
      "declare_block",
      "pass_challenge",
      "challenge_claim",
      "prove_claim",
      "concede_claim",
      "choose_influence_to_reveal",
    ].includes(decision.type),
  );
  const showResponseBar = responseDecisions.length > 0;
  const exchangeHand = view?.privateState.exchangeHand ?? null;
  const showExchange =
    view?.publicState.phase === "await_exchange_selection" &&
    exchangeHand != null &&
    exchangeHand.length > 0;
  const finished = view?.publicState.status === "finished";

  function toggleTargetMode(action: TargetAction) {
    setPendingTarget((current) => (current === action ? null : action));
  }

  function toggleExchangeCard(cardId: string) {
    setExchangeSelected((current) => {
      if (current.includes(cardId)) {
        return current.filter((id) => id !== cardId);
      }
      if (current.length >= 2) {
        return [current[1]!, cardId];
      }
      return [...current, cardId];
    });
  }

  function submitExchange() {
    if (exchangeSelected.length !== 2) return;
    const [a, b] = exchangeSelected;
    void submitDecision(
      {
        type: "choose_exchange_cards",
        returnCardIds: [a!, b!],
      },
      "exchange-return",
    );
  }

  return (
    <main className="shell">
      <header className="top">
        <p className="eyebrow">本机自用</p>
        <h1>政变</h1>
        <p className="lede">
          {view
            ? `${view.publicState.seats.length} 人桌 · 本地玩家先手，按座位顺时针。`
            : "配置 2–6 人桌：座位 1 固定为你，其余 Agent 座位选择 CLI 与模型后开局。"}
        </p>
      </header>

      {!view ? (
        <SetupPage
          draft={setupDraft}
          busy={busy}
          onChange={updateSetupDraft}
          onStart={() => void startMatch()}
        />
      ) : (
        <>
          {finished ? (
            <p className="hint">
              对局结束 —{" "}
              {(() => {
                const finishedEvent = view.projectedHistory.find(
                  (event) => event.type === "match_finished",
                );
                if (!finishedEvent || finishedEvent.type !== "match_finished") {
                  return "有人";
                }
                return (
                  view.publicState.seats.find(
                    (seat) => seat.seatId === finishedEvent.winnerSeatId,
                  )?.displayName ?? "有人"
                );
              })()}{" "}
              获胜
            </p>
          ) : null}

          <section className="panel seats" aria-label="公开座位">
            {view.publicState.seats.map((seat) => {
              const isCurrent = seat.seatId === view.publicState.currentSeatId;
              const isActive = seat.seatId === view.publicState.activeSeatId;
              const targetable =
                pendingTarget != null && activeTargetIds.includes(seat.seatId);
              return (
                <article
                  key={seat.seatId}
                  className={[
                    "seat",
                    isCurrent ? "current" : "",
                    isActive ? "active" : "",
                    targetable ? "targetable" : "",
                    seat.eliminated ? "eliminated" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <h2>{seat.displayName}</h2>
                  <p className="meta">
                    {seat.controller === "local_human" ? "本地人类" : "Stub Agent"}
                    {seat.eliminated ? " · 已淘汰" : ""}
                    {isCurrent && !seat.eliminated ? " · 当前回合" : ""}
                    {isActive && !isCurrent ? " · 待响应" : ""}
                  </p>
                  <p className="coins">{seat.coins} 枚钱币</p>
                  <p className="meta">影响力 {seat.influenceCount}</p>
                  {seat.revealedCharacters.length > 0 ? (
                    <p className="meta">
                      已揭示{" "}
                      {seat.revealedCharacters
                        .map((id) => CHARACTER_LABEL[id] ?? id)
                        .join(" · ")}
                    </p>
                  ) : null}
                  {targetable && pendingTarget ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void submitDecision(
                          {
                            type: "declare_action",
                            action: {
                              type: pendingTarget,
                              targetSeatId: seat.seatId,
                            },
                          },
                          `${pendingTarget}-${seat.seatId}`,
                        )
                      }
                    >
                      选定为目标
                    </button>
                  ) : null}
                </article>
              );
            })}
          </section>

          <section className="panel hand" aria-label="你的隐藏牌">
            <h2>你的角色牌</h2>
            <p>
              {view.privateState.hiddenCharacters
                .map((id) => CHARACTER_LABEL[id] ?? id)
                .join(" · ") || "无"}
            </p>
          </section>

          {showExchange ? (
            <section className="response-bar" aria-label="交换选牌">
              <span>点选恰好两张归还宫廷（对方看不到换了几张）</span>
              <div className="response-actions">
                {exchangeHand.map((card) => {
                  const selected = exchangeSelected.includes(card.cardId);
                  return (
                    <button
                      key={card.cardId}
                      type="button"
                      className={
                        selected
                          ? "response-button primary"
                          : "response-button"
                      }
                      disabled={busy}
                      onClick={() => toggleExchangeCard(card.cardId)}
                    >
                      {CHARACTER_LABEL[card.character] ?? card.character}
                    </button>
                  );
                })}
                <button
                  type="button"
                  className="response-button primary"
                  disabled={busy || exchangeSelected.length !== 2}
                  onClick={() => submitExchange()}
                >
                  确认归还
                </button>
              </div>
            </section>
          ) : null}

          {showResponseBar ? (
            <section className="response-bar" aria-label="响应">
              <span>{phaseHint(view.publicState.phase)}</span>
              <div className="response-actions">
                {responseDecisions.map((decision, index) => {
                  let label: string = decision.type;
                  if (decision.type === "pass_block") label = "放弃";
                  if (decision.type === "declare_block") {
                    label = `阻挡（${CHARACTER_LABEL[decision.claimedCharacter] ?? decision.claimedCharacter}）`;
                  }
                  if (decision.type === "pass_challenge") label = "放弃";
                  if (decision.type === "challenge_claim") label = "质疑";
                  if (decision.type === "concede_claim") label = "放弃证明";
                  if (decision.type === "prove_claim") {
                    label = `证明（${CHARACTER_LABEL[decision.character] ?? decision.character}）`;
                  }
                  if (decision.type === "choose_influence_to_reveal") {
                    label = `揭示 ${CHARACTER_LABEL[decision.character] ?? decision.character}`;
                  }
                  const primary =
                    decision.type === "challenge_claim" ||
                    decision.type === "declare_block";
                  return (
                    <button
                      key={`${decision.type}-${index}`}
                      type="button"
                      className={
                        primary ? "response-button primary" : "response-button"
                      }
                      disabled={busy}
                      onClick={() =>
                        void submitDecision(
                          decision,
                          `${decision.type}-${index}`,
                        )
                      }
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}

          <section className="panel actions" aria-label="行动">
            <button
              type="button"
              disabled={busy || !canIncome || showResponseBar || showExchange || finished}
              onClick={() =>
                void submitDecision(
                  { type: "declare_action", action: { type: "income" } },
                  "income",
                )
              }
            >
              收入（+1）
            </button>
            <button
              type="button"
              disabled={
                busy || !canForeignAid || showResponseBar || showExchange || finished
              }
              onClick={() =>
                void submitDecision(
                  { type: "declare_action", action: { type: "foreign_aid" } },
                  "foreign-aid",
                )
              }
            >
              外援（+2）
            </button>
            <button
              type="button"
              disabled={busy || !canTax || showResponseBar || showExchange || finished}
              onClick={() =>
                void submitDecision(
                  { type: "declare_action", action: { type: "tax" } },
                  "tax",
                )
              }
            >
              征税（+3）
            </button>
            <button
              type="button"
              disabled={
                busy ||
                assassinateTargetIds.length === 0 ||
                showResponseBar ||
                showExchange ||
                finished
              }
              onClick={() => toggleTargetMode("assassinate")}
            >
              {pendingTarget === "assassinate" ? "取消刺杀" : "刺杀（3）"}
            </button>
            <button
              type="button"
              disabled={
                busy ||
                stealTargetIds.length === 0 ||
                showResponseBar ||
                showExchange ||
                finished
              }
              onClick={() => toggleTargetMode("steal")}
            >
              {pendingTarget === "steal" ? "取消偷窃" : "偷窃"}
            </button>
            <button
              type="button"
              disabled={
                busy || !canExchange || showResponseBar || showExchange || finished
              }
              onClick={() =>
                void submitDecision(
                  { type: "declare_action", action: { type: "exchange" } },
                  "exchange",
                )
              }
            >
              交换
            </button>
            <button
              type="button"
              disabled={
                busy ||
                coupTargetIds.length === 0 ||
                showResponseBar ||
                showExchange ||
                finished
              }
              onClick={() => toggleTargetMode("coup")}
            >
              {pendingTarget === "coup" ? "取消政变" : "政变（7）"}
            </button>
            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={() => returnToSetup()}
            >
              返回开局
            </button>
          </section>

          {pendingTarget && activeTargetIds.length > 0 ? (
            <p className="hint">
              先点
              {pendingTarget === "coup"
                ? "政变"
                : pendingTarget === "assassinate"
                  ? "刺杀"
                  : "偷窃"}
              ，再点高亮座位选定目标。
            </p>
          ) : null}

          <section className="panel log" aria-label="对局事件">
            <h2>对局事件</h2>
            <ol>
              {view.projectedHistory.map((event, index) => (
                <li key={`${event.type}-${index}`}>
                  {eventText(event, view.publicState.seats)}
                </li>
              ))}
            </ol>
          </section>
        </>
      )}

      {error ? <p className="error">{error}</p> : null}
    </main>
  );
}
