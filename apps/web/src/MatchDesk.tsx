import { useEffect, useRef, useState } from "react";
import type { CharacterId, LegalDecision, SeatView } from "@coup/protocol";
import {
  calloutHoldMs,
  cssSpeedFactor,
  drawHoldMs,
  loadDeskPace,
  revealHoldMs,
  saveDeskPace,
  toggleDeskPace,
  type DeskPace,
} from "./deskPacing";
import {
  ACTION_LABEL,
  CHARACTER_LABEL,
  eventText,
  phaseHint,
  rationaleSourceLabel,
  ROLE_CARD,
  seatCalloutsFromEvents,
  seatModelLabel,
  type DecisionRationaleView,
} from "./matchCopy";
import { RulesPanel } from "./RulesPanel";

type TargetAction = "coup" | "assassinate" | "steal";
type AgentPhase = "idle" | "thinking" | "validating" | "retrying" | "failed";

type DeskOverlay =
  | { kind: "reveal"; character: CharacterId; caption: string }
  | { kind: "draw"; caption: string };

type MatchDeskProps = {
  view: SeatView;
  busy: boolean;
  agentPhase: AgentPhase;
  pendingTarget: TargetAction | null;
  exchangeSelected: string[];
  decisionRationales: Record<string, DecisionRationaleView>;
  onSubmitDecision: (decision: LegalDecision, label: string) => void;
  onToggleTarget: (action: TargetAction) => void;
  onToggleExchangeCard: (cardId: string) => void;
  onSubmitExchange: () => void;
  onReturnToSetup: () => void;
};

