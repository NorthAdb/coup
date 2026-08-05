import { useEffect, useRef, useState, type ReactNode } from "react";
import type { CharacterId, LegalDecision, SeatView } from "@coup/protocol";
import {
  actionDraftSummary,
  actionDraftToDecision,
  canConfirmActionDraft,
  type ActionDraft,
  type TargetedActionType,
  type UntargetedActionType,
} from "./actionDraft";
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
  exchangeKeepSummary,
  keepCountNeeded,
  returnCardIdsFromKeep,
  toggleKeepSelection,
} from "./exchangeKeep";
import {
  ACTION_LABEL,
  CHARACTER_LABEL,
  eventParts,
  phaseHint,
  rationaleSourceLabel,
  ROLE_CARD,
  seatModelLabel,
  type DecisionRationaleView,
  type SeatCallout,
  type TextPart,
} from "./matchCopy";
import {
  buildResultBeatSteps,
  heavyBeatHoldMs,
  lightBeatHoldMs,
  yourTurnStageBeat,
  type StageBeat,
} from "./resultBeat";
import {
  AbsenceDrawer,
  absenceSeatStatus,
  type AbsenceDispositionAction,
  type SeatAbsenceView,
} from "./AbsenceDrawer";
import { RulesPanel } from "./RulesPanel";
import { seatTintClass, seatTintClassForId } from "./seatColor";
import { TextPartsView } from "./textParts";

type AgentPhase = "idle" | "thinking" | "validating" | "retrying" | "failed";

type DeskOverlay =
  | { kind: "reveal"; character: CharacterId; caption: string }
  | { kind: "draw"; caption: string };

type MatchDeskProps = {
  view: SeatView;
  busy: boolean;
  agentPhase: AgentPhase;
  decisionRationales: Record<string, DecisionRationaleView>;
  onSubmitDecision: (decision: LegalDecision, label: string) => void;
  onReturnToSetup: () => void;
  returnLabel?: string;
  absences?: SeatAbsenceView[];
  pausedForAbsenceSeatId?: string | null;
  isHost?: boolean;
  showResume?: boolean;
  onAbsenceDisposition?: (
    seatId: string,
    action: AbsenceDispositionAction,
  ) => void;
  onResumeSeat?: () => void;
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
  actionType: UntargetedActionType,
): boolean {
  return decisions.some(
    (decision) =>
      decision.type === "declare_action" &&
      decision.action.type === actionType,
  );
}

