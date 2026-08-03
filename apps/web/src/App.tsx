import { useEffect, useState } from "react";
import type { LegalDecision, SeatView } from "@coup/protocol";

const CHARACTER_LABEL: Record<string, string> = {
  duke: "公爵",
  assassin: "刺客",
  captain: "队长",
  ambassador: "大使",
  contessa: "伯爵夫人",
};

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
      const labels: Record<string, string> = {
        income: "收入",
        foreign_aid: "外援",
        coup: "政变",
      };
      return `${name(event.seatId)} 声明${labels[event.actionType] ?? event.actionType}${target}`;
    }
    case "action_resolved": {
      if (event.actionType === "coup" && event.targetSeatId) {
        return `${name(event.seatId)} 政变命中 ${name(event.targetSeatId)}`;
      }
      if (event.coinsGained != null) {
        return `${name(event.seatId)} 获得 ${event.coinsGained} 枚钱币`;
      }
      return `${name(event.seatId)} 行动结算`;
    }
    case "action_failed":
      return `${name(event.seatId)} 的外援被阻挡`;
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
  actionType: "income" | "foreign_aid",
): boolean {
  return decisions.some(
    (decision) =>
      decision.type === "declare_action" &&
      decision.action.type === actionType,
  );
}

function coupTargets(decisions: LegalDecision[]): string[] {
  return decisions
    .filter(
      (decision): decision is Extract<LegalDecision, { type: "declare_action" }> =>
        decision.type === "declare_action" && decision.action.type === "coup",
    )
    .map((decision) =>
      decision.action.type === "coup" ? decision.action.targetSeatId : "",
    )
    .filter(Boolean);
}

export function App() {
  const [view, setView] = useState<SeatView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingCoup, setPendingCoup] = useState(false);

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

  async function startMatch() {
    setBusy(true);
    setError(null);
    setPendingCoup(false);
    try {
      const response = await fetch("/api/matches", { method: "POST" });
      if (!response.ok) {
        throw new Error("无法创建对局");
      }
      const body = (await response.json()) as { view: SeatView };
      setView(body.view);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setBusy(false);
    }
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
      setPendingCoup(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败");
    } finally {
      setBusy(false);
    }
  }

  const decisions = view?.legalDecisions ?? [];
  const canIncome = hasAction(decisions, "income");
  const canForeignAid = hasAction(decisions, "foreign_aid");
  const coupTargetIds = coupTargets(decisions);
  const canCoup = coupTargetIds.length > 0;
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

  return (
    <main className="shell">
      <header className="top">
        <p className="eyebrow">本机自用</p>
        <h1>政变</h1>
        <p className="lede">
          2 座练习桌：你 vs Stub。本票开放收入、外援、政变与响应窗口。
        </p>
      </header>

      {!view ? (
        <section className="panel">
          <button type="button" disabled={busy} onClick={() => void startMatch()}>
            开始对局
          </button>
        </section>
      ) : (
        <>
          <section className="panel seats" aria-label="公开座位">
            {view.publicState.seats.map((seat) => {
              const isCurrent = seat.seatId === view.publicState.currentSeatId;
              const isActive = seat.seatId === view.publicState.activeSeatId;
              const coupSelectable =
                pendingCoup && coupTargetIds.includes(seat.seatId);
              return (
                <article
                  key={seat.seatId}
                  className={[
                    "seat",
                    isCurrent ? "current" : "",
                    isActive ? "active" : "",
                    coupSelectable ? "targetable" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <h2>{seat.displayName}</h2>
                  <p className="meta">
                    {seat.controller === "local_human" ? "本地人类" : "Stub Agent"}
                    {isCurrent ? " · 当前回合" : ""}
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
                  {coupSelectable ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void submitDecision(
                          {
                            type: "declare_action",
                            action: {
                              type: "coup",
                              targetSeatId: seat.seatId,
                            },
                          },
                          `coup-${seat.seatId}`,
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

          {showResponseBar ? (
            <section className="response-bar" aria-label="响应">
              <span>
                {view.publicState.phase === "await_block"
                  ? "外援可被公爵阻挡"
                  : view.publicState.phase === "await_block_challenge"
                    ? "可质疑此次阻挡"
                    : view.publicState.phase === "await_claim_defense"
                      ? "证明或放弃证明"
                      : view.publicState.phase === "await_influence_reveal"
                        ? "选择失去的影响力"
                        : "请响应"}
              </span>
              <div className="response-actions">
                {responseDecisions.map((decision, index) => {
                  let label: string = decision.type;
                  if (decision.type === "pass_block") label = "放弃";
                  if (decision.type === "declare_block") label = "阻挡（公爵）";
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
              disabled={busy || !canIncome || showResponseBar}
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
              disabled={busy || !canForeignAid || showResponseBar}
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
              disabled={busy || !canCoup || showResponseBar}
              onClick={() => setPendingCoup((value) => !value)}
            >
              {pendingCoup ? "取消政变" : "政变（7）"}
            </button>
            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={() => void startMatch()}
            >
              重新开局
            </button>
          </section>

          {pendingCoup && canCoup ? (
            <p className="hint">先点政变，再点高亮座位选定目标。</p>
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