function agentPhaseLabel(phase: AgentPhase): string {
  switch (phase) {
    case "thinking":
      return "Agent 思考中…";
    case "validating":
      return "正在校验决策…";
    case "retrying":
      return "正在重试…";
    case "failed":
      return "调用失败";
    default:
      return "准备中…";
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

function seatName(
  seats: SeatView["publicState"]["seats"],
  seatId: string,
): string {
  return seats.find((seat) => seat.seatId === seatId)?.displayName ?? seatId;
}

function stageContent(view: SeatView): {
  eyebrow: string;
  title: string;
  text: string;
  claim: string | null;
} {
  const { publicState } = view;
  const seats = publicState.seats;
  const pending = publicState.pendingAction;

  if (publicState.status === "finished") {
    const finished = view.projectedHistory.find(
      (event) => event.type === "match_finished",
    );
    const winnerId =
      finished?.type === "match_finished" ? finished.winnerSeatId : null;
    return {
      eyebrow: "对局结束",
      title: `${winnerId ? seatName(seats, winnerId) : "有人"} 获胜`,
      text: "本局已结束。可返回开局页查看事件列表或开新局。",
      claim: null,
    };
  }

  if (publicState.phase === "await_action") {
    const current = seatName(seats, publicState.currentSeatId);
    const yours = publicState.currentSeatId === view.seatId;
    return {
      eyebrow: "当前回合",
      title: yours ? "轮到你行动" : `轮到 ${current}`,
      text: yours
        ? "从底部合法行动栏选择一项；需要目标时先点行动再点高亮座位。"
        : `${current} 正在决策，舞台保持等待。`,
      claim: null,
    };
  }

  if (pending) {
    const actor = seatName(seats, pending.actorSeatId);
    const actionLabel = ACTION_LABEL[pending.action.type] ?? pending.action.type;
    let targetText = "";
    if (
      pending.action.type === "coup" ||
      pending.action.type === "assassinate" ||
      pending.action.type === "steal"
    ) {
      targetText = `，目标 ${seatName(seats, pending.action.targetSeatId)}`;
    }

    let claim: string | null = null;
    if (pending.action.type === "tax") claim = "征税 · 公爵";
    if (pending.action.type === "assassinate") claim = "刺杀 · 刺客";
    if (pending.action.type === "steal") claim = "偷窃 · 队长";
    if (pending.action.type === "exchange") claim = "交换 · 大使";
    if (pending.blockerClaim) {
      claim = `阻挡 · ${CHARACTER_LABEL[pending.blockerClaim]}`;
    }

    return {
      eyebrow: "当前行动",
      title: `${actor} 声明「${actionLabel}」${targetText}`,
      text: phaseHint(publicState.phase),
      claim,
    };
  }

  return {
    eyebrow: "舞台",
    title: phaseHint(publicState.phase),
    text: "等待权威状态推进。",
    claim: null,
  };
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false,
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

export function MatchDesk({
  view,
  busy,
  agentPhase,
  pendingTarget,
  exchangeSelected,
  decisionRationales,
  onSubmitDecision,
  onToggleTarget,
  onToggleExchangeCard,
  onSubmitExchange,
  onReturnToSetup,
}: MatchDeskProps) {
  const [pace, setPace] = useState<DeskPace>(() => loadDeskPace());
  const [rulesOpen, setRulesOpen] = useState(false);
  const [overlay, setOverlay] = useState<DeskOverlay | null>(null);
  const [callouts, setCallouts] = useState<Record<string, string>>({});
  const reducedMotion = usePrefersReducedMotion();
  const seenHistoryRef = useRef(view.projectedHistory.length);
  const matchIdRef = useRef(view.matchId);
  const eventListRef = useRef<HTMLOListElement | null>(null);
  const calloutTimersRef = useRef<Record<string, number>>({});

  const speed = cssSpeedFactor(pace, reducedMotion);

  useEffect(() => {
    document.documentElement.style.setProperty("--speed", String(speed));
    return () => {
      document.documentElement.style.removeProperty("--speed");
    };
  }, [speed]);

  useEffect(() => {
    if (matchIdRef.current !== view.matchId) {
      matchIdRef.current = view.matchId;
      seenHistoryRef.current = view.projectedHistory.length;
      setOverlay(null);
      setCallouts({});
      for (const timer of Object.values(calloutTimersRef.current)) {
        window.clearTimeout(timer);
      }
      calloutTimersRef.current = {};
    }
  }, [view.matchId, view.projectedHistory.length]);

  useEffect(() => {
    const history = view.projectedHistory;
    if (history.length <= seenHistoryRef.current) {
      seenHistoryRef.current = history.length;
      return;
    }
    const fresh = history.slice(seenHistoryRef.current);
    seenHistoryRef.current = history.length;

    const proven = [...fresh]
      .reverse()
      .find((event) => event.type === "claim_proven");
    const revealed = [...fresh]
      .reverse()
      .find((event) => event.type === "influence_revealed");

    let cancelled = false;
    const timers: number[] = [];

    if (proven && proven.type === "claim_proven") {
      setOverlay({
        kind: "reveal",
        character: proven.character,
        caption: "证明角色",
      });
      timers.push(
        window.setTimeout(() => {
          if (cancelled) return;
          setOverlay({
            kind: "draw",
            caption: "洗回宫廷 · 抽取替代牌",
          });
          timers.push(
            window.setTimeout(() => {
              if (!cancelled) setOverlay(null);
            }, drawHoldMs(pace, reducedMotion)),
          );
        }, revealHoldMs(pace, reducedMotion)),
      );
    } else if (revealed && revealed.type === "influence_revealed") {
      setOverlay({
        kind: "reveal",
        character: revealed.character,
        caption: "失去影响力",
      });
      timers.push(
        window.setTimeout(() => {
          if (!cancelled) setOverlay(null);
        }, revealHoldMs(pace, reducedMotion)),
      );
    }

    const nextCallouts = seatCalloutsFromEvents(
      fresh,
      view.publicState.seats,
    );
    const hold = calloutHoldMs(pace, reducedMotion);
    for (const [seatId, text] of Object.entries(nextCallouts)) {
      const previousTimer = calloutTimersRef.current[seatId];
      if (previousTimer !== undefined) {
        window.clearTimeout(previousTimer);
      }
      setCallouts((current) => ({ ...current, [seatId]: text }));
      calloutTimersRef.current[seatId] = window.setTimeout(() => {
        if (cancelled) return;
        setCallouts((current) => {
          if (current[seatId] !== text) return current;
          const { [seatId]: _removed, ...rest } = current;
          return rest;
        });
        delete calloutTimersRef.current[seatId];
      }, hold);
    }

    return () => {
      cancelled = true;
      for (const id of timers) window.clearTimeout(id);
    };
  }, [view.projectedHistory, view.publicState.seats, pace, reducedMotion]);

  useEffect(() => {
    const list = eventListRef.current;
    if (list) {
      list.scrollTop = list.scrollHeight;
    }
  }, [view.projectedHistory.length]);

  useEffect(() => {
    if (!rulesOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setRulesOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rulesOpen]);

  const decisions = view.legalDecisions;
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
  const exchangeHand = view.privateState.exchangeHand ?? null;
  const showExchange =
    view.publicState.phase === "await_exchange_selection" &&
    exchangeHand != null &&
    exchangeHand.length > 0;
  const finished = view.publicState.status === "finished";
  const actionsLocked = busy || showResponseBar || showExchange || finished;
  const stage = stageContent(view);
  const localSeat = view.publicState.seats.find(
    (seat) => seat.seatId === view.seatId,
  );
  const thinkingSeatId =
    agentPhase === "thinking" ||
    agentPhase === "validating" ||
    agentPhase === "retrying"
      ? view.publicState.activeSeatId
      : null;

  function cyclePace() {
    const next = toggleDeskPace(pace);
    setPace(next);
    saveDeskPace(next);
  }

  return (
    <div className="desk-shell">
      <header className="desk-topbar">
        <div className="desk-brand">
          <h1>政变</h1>
          <span className="round-badge">
            {view.publicState.seats.length} 人桌 · v{view.stateVersion}
          </span>
        </div>
        <div className="top-actions">
          <button
            type="button"
            className="quiet-button"
            onClick={() => setRulesOpen(true)}
          >
            规则介绍
          </button>
          <button
            type="button"
            className="speed-button"
            onClick={() => cyclePace()}
            aria-pressed={pace === "fast"}
          >
            {pace === "fast" ? "快速模式" : "平衡节奏"}
          </button>
          <button
            type="button"
            className="quiet-button"
            disabled={busy}
            onClick={() => onReturnToSetup()}
          >
            返回开局
          </button>
        </div>
      </header>

      <main className="board desk-layout" aria-label="策划桌">
        <section className="opponents" aria-label="座位">
          {view.publicState.seats.map((seat) => {
            const isCurrent = seat.seatId === view.publicState.currentSeatId;
            const isActive = seat.seatId === view.publicState.activeSeatId;
            const targetable =
              pendingTarget != null && activeTargetIds.includes(seat.seatId);
            const hiddenCount = Math.max(
              0,
              seat.influenceCount - seat.revealedCharacters.length,
            );
            const rationale =
              thinkingSeatId === seat.seatId
                ? undefined
                : decisionRationales[seat.seatId];
            return (
              <article
                key={seat.seatId}
                className={[
                  "seat",
                  isCurrent ? "current" : "",
                  isActive ? "active" : "",
                  targetable ? "targetable" : "",
                  seat.eliminated ? "eliminated" : "",
                  rationale ? "has-rationale" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <div className="seat-header">
                  <span className="seat-name">{seat.displayName}</span>
                  <span className="coin">{seat.coins}</span>
                </div>
                {callouts[seat.seatId] ? (
                  <div className="seat-callout" role="status">
                    {callouts[seat.seatId]}
                  </div>
                ) : null}
                {rationale ? (
                  <div className="seat-rationale-panel">
                    <span className="seat-rationale-source">
                      {rationaleSourceLabel(rationale.source)}
                    </span>
                    <span className="seat-rationale-text">{rationale.text}</span>
                  </div>
                ) : null}
                <div className="mini-cards" aria-hidden="true">
                  {Array.from({ length: hiddenCount }, (_, index) => (
                    <span key={`h-${index}`} className="mini-card" />
                  ))}
                  {seat.revealedCharacters.map((character, index) => (
                    <span
                      key={`r-${character}-${index}`}
                      className="mini-card revealed"
                      title={CHARACTER_LABEL[character]}
                    />
                  ))}
                </div>
                <div className="seat-meta">
                  <span className="model-name">
                    {seatModelLabel(seat)}
                    {seat.seatId === view.seatId ? " · 你" : ""}
                  </span>
                  <span className="seat-status">
                    {seat.eliminated
                      ? "已淘汰"
                      : isCurrent
                        ? "当前回合"
                        : isActive
                          ? "待响应"
                          : "观察中"}
                  </span>
                </div>
                {targetable && pendingTarget ? (
                  <button
                    type="button"
                    className="seat-target-button"
                    disabled={busy}
                    onClick={() =>
                      onSubmitDecision(
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

        <div className="main-column">
          <section className="stage" aria-label="行动舞台">
            <div className="stage-card">
              <div className="eyebrow">{stage.eyebrow}</div>
              <h2>{stage.title}</h2>
              <p>{stage.text}</p>
              {stage.claim ? (
                <div className="claim-token entering">
                  <span>角色声明</span>
                  <strong>{stage.claim}</strong>
                </div>
              ) : null}
              {busy ? (
                <p className="agent-phase" aria-live="polite">
                  {agentPhaseLabel(agentPhase)}
                </p>
              ) : null}

              {showExchange ? (
                <div className="response-bar exchange-bar" aria-label="交换选牌">
                  <span>点选恰好两张归还宫廷</span>
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
                        onClick={() => onToggleExchangeCard(card.cardId)}
                      >
                        {CHARACTER_LABEL[card.character]}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className="response-button primary"
                    disabled={busy || exchangeSelected.length !== 2}
                    onClick={() => onSubmitExchange()}
                  >
                    确认归还
                  </button>
                </div>
              ) : null}

              {showResponseBar ? (
                <div className="response-bar" aria-label="响应">
                  <span>{phaseHint(view.publicState.phase)}</span>
                  {responseDecisions.map((decision, index) => {
                    let label: string = decision.type;
                    if (decision.type === "pass_block") label = "放弃";
                    if (decision.type === "declare_block") {
                      label = `阻挡（${CHARACTER_LABEL[decision.claimedCharacter]}）`;
                    }
                    if (decision.type === "pass_challenge") label = "放弃";
                    if (decision.type === "challenge_claim") label = "质疑";
                    if (decision.type === "concede_claim") label = "放弃证明";
                    if (decision.type === "prove_claim") {
                      label = `证明（${CHARACTER_LABEL[decision.character]}）`;
                    }
                    if (decision.type === "choose_influence_to_reveal") {
                      label = `揭示 ${CHARACTER_LABEL[decision.character]}`;
                    }
                    const primary =
                      decision.type === "challenge_claim" ||
                      decision.type === "declare_block";
                    return (
                      <button
                        key={`${decision.type}-${index}`}
                        type="button"
                        className={
                          primary
                            ? "response-button primary"
                            : "response-button"
                        }
                        disabled={busy}
                        onClick={() =>
                          onSubmitDecision(
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
              ) : null}
            </div>
          </section>

          <section className="player-zone" aria-label="手牌与行动">
            <div className="hand" aria-label="你的隐藏牌">
              {view.privateState.hiddenCharacters.length === 0 ? (
                <p className="hand-empty">无隐藏牌</p>
              ) : (
                view.privateState.hiddenCharacters.map((character, index) => {
                  const meta = ROLE_CARD[character];
                  return (
                    <article
                      key={`${character}-${index}`}
                      className="role-card"
                      style={{ ["--role" as string]: meta.tint }}
                    >
                      <div className="role-icon">{meta.icon}</div>
                      <span className="role-name">
                        {CHARACTER_LABEL[character]}
                      </span>
                      <span className="role-action">{meta.hint}</span>
                    </article>
                  );
                })
              )}
            </div>

            <div className="action-zone">
              <div className="action-label">
                <span>
                  {pendingTarget
                    ? "再点高亮座位选定目标"
                    : showResponseBar || showExchange
                      ? "请先处理舞台上的响应"
                      : finished
                        ? "对局已结束"
                        : "选择一个合法行动"}
                </span>
                <span>你的金币：{localSeat?.coins ?? 0}</span>
              </div>
              <div className="action-bar" aria-label="合法行动">
                <button
                  type="button"
                  className="action-button"
                  disabled={actionsLocked || !canIncome}
                  onClick={() =>
                    onSubmitDecision(
                      { type: "declare_action", action: { type: "income" } },
                      "income",
                    )
                  }
                >
                  收入
                  <small>+1</small>
                </button>
                <button
                  type="button"
                  className="action-button"
                  disabled={actionsLocked || !canForeignAid}
                  onClick={() =>
                    onSubmitDecision(
                      {
                        type: "declare_action",
                        action: { type: "foreign_aid" },
                      },
                      "foreign-aid",
                    )
                  }
                >
                  外援
                  <small>+2</small>
                </button>
                <button
                  type="button"
                  className="action-button"
                  disabled={
                    actionsLocked ||
                    coupTargetIds.length === 0 ||
                    (pendingTarget != null && pendingTarget !== "coup")
                  }
                  onClick={() => onToggleTarget("coup")}
                >
                  {pendingTarget === "coup" ? "取消政变" : "政变"}
                  <small>7 金币</small>
                </button>
                <button
                  type="button"
                  className="action-button"
                  disabled={actionsLocked || !canTax}
                  onClick={() =>
                    onSubmitDecision(
                      { type: "declare_action", action: { type: "tax" } },
                      "tax",
                    )
                  }
                >
                  征税
                  <small>公爵 · +3</small>
                </button>
                <button
                  type="button"
                  className="action-button"
                  disabled={
                    actionsLocked ||
                    assassinateTargetIds.length === 0 ||
                    (pendingTarget != null && pendingTarget !== "assassinate")
                  }
                  onClick={() => onToggleTarget("assassinate")}
                >
                  {pendingTarget === "assassinate" ? "取消刺杀" : "刺杀"}
                  <small>刺客 · 3</small>
                </button>
                <button
                  type="button"
                  className="action-button"
                  disabled={
                    actionsLocked ||
                    stealTargetIds.length === 0 ||
                    (pendingTarget != null && pendingTarget !== "steal")
                  }
                  onClick={() => onToggleTarget("steal")}
                >
                  {pendingTarget === "steal" ? "取消偷窃" : "偷窃"}
                  <small>队长 · 目标</small>
                </button>
                <button
                  type="button"
                  className="action-button"
                  disabled={actionsLocked || !canExchange}
                  onClick={() =>
                    onSubmitDecision(
                      { type: "declare_action", action: { type: "exchange" } },
                      "exchange",
                    )
                  }
                >
                  交换
                  <small>大使</small>
                </button>
              </div>
            </div>
          </section>
        </div>

        <aside className="event-rail" aria-label="对局记录">
          <div className="rail-title">
            <span>对局记录</span>
            <span>{view.projectedHistory.length} 条</span>
          </div>
          <ol className="event-list" ref={eventListRef}>
            {view.projectedHistory.map((event, index) => (
              <li key={`${event.type}-${index}`} className="event">
                {eventText(event, view.publicState.seats)}
              </li>
            ))}
          </ol>
        </aside>
      </main>

      {overlay?.kind === "reveal" ? (
        <div className="reveal-overlay" aria-live="polite">
          <div
            className="reveal-card"
            style={{ ["--role" as string]: ROLE_CARD[overlay.character].tint }}
          >
            <div className="role-icon">
              {ROLE_CARD[overlay.character].icon}
            </div>
            <strong>{CHARACTER_LABEL[overlay.character]}</strong>
            <p>{overlay.caption}</p>
          </div>
        </div>
      ) : null}

      {overlay?.kind === "draw" ? (
        <div className="draw-toast" aria-live="polite">
          <span className="draw-pulse" />
          <strong>{overlay.caption}</strong>
        </div>
      ) : null}

      <RulesPanel open={rulesOpen} onClose={() => setRulesOpen(false)} />
    </div>
  );
}