function targetsFor(
  decisions: LegalDecision[],
  actionType: TargetedActionType,
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
  titleParts: TextPart[];
  text: string;
  claim: string | null;
} {
  const { publicState } = view;
  const seats = publicState.seats;
  const pending = publicState.pendingAction;
  const text = (value: string): TextPart => ({ type: "text", text: value });
  const seat = (seatId: string): TextPart => ({
    type: "seat",
    seatId,
    text: seatName(seats, seatId),
  });

  if (publicState.status === "finished") {
    const finished = view.projectedHistory.find(
      (event) => event.type === "match_finished",
    );
    const winnerId =
      finished?.type === "match_finished" ? finished.winnerSeatId : null;
    const titleParts: TextPart[] = winnerId
      ? [seat(winnerId), text(" 获胜")]
      : [text("有人 获胜")];
    return {
      eyebrow: "对局结束",
      title: titleParts.map((part) => part.text).join(""),
      titleParts,
      text: "本局已结束。可返回开局页查看事件列表或开新局。",
      claim: null,
    };
  }

  if (publicState.phase === "await_action") {
    const yours = publicState.currentSeatId === view.seatId;
    const titleParts: TextPart[] = yours
      ? [text("轮到你行动")]
      : [text("轮到 "), seat(publicState.currentSeatId)];
    return {
      eyebrow: "当前回合",
      title: titleParts.map((part) => part.text).join(""),
      titleParts,
      text: yours
        ? "从底部合法行动栏选择一项；需要目标时先点行动再点高亮座位，经确认条提交。"
        : "对手正在决策，舞台保持等待。",
      claim: null,
    };
  }

  if (pending) {
    const actionLabel = ACTION_LABEL[pending.action.type] ?? pending.action.type;
    const titleParts: TextPart[] = [
      seat(pending.actorSeatId),
      text(` 声明「${actionLabel}」`),
    ];
    if (
      pending.action.type === "coup" ||
      pending.action.type === "assassinate" ||
      pending.action.type === "steal"
    ) {
      titleParts.push(text("，目标 "), seat(pending.action.targetSeatId));
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
      title: titleParts.map((part) => part.text).join(""),
      titleParts,
      text: phaseHint(publicState.phase),
      claim,
    };
  }

  return {
    eyebrow: "舞台",
    title: phaseHint(publicState.phase),
    titleParts: [text(phaseHint(publicState.phase))],
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

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function draftActionSummaryNodes(
  draft: ActionDraft,
  seats: SeatView["publicState"]["seats"],
): ReactNode {
  if (draft.kind === "untargeted") {
    return actionDraftSummary(draft, seats);
  }
  const label = ACTION_LABEL[draft.actionType] ?? draft.actionType;
  if (draft.targetSeatId == null) {
    return `${label} · 选择目标`;
  }
  return (
    <>
      {label}{" "}
      <span
        className={`seat-name-tint ${seatTintClassForId(seats, draft.targetSeatId)}`}
      >
        {seatName(seats, draft.targetSeatId)}
      </span>
    </>
  );
}

export function MatchDesk({
  view,
  busy,
  agentPhase,
  decisionRationales,
  onSubmitDecision,
  onReturnToSetup,
  returnLabel = "返回开局",
  absences = [],
  pausedForAbsenceSeatId = null,
  isHost = false,
  showResume = false,
  onAbsenceDisposition,
  onResumeSeat,
}: MatchDeskProps) {
  const [pace, setPace] = useState<DeskPace>(() => loadDeskPace());
  const [rulesOpen, setRulesOpen] = useState(false);
  const [overlay, setOverlay] = useState<DeskOverlay | null>(null);
  const [callouts, setCallouts] = useState<Record<string, SeatCallout>>({});
  const [stageBeat, setStageBeat] = useState<StageBeat | null>(null);
  const [replaying, setReplaying] = useState(false);
  const [actionDraft, setActionDraft] = useState<ActionDraft | null>(null);
  const [exchangeKeepSelected, setExchangeKeepSelected] = useState<string[]>(
    [],
  );
  const reducedMotion = usePrefersReducedMotion();
  const seenHistoryRef = useRef(view.projectedHistory.length);
  const matchIdRef = useRef(view.matchId);
  const eventListRef = useRef<HTMLOListElement | null>(null);
  const calloutTimersRef = useRef<Record<string, number>>({});
  const replayGenRef = useRef(0);

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
      replayGenRef.current += 1;
      setOverlay(null);
      setCallouts({});
      setStageBeat(null);
      setReplaying(false);
      setActionDraft(null);
      setExchangeKeepSelected([]);
      for (const timer of Object.values(calloutTimersRef.current)) {
        window.clearTimeout(timer);
      }
      calloutTimersRef.current = {};
    }
  }, [view.matchId, view.projectedHistory.length]);

  useEffect(() => {
    if (view.publicState.phase !== "await_exchange_selection") {
      setExchangeKeepSelected([]);
    }
  }, [view.publicState.phase, view.stateVersion]);

  useEffect(() => {
    if (view.publicState.phase !== "await_action") {
      setActionDraft(null);
    }
  }, [view.publicState.phase, view.stateVersion]);

  useEffect(() => {
    const history = view.projectedHistory;
    if (history.length <= seenHistoryRef.current) {
      seenHistoryRef.current = history.length;
      return;
    }
    const fresh = history.slice(seenHistoryRef.current);
    seenHistoryRef.current = history.length;

    const steps = buildResultBeatSteps(fresh, view.publicState.seats);
    const gen = ++replayGenRef.current;
    let cancelled = false;

    function showCallout(seatId: string, callout: SeatCallout) {
      const previousTimer = calloutTimersRef.current[seatId];
      if (previousTimer !== undefined) {
        window.clearTimeout(previousTimer);
      }
      setCallouts((current) => ({ ...current, [seatId]: callout }));
      calloutTimersRef.current[seatId] = window.setTimeout(() => {
        if (cancelled || replayGenRef.current !== gen) return;
        setCallouts((current) => {
          if (current[seatId]?.text !== callout.text) return current;
          const { [seatId]: _removed, ...rest } = current;
          return rest;
        });
        delete calloutTimersRef.current[seatId];
      }, calloutHoldMs(pace, reducedMotion));
    }

    async function runReplay() {
      if (steps.length === 0) return;
      setReplaying(true);

      for (const step of steps) {
        if (cancelled || replayGenRef.current !== gen) return;

        if (step.callout) {
          showCallout(step.callout.seatId, step.callout);
        }

        if (step.weight === "heavy" && step.stage) {
          setStageBeat(step.stage);
          let identityHeld = false;
          if (step.event.type === "claim_proven") {
            identityHeld = true;
            setOverlay({
              kind: "reveal",
              character: step.event.character,
              caption: "证明角色",
            });
            await waitMs(revealHoldMs(pace, reducedMotion));
            if (cancelled || replayGenRef.current !== gen) return;
            setOverlay({
              kind: "draw",
              caption: "洗回宫廷 · 抽取替代牌",
            });
            await waitMs(drawHoldMs(pace, reducedMotion));
            if (cancelled || replayGenRef.current !== gen) return;
            setOverlay(null);
          } else if (step.event.type === "influence_revealed") {
            identityHeld = true;
            setOverlay({
              kind: "reveal",
              character: step.event.character,
              caption: "失去影响力",
            });
            await waitMs(revealHoldMs(pace, reducedMotion));
            if (cancelled || replayGenRef.current !== gen) return;
            setOverlay(null);
          }
          if (!identityHeld) {
            await waitMs(heavyBeatHoldMs(pace, reducedMotion));
          }
        } else if (step.weight === "light") {
          await waitMs(lightBeatHoldMs(pace, reducedMotion));
        }
      }

      if (cancelled || replayGenRef.current !== gen) return;

      const finishedNow = view.publicState.status === "finished";
      if (!finishedNow && view.legalDecisions.length > 0) {
        setStageBeat(yourTurnStageBeat());
        await waitMs(lightBeatHoldMs(pace, reducedMotion));
      }

      if (cancelled || replayGenRef.current !== gen) return;
      setStageBeat(null);
      setOverlay(null);
      setReplaying(false);
    }

    void runReplay();

    return () => {
      cancelled = true;
      if (replayGenRef.current === gen) {
        setReplaying(false);
      }
    };
  }, [
    view.matchId,
    view.projectedHistory.length,
    pace,
    reducedMotion,
  ]);

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
  const pendingTarget =
    actionDraft?.kind === "targeted" ? actionDraft.actionType : null;
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
  const keepNeeded = exchangeHand ? keepCountNeeded(exchangeHand.length) : 0;
  const finished = view.publicState.status === "finished";
  const showActionConfirm =
    actionDraft != null && !showResponseBar && !showExchange && !finished;
  const actionsLocked =
    busy || replaying || showResponseBar || showExchange || finished;
  const liveStage = stageContent(view);
  const stage = stageBeat
    ? {
        ...stageBeat,
        titleParts: stageBeat.titleParts ?? [
          { type: "text" as const, text: stageBeat.title },
        ],
        claim: null as string | null,
      }
    : liveStage;
  const localSeat = view.publicState.seats.find(
    (seat) => seat.seatId === view.seatId,
  );
  const thinkingSeatId =
    agentPhase === "thinking" ||
    agentPhase === "validating" ||
    agentPhase === "retrying"
      ? view.publicState.activeSeatId
      : null;

  const keptLabels =
    exchangeHand
      ?.filter((card) => exchangeKeepSelected.includes(card.cardId))
      .map((card) => CHARACTER_LABEL[card.character]) ?? [];

  function cyclePace() {
    const next = toggleDeskPace(pace);
    setPace(next);
    saveDeskPace(next);
  }

  function selectUntargeted(actionType: UntargetedActionType) {
    setActionDraft((current) =>
      current?.kind === "untargeted" && current.actionType === actionType
        ? null
        : { kind: "untargeted", actionType },
    );
  }

  function selectTargeted(actionType: TargetedActionType) {
    setActionDraft((current) =>
      current?.kind === "targeted" && current.actionType === actionType
        ? null
        : { kind: "targeted", actionType, targetSeatId: null },
    );
  }

  function chooseTarget(targetSeatId: string) {
    setActionDraft((current) => {
      if (current?.kind !== "targeted") return current;
      return { ...current, targetSeatId };
    });
  }

  function confirmActionDraft() {
    if (!actionDraft) return;
    const decision = actionDraftToDecision(actionDraft);
    if (!decision) return;
    setActionDraft(null);
    onSubmitDecision(decision, `draft-${actionDraft.actionType}`);
  }

  function confirmExchangeKeep() {
    if (!exchangeHand || exchangeKeepSelected.length !== keepNeeded) return;
    const returnCardIds = returnCardIdsFromKeep(
      exchangeHand.map((card) => card.cardId),
      exchangeKeepSelected,
    );
    setExchangeKeepSelected([]);
    onSubmitDecision(
      { type: "choose_exchange_cards", returnCardIds },
      "exchange-keep",
    );
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
            {returnLabel}
          </button>
        </div>
      </header>

      <main className="board desk-layout" aria-label="策划桌">
        <section className="opponents" aria-label="座位">
          {view.publicState.seats.map((seat, seatIndex) => {
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
            const callout = callouts[seat.seatId];
            return (
              <article
                key={seat.seatId}
                className={[
                  "seat",
                  seatTintClass(seatIndex),
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
                  <span
                    className={`seat-name seat-name-tint ${seatTintClass(seatIndex)}`}
                  >
                    {seat.displayName}
                  </span>
                  <span className="coin">{seat.coins}</span>
                </div>
                {callout ? (
                  <div className="seat-callout" role="status">
                    <TextPartsView
                      parts={callout.parts}
                      seats={view.publicState.seats}
                    />
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
                      : (absenceSeatStatus(absences, seat.seatId) ??
                        (isCurrent
                          ? "当前回合"
                          : isActive
                            ? "待响应"
                            : "观察中"))}
                  </span>
                </div>
                {targetable && pendingTarget ? (
                  <button
                    type="button"
                    className="seat-target-button"
                    disabled={busy || replaying}
                    onClick={() => chooseTarget(seat.seatId)}
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
              <h2>
                <TextPartsView
                  parts={stage.titleParts}
                  seats={view.publicState.seats}
                />
              </h2>
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
              {replaying && !busy ? (
                <p className="agent-phase" aria-live="polite">
                  结果节拍回放中…
                </p>
              ) : null}

              {showExchange && exchangeHand ? (
                <div
                  className="response-bar confirmation-bar exchange-bar"
                  aria-label="交换选牌确认"
                >
                  <span className="confirm-summary">
                    {exchangeKeepSelected.length === keepNeeded
                      ? exchangeKeepSummary(keptLabels)
                      : `选择 ${keepNeeded} 张要保留的影响力`}
                  </span>
                  <div className="exchange-pick-row">
                    {exchangeHand.map((card) => {
                      const selected = exchangeKeepSelected.includes(
                        card.cardId,
                      );
                      return (
                        <button
                          key={card.cardId}
                          type="button"
                          className={
                            selected
                              ? "response-button primary"
                              : "response-button"
                          }
                          disabled={busy || replaying}
                          onClick={() =>
                            setExchangeKeepSelected((current) =>
                              toggleKeepSelection(
                                current,
                                card.cardId,
                                keepNeeded,
                              ),
                            )
                          }
                        >
                          {CHARACTER_LABEL[card.character]}
                        </button>
                      );
                    })}
                  </div>
                  <div className="confirm-actions">
                    <button
                      type="button"
                      className="response-button"
                      disabled={busy || replaying}
                      onClick={() => setExchangeKeepSelected([])}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      className="response-button primary"
                      disabled={
                        busy ||
                        replaying ||
                        exchangeKeepSelected.length !== keepNeeded
                      }
                      onClick={() => confirmExchangeKeep()}
                    >
                      确认
                    </button>
                  </div>
                </div>
              ) : null}

              {showActionConfirm && actionDraft ? (
                <div
                  className="response-bar confirmation-bar"
                  aria-label="行动确认"
                >
                  <span className="confirm-summary">
                    {draftActionSummaryNodes(
                      actionDraft,
                      view.publicState.seats,
                    )}
                  </span>
                  <div className="confirm-actions">
                    <button
                      type="button"
                      className="response-button"
                      disabled={busy || replaying}
                      onClick={() => setActionDraft(null)}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      className="response-button primary"
                      disabled={
                        busy ||
                        replaying ||
                        !canConfirmActionDraft(actionDraft)
                      }
                      onClick={() => confirmActionDraft()}
                    >
                      确认
                    </button>
                  </div>
                </div>
              ) : null}

              {showResponseBar && !showExchange ? (
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
                        disabled={busy || replaying}
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
                    ? "再点高亮座位选定目标，然后确认"
                    : showActionConfirm
                      ? "确认条确认后才会提交"
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
                  onClick={() => selectUntargeted("income")}
                >
                  收入
                  <small>+1</small>
                </button>
                <button
                  type="button"
                  className="action-button"
                  disabled={actionsLocked || !canForeignAid}
                  onClick={() => selectUntargeted("foreign_aid")}
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
                  onClick={() => selectTargeted("coup")}
                >
                  {pendingTarget === "coup" ? "取消政变" : "政变"}
                  <small>7 金币</small>
                </button>
                <button
                  type="button"
                  className="action-button"
                  disabled={actionsLocked || !canTax}
                  onClick={() => selectUntargeted("tax")}
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
                  onClick={() => selectTargeted("assassinate")}
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
                  onClick={() => selectTargeted("steal")}
                >
                  {pendingTarget === "steal" ? "取消偷窃" : "偷窃"}
                  <small>队长 · 目标</small>
                </button>
                <button
                  type="button"
                  className="action-button"
                  disabled={actionsLocked || !canExchange}
                  onClick={() => selectUntargeted("exchange")}
                >
                  交换
                  <small>大使</small>
                </button>
              </div>
            </div>
          </section>
        </div>

        <aside className="event-rail" aria-label="对局记录">
          {onAbsenceDisposition || showResume ? (
            <AbsenceDrawer
              absences={absences}
              seatNames={Object.fromEntries(
                view.publicState.seats.map((seat) => [
                  seat.seatId,
                  seat.displayName,
                ]),
              )}
              isHost={isHost}
              busy={busy}
              pausedForAbsenceSeatId={pausedForAbsenceSeatId}
              onDisposition={(seatId, action) =>
                onAbsenceDisposition?.(seatId, action)
              }
              showResume={showResume}
              onResume={onResumeSeat}
            />
          ) : null}
          <div className="rail-title">
            <span>对局记录</span>
            <span>{view.projectedHistory.length} 条</span>
          </div>
          <ol className="event-list" ref={eventListRef}>
            {view.projectedHistory.map((event, index) => (
              <li key={`${event.type}-${index}`} className="event">
                <TextPartsView
                  parts={eventParts(event, view.publicState.seats)}
                  seats={view.publicState.seats}
                />
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
