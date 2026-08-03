import { useEffect, useState } from "react";
import type { SeatView } from "@coup/protocol";

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
    case "action_declared":
      return `${name(event.seatId)} 声明收入`;
    case "action_resolved":
      return `${name(event.seatId)} 获得 ${event.coinsGained} 枚钱币`;
    case "turn_advanced":
      return `轮到 ${name(event.seatId)}`;
    default:
      return "事件";
  }
}

export function App() {
  const [view, setView] = useState<SeatView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  async function declareIncome() {
    if (!view) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/matches/current/decision", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          protocolVersion: 1,
          requestId: `req-${view.stateVersion}-income`,
          stateVersion: view.stateVersion,
          decision: { type: "declare_action", action: { type: "income" } },
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败");
    } finally {
      setBusy(false);
    }
  }

  const canIncome =
    !!view &&
    view.legalDecisions.some(
      (decision) =>
        decision.type === "declare_action" && decision.action.type === "income",
    );

  return (
    <main className="shell">
      <header className="top">
        <p className="eyebrow">本机自用</p>
        <h1>政变</h1>
        <p className="lede">2 座练习桌：你 vs Stub。本票只开放收入。</p>
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
              return (
                <article
                  key={seat.seatId}
                  className={isCurrent ? "seat current" : "seat"}
                >
                  <h2>{seat.displayName}</h2>
                  <p className="meta">
                    {seat.controller === "local_human" ? "本地人类" : "Stub Agent"}
                    {isCurrent ? " · 当前回合" : ""}
                  </p>
                  <p className="coins">{seat.coins} 枚钱币</p>
                  <p className="meta">影响力 {seat.influenceCount}</p>
                </article>
              );
            })}
          </section>

          <section className="panel hand" aria-label="你的隐藏牌">
            <h2>你的角色牌</h2>
            <p>
              {view.privateState.hiddenCharacters
                .map((id) => CHARACTER_LABEL[id] ?? id)
                .join(" · ")}
            </p>
          </section>

          <section className="panel actions" aria-label="行动">
            <button
              type="button"
              disabled={busy || !canIncome}
              onClick={() => void declareIncome()}
            >
              收入（+1）
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
