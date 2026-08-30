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
  CardBack,
  CharacterCardFace,
  CharacterCrest,
  CharacterMiniFace,
  ROLE_VISUAL,
} from "./characterArt";
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
import { RulesPanel } from "./RulesPanel";
import { seatTintClass, seatTintClassForId } from "./seatColor";
import { sfx, type SfxName } from "./sfx";
import { TextPartsView } from "./textParts";

type AgentPhase = "idle" | "thinking" | "validating" | "retrying" | "failed";

type DeskOverlay =
  | { kind: "reveal"; character: CharacterId; caption: string }
  | { kind: "draw"; caption: string };

type Toast = { id: number; text: string; tone: "info" | "warn" };

/** 权威侧回合计时（ADR-0008）；durationMs 为本期限总时长。 */
export type TurnDeadline = {
  seatId: string;
  deadlineAt: number;
  durationMs: number;
};

/** 服务器超时代为提交的自动决策提示。 */
export type AutoDecisionNotice = {
  seatId: string;
  at: number;
  kind: "pass" | "income" | "concede" | "reveal" | "exchange";
};

const AUTO_KIND_LABEL: Record<AutoDecisionNotice["kind"], string> = {
  pass: "自动放弃",
  income: "自动收入",
  concede: "自动放弃证明",
  reveal: "自动揭示影响力",
  exchange: "自动完成交换",
};

export type MatchDeskProps = {
  view: SeatView;
  busy: boolean;
  agentPhase: AgentPhase;
  decisionRationales: Record<string, DecisionRationaleView>;
  onSubmitDecision: (decision: LegalDecision, label: string) => void;
  onReturnToSetup: () => void;
  returnLabel?: string;
  onRematch?: () => void;
  /** 座位状态补充文案（如离席/回席）；返回 null 时回落默认状态。 */
  seatStatusFor?: (seatId: string) => string | null;
  /** 联机版传入的离席抽屉等旁路 UI；本机版留空。 */
  absenceSlot?: ReactNode;
  /** 房间号（联机版传入，顶栏展示）。 */
  roomCode?: string | null;
  /** 权威回合计时；null 表示未启用或当前无人欠决策。 */
  turnDeadline?: TurnDeadline | null;
  /** 服务器超时自动决策（用于「超时」提示）。 */
  autoDecision?: AutoDecisionNotice | null;
  /** 观战模式：只读桌面，不渲染行动与响应控件。 */
  spectator?: boolean;
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

/** 事件音效映射：表现层把领域事件翻译成可听的节拍。 */
function sfxForEvent(event: SeatView["projectedHistory"][number]): SfxName | null {
  switch (event.type) {
    case "action_declared":
      return event.actionType === "coup" || event.actionType === "assassinate"
        ? "challenge"
        : "deal";
    case "action_resolved":
      return event.coinsGained != null || event.coinsStolen != null
        ? "coin"
        : "flip";
    case "block_declared":
      return "block";
    case "challenge_declared":
      return "challenge";
    case "response_passed":
      return "click";
    case "claim_proven":
      return "flip";
    case "claim_conceded":
      return "flip";
    case "influence_revealed":
      return "reveal";
    case "seat_eliminated":
      return "eliminate";
    case "host_absence_elimination":
      return "eliminate";
    case "match_finished":
      return "victory";
    default:
      return null;
  }
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
    const mine = winnerId === view.seatId;
    const titleParts: TextPart[] = winnerId
      ? [seat(winnerId), text(mine ? " 加冕称帝" : " 执掌宫廷")]
      : [text("尘埃落定")];
    return {
      eyebrow: mine ? "胜利" : "对局结束",
      title: titleParts.map((part) => part.text).join(""),
      titleParts,
      text: mine
        ? "你在宫廷的博弈中笑到了最后。"
        : "本局已结束。房主可开启续局，或返回房间。",
      claim: null,
    };
  }

  if (publicState.phase === "await_action") {
    const yours = publicState.currentSeatId === view.seatId;
    const titleParts: TextPart[] = yours
      ? [text("轮到你行动")]
      : [seat(publicState.currentSeatId), text(" 的回合")];
    return {
      eyebrow: "当前回合",
      title: titleParts.map((part) => part.text).join(""),
      titleParts,
      text: yours
        ? "从底部选择一项行动；需要目标时先点行动，再点桌面上的高亮座位。"
        : "静观其变，把握质疑与阻挡的时机。",
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

/** SVG 倒计时环：谁欠决策一目了然。 */
function TurnTimerRing({
  deadline,
  mySeatId,
  busy,
}: {
  deadline: TurnDeadline;
  mySeatId: string;
  busy: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  const lastTickRef = useRef(-1);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, []);

  const remainingMs = Math.max(0, deadline.deadlineAt - now);
  const remainingSec = Math.ceil(remainingMs / 1000);
  const fraction = Math.max(
    0,
    Math.min(1, remainingMs / Math.max(1, deadline.durationMs)),
  );
  const mine = deadline.seatId === mySeatId;
  const urgent = mine && remainingSec <= 10;
  const dash = 2 * Math.PI * 20;

  useEffect(() => {
    if (!mine || busy) return;
    if (remainingSec <= 5 && remainingSec > 0 && lastTickRef.current !== remainingSec) {
      lastTickRef.current = remainingSec;
      sfx.play("tick");
    }
  }, [mine, busy, remainingSec]);

  return (
    <div
      className={[
        "turn-timer",
        mine ? "mine" : "theirs",
        urgent ? "urgent" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      role="timer"
      aria-label={mine ? `你的剩余时间 ${remainingSec} 秒` : `剩余时间 ${remainingSec} 秒`}
    >
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r="20" className="turn-timer-track" />
        <circle
          cx="24"
          cy="24"
          r="20"
          className="turn-timer-arc"
          strokeDasharray={`${dash * fraction} ${dash}`}
        />
      </svg>
      <span className="turn-timer-num">{remainingSec}</span>
      <span className="turn-timer-who">{mine ? "你的时间" : "对方时间"}</span>
    </div>
  );
}

/** 座位头像：座位色圆徽 + 显示名首字。 */
function SeatAvatar({
  name,
  tintClass,
  eliminated,
}: {
  name: string;
  tintClass: string;
  eliminated: boolean;
}) {
  return (
    <span className={`seat-avatar ${tintClass}${eliminated ? " dead" : ""}`} aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
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

/** 对手座位卡：头像、钱币、影响力（暗牌背/明牌纹章）、状态与目标选择。 */
function OpponentSeat({
  seat,
  seatIndex,
  view,
  spectator,
  busy,
  replaying,
  pendingTarget,
  activeTargetIds,
  callout,
  rationale,
  turnDeadline,
  seatStatusFor,
  onChooseTarget,
}: {
  seat: SeatView["publicState"]["seats"][number];
  seatIndex: number;
  view: SeatView;
  spectator: boolean;
  busy: boolean;
  replaying: boolean;
  pendingTarget: TargetedActionType | null;
  activeTargetIds: string[];
  callout: SeatCallout | null;
  rationale: DecisionRationaleView | undefined;
  turnDeadline: TurnDeadline | null;
  seatStatusFor: MatchDeskProps["seatStatusFor"];
  onChooseTarget: (seatId: string) => void;
}) {
  const isCurrent = seat.seatId === view.publicState.currentSeatId;
  const isActive = seat.seatId === view.publicState.activeSeatId;
  const targetable =
    !spectator &&
    pendingTarget != null &&
    activeTargetIds.includes(seat.seatId);
  const hiddenCount = Math.max(
    0,
    seat.influenceCount - seat.revealedCharacters.length,
  );
  const deadline = turnDeadline;
  const [timerFraction, setTimerFraction] = useState(1);

  useEffect(() => {
    if (!deadline) return;
    const update = () =>
      setTimerFraction(
        Math.max(
          0,
          Math.min(
            1,
            (deadline.deadlineAt - Date.now()) /
              Math.max(1, deadline.durationMs),
          ),
        ),
      );
    update();
    const id = window.setInterval(update, 300);
    return () => window.clearInterval(id);
  }, [deadline]);

  return (
    <article
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
      onClick={
        targetable && !busy && !replaying
          ? () => onChooseTarget(seat.seatId)
          : undefined
      }
    >
      {deadline && !seat.eliminated ? (
        <div className="seat-timer" aria-hidden="true">
          <span className="seat-timer-bar" style={{ transform: `scaleX(${timerFraction})` }} />
        </div>
      ) : null}
      <div className="seat-header">
        <SeatAvatar
          name={seat.displayName}
          tintClass={seatTintClass(seatIndex)}
          eliminated={seat.eliminated}
        />
        <span className={`seat-name seat-name-tint ${seatTintClass(seatIndex)}`}>
          {seat.displayName}
        </span>
        <span className="coin">
          <span className="coin-icon" aria-hidden="true">
            <svg viewBox="0 0 16 16">
              <circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </span>
          {seat.coins}
        </span>
      </div>
      {callout ? (
        <div className="seat-callout" role="status">
          <TextPartsView parts={callout.parts} seats={view.publicState.seats} />
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
          <span key={`h-${index}`} className="mini-card">
            <CardBack className="mini-back-svg" />
          </span>
        ))}
        {seat.revealedCharacters.map((character, index) => (
          <span
            key={`r-${character}-${index}`}
            className="mini-card revealed"
            title={CHARACTER_LABEL[character]}
          >
            <CharacterMiniFace character={character} />
          </span>
        ))}
      </div>
      <div className="seat-meta">
        <span className="model-name">{seatModelLabel(seat)}</span>
        <span className="seat-status">
          {seat.eliminated
            ? "已出局"
            : (seatStatusFor?.(seat.seatId) ??
              (isCurrent ? "行动中" : isActive ? "待响应" : "观战中"))}
        </span>
      </div>
      {targetable && pendingTarget ? (
        <span className="seat-target-hint">点此选为目标</span>
      ) : null}
    </article>
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
  onRematch,
  seatStatusFor,
  absenceSlot,
  roomCode,
  turnDeadline,
  autoDecision,
  spectator = false,
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
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [soundOn, setSoundOn] = useState(() => sfx.isEnabled());
  const reducedMotion = usePrefersReducedMotion();
  const seenHistoryRef = useRef(view.projectedHistory.length);
  const matchIdRef = useRef(view.matchId);
  const eventListRef = useRef<HTMLOListElement | null>(null);
  const calloutTimersRef = useRef<Record<string, number>>({});
  const replayGenRef = useRef(0);
  const toastSeqRef = useRef(0);
  const seenAutoAtRef = useRef(autoDecision?.at ?? 0);
  const wasMyTurnRef = useRef(
    view.publicState.phase === "await_action" &&
      view.publicState.currentSeatId === view.seatId,
  );

  const speed = cssSpeedFactor(pace, reducedMotion);

  useEffect(() => {
    document.documentElement.style.setProperty("--speed", String(speed));
    return () => {
      document.documentElement.style.removeProperty("--speed");
    };
  }, [speed]);

  function pushToast(text: string, tone: Toast["tone"] = "info") {
    const id = ++toastSeqRef.current;
    setToasts((current) => [...current.slice(-2), { id, text, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3800);
  }

  // 服务器超时代决策提示（ADR-0008）
  useEffect(() => {
    if (autoDecision && autoDecision.at > seenAutoAtRef.current) {
      seenAutoAtRef.current = autoDecision.at;
      pushToast(
        `${seatName(view.publicState.seats, autoDecision.seatId)} 超时，${AUTO_KIND_LABEL[autoDecision.kind]}`,
        "warn",
      );
      sfx.play("timeout");
    }
  }, [autoDecision?.at, autoDecision?.seatId, autoDecision?.kind]);

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
      sfx.play("deal");
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

  const myTurnNow =
    !spectator &&
    view.publicState.status !== "finished" &&
    view.publicState.phase === "await_action" &&
    view.publicState.currentSeatId === view.seatId;

  // 轮到你：提示音 + 舞台脉冲
  useEffect(() => {
    if (myTurnNow && !wasMyTurnRef.current && !replaying && !busy) {
      sfx.play("turn");
    }
    wasMyTurnRef.current = myTurnNow;
  }, [myTurnNow, replaying, busy]);

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

        const beatSound = sfxForEvent(step.event);
        if (beatSound) {
          sfx.play(beatSound);
        }

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
  const showResponseBar = !spectator && responseDecisions.length > 0;
  const exchangeHand = view.privateState.exchangeHand ?? null;
  const showExchange =
    !spectator &&
    view.publicState.phase === "await_exchange_selection" &&
    exchangeHand != null &&
    exchangeHand.length > 0;
  const keepNeeded = exchangeHand ? keepCountNeeded(exchangeHand.length) : 0;
  const finished = view.publicState.status === "finished";
  const showActionConfirm =
    actionDraft != null && !showResponseBar && !showExchange && !finished;
  const actionsLocked =
    spectator ||
    busy ||
    replaying ||
    showResponseBar ||
    showExchange ||
    finished;
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
  const winnerId = finished
    ? (() => {
        const finishedEvent = view.projectedHistory.find(
          (event) => event.type === "match_finished",
        );
        return finishedEvent?.type === "match_finished"
          ? finishedEvent.winnerSeatId
          : null;
      })()
    : null;
  const iWon = winnerId != null && winnerId === view.seatId;

  const keptLabels =
    exchangeHand
      ?.filter((card) => exchangeKeepSelected.includes(card.cardId))
      .map((card) => CHARACTER_LABEL[card.character]) ?? [];

  function cyclePace() {
    const next = toggleDeskPace(pace);
    setPace(next);
    saveDeskPace(next);
    sfx.play("click");
  }

  function toggleSound() {
    const next = !soundOn;
    setSoundOn(next);
    sfx.setEnabled(next);
    if (next) {
      sfx.play("confirm");
    }
  }

  function selectUntargeted(actionType: UntargetedActionType) {
    sfx.play("click");
    setActionDraft((current) =>
      current?.kind === "untargeted" && current.actionType === actionType
        ? null
        : { kind: "untargeted", actionType },
    );
  }

  function selectTargeted(actionType: TargetedActionType) {
    sfx.play("click");
    setActionDraft((current) =>
      current?.kind === "targeted" && current.actionType === actionType
        ? null
        : { kind: "targeted", actionType, targetSeatId: null },
    );
  }

  function chooseTarget(targetSeatId: string) {
    sfx.play("confirm");
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
    sfx.play("confirm");
    onSubmitDecision(decision, `draft-${actionDraft.actionType}`);
  }

  function confirmExchangeKeep() {
    if (!exchangeHand || exchangeKeepSelected.length !== keepNeeded) return;
    const returnCardIds = returnCardIdsFromKeep(
      exchangeHand.map((card) => card.cardId),
      exchangeKeepSelected,
    );
    setExchangeKeepSelected([]);
    sfx.play("confirm");
    onSubmitDecision(
      { type: "choose_exchange_cards", returnCardIds },
      "exchange-keep",
    );
  }

  function submitResponse(decision: LegalDecision) {
    if (decision.type === "challenge_claim") {
      sfx.play("challenge");
    } else if (decision.type === "declare_block") {
      sfx.play("block");
    } else {
      sfx.play("click");
    }
    onSubmitDecision(decision, `${decision.type}`);
  }

  const aliveSeats = view.publicState.seats.filter((seat) => !seat.eliminated);

  return (
    <div className="desk-shell">
      <header className="desk-topbar">
        <div className="desk-brand">
          <span className="brand-crest" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path
                d="M4 18 L6 9 L10 13 L12 5 L14 13 L18 9 L20 18 Z"
                fill="currentColor"
              />
              <rect x="4" y="19" width="16" height="2" rx="1" fill="currentColor" />
            </svg>
          </span>
          <h1>政变</h1>
          {roomCode ? (
            <span className="room-chip">
              房间 {roomCode} · {aliveSeats.length}/{view.publicState.seats.length} 人
            </span>
          ) : (
            <span className="room-chip">
              {view.publicState.seats.length} 人对局
            </span>
          )}
          {spectator ? <span className="spectator-chip">观战中</span> : null}
        </div>
        <div className="top-actions">
          <button
            type="button"
            className={`icon-button${soundOn ? " on" : ""}`}
            onClick={toggleSound}
            aria-pressed={soundOn}
            title={soundOn ? "关闭音效" : "开启音效"}
          >
            {soundOn ? "🔊" : "🔇"}
          </button>
          <button
            type="button"
            className="quiet-button"
            onClick={() => setRulesOpen(true)}
          >
            规则
          </button>
          <button
            type="button"
            className="speed-button"
            onClick={() => cyclePace()}
            aria-pressed={pace === "fast"}
          >
            {pace === "fast" ? "快节奏" : "从容"}
          </button>
          {finished && onRematch ? (
            <button
              type="button"
              className="quiet-button accent"
              disabled={busy}
              onClick={() => {
                sfx.play("click");
                onRematch();
              }}
            >
              续局等待
            </button>
          ) : null}
          <button
            type="button"
            className="quiet-button"
            disabled={busy}
            onClick={() => {
              sfx.play("click");
              onReturnToSetup();
            }}
          >
            {returnLabel}
          </button>
        </div>
      </header>

      <main className="board desk-layout" aria-label="宫廷牌桌">
        <section className="table-zone">
          <section className="opponents-strip" aria-label="座位">
            {view.publicState.seats.map((seat, seatIndex) => {
              if (seat.seatId === view.seatId) return null;
              return (
                <OpponentSeat
                  key={seat.seatId}
                  seat={seat}
                  seatIndex={seatIndex}
                  view={view}
                  spectator={spectator}
                  busy={busy}
                  replaying={replaying}
                  pendingTarget={pendingTarget}
                  activeTargetIds={activeTargetIds}
                  callout={callouts[seat.seatId] ?? null}
                  rationale={
                    thinkingSeatId === seat.seatId
                      ? undefined
                      : decisionRationales[seat.seatId]
                  }
                  turnDeadline={
                    turnDeadline?.seatId === seat.seatId ? turnDeadline : null
                  }
                  seatStatusFor={seatStatusFor}
                  onChooseTarget={chooseTarget}
                />
              );
            })}
            {absenceSlot}
          </section>

          <div className="table-felt">
            <div className="felt-rim" aria-hidden="true" />
            <div className="table-watermark" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path
                  d="M4 18 L6 9 L10 13 L12 5 L14 13 L18 9 L20 18 Z"
                  fill="currentColor"
                />
                <rect x="4" y="19" width="16" height="2" rx="1" fill="currentColor" />
              </svg>
            </div>

            <div className="table-top">
              {turnDeadline ? (
                <TurnTimerRing
                  deadline={turnDeadline}
                  mySeatId={view.seatId}
                  busy={busy}
                />
              ) : null}
              <div className={`stage-card${myTurnNow && !stageBeat ? " my-turn" : ""}`}>
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
                    桌面回放中…
                  </p>
                ) : null}
              </div>
            </div>

            <div className="table-center">
              <div className="court-deck" aria-label="宫廷牌库">
                <span className="deck-card back-3">
                  <CardBack />
                </span>
                <span className="deck-card back-2">
                  <CardBack />
                </span>
                <span className="deck-card back-1">
                  <CardBack />
                </span>
                <span className="deck-count">宫廷牌库</span>
              </div>
              {finished && winnerId ? (
                <div className={`win-banner${iWon ? " mine" : ""}`} role="status">
                  <span className="win-crown" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path
                        d="M3 17 L5 8 L9.5 12 L12 4.5 L14.5 12 L19 8 L21 17 Z"
                        fill="currentColor"
                      />
                      <rect x="3" y="18.5" width="18" height="2.4" rx="1.2" fill="currentColor" />
                    </svg>
                  </span>
                  <strong>
                    <TextPartsView
                      parts={[
                        {
                          type: "seat",
                          seatId: winnerId,
                          text: seatName(view.publicState.seats, winnerId),
                        },
                        { type: "text", text: iWon ? " 加冕" : " 获胜" },
                      ]}
                      seats={view.publicState.seats}
                    />
                  </strong>
                </div>
              ) : null}
            </div>

            <div className="table-actions">
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
                          className={`exchange-card-button${selected ? " picked" : ""}`}
                          disabled={busy || replaying}
                          aria-label={`保留 ${CHARACTER_LABEL[card.character]}${selected ? "（已选）" : ""}`}
                          aria-pressed={selected}
                          onClick={() => {
                            sfx.play("click");
                            setExchangeKeepSelected((current) =>
                              toggleKeepSelection(
                                current,
                                card.cardId,
                                keepNeeded,
                              ),
                            );
                          }}
                        >
                          <CharacterCardFace
                            character={card.character}
                            name={CHARACTER_LABEL[card.character]}
                            ability={ROLE_HINTS[card.character]}
                          />
                          <span className={`pick-mark${selected ? " show" : ""}`}>
                            留
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="confirm-actions">
                    <button
                      type="button"
                      className="response-button"
                      disabled={busy || replaying}
                      onClick={() => {
                        sfx.play("cancel");
                        setExchangeKeepSelected([]);
                      }}
                    >
                      重选
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
                      确认保留
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
                      onClick={() => {
                        sfx.play("cancel");
                        setActionDraft(null);
                      }}
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
                    if (decision.type === "challenge_claim") label = "质疑！";
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
                        onClick={() => submitResponse(decision)}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {spectator && !finished ? (
                <div className="response-bar spectator-bar" aria-label="观战提示">
                  <span>观战中 — 牌局由对局者推进，刷新可同步最新战况。</span>
                </div>
              ) : null}
            </div>
          </div>

          {!spectator ? (
            <section className="player-zone" aria-label="手牌与行动">
              <div className="player-identity">
                <SeatAvatar
                  name={localSeat?.displayName ?? "你"}
                  tintClass={seatTintClass(
                    view.publicState.seats.findIndex(
                      (seat) => seat.seatId === view.seatId,
                    ),
                  )}
                  eliminated={Boolean(localSeat?.eliminated)}
                />
                <div className="player-identity-text">
                  <strong>{localSeat?.displayName ?? "你"}</strong>
                  <span className="player-coins">
                    <span className="coin-icon" aria-hidden="true">
                      <svg viewBox="0 0 16 16">
                        <circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
                        <circle cx="8" cy="8" r="3.4" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.7" />
                      </svg>
                    </span>
                    {localSeat?.coins ?? 0}
                  </span>
                </div>
              </div>

              <div className="hand" aria-label="你的隐藏牌">
                {view.privateState.hiddenCharacters.length === 0 ? (
                  <p className="hand-empty">影响力已耗尽</p>
                ) : (
                  view.privateState.hiddenCharacters.map((character, index) => (
                    <div
                      key={`${character}-${index}`}
                      className="role-card"
                      style={{
                        ["--role-deep" as string]: ROLE_VISUAL[character].deep,
                        ["--role-lite" as string]: ROLE_VISUAL[character].lite,
                      }}
                    >
                      <CharacterCardFace
                        character={character}
                        name={CHARACTER_LABEL[character]}
                        ability={ROLE_HINTS[character]}
                      />
                    </div>
                  ))
                )}
              </div>

              <div className="action-zone">
                <div className="action-label">
                  <span>
                    {pendingTarget
                      ? "点击桌面高亮座位选定目标"
                      : showActionConfirm
                        ? "确认后才会提交"
                        : showResponseBar || showExchange
                          ? "请先处理桌面上的响应"
                          : finished
                            ? "对局已结束"
                            : myTurnNow
                              ? "选择一个行动"
                              : "等待他人行动"}
                  </span>
                </div>
                <div className="action-bar" aria-label="合法行动">
                  <button
                    type="button"
                    className="action-button"
                    disabled={actionsLocked || !canIncome}
                    onClick={() => selectUntargeted("income")}
                  >
                    <span className="action-name">收入</span>
                    <small>+1 金币</small>
                  </button>
                  <button
                    type="button"
                    className="action-button"
                    disabled={actionsLocked || !canForeignAid}
                    onClick={() => selectUntargeted("foreign_aid")}
                  >
                    <span className="action-name">外援</span>
                    <small>+2 金币</small>
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
                    <span className="action-name">
                      {pendingTarget === "coup" ? "取消政变" : "政变"}
                    </span>
                    <small>7 金币</small>
                  </button>
                  <button
                    type="button"
                    className="action-button claim-duke"
                    disabled={actionsLocked || !canTax}
                    onClick={() => selectUntargeted("tax")}
                  >
                    <span className="action-name">征税</span>
                    <small>公爵 · +3</small>
                  </button>
                  <button
                    type="button"
                    className="action-button claim-assassin"
                    disabled={
                      actionsLocked ||
                      assassinateTargetIds.length === 0 ||
                      (pendingTarget != null && pendingTarget !== "assassinate")
                    }
                    onClick={() => selectTargeted("assassinate")}
                  >
                    <span className="action-name">
                      {pendingTarget === "assassinate" ? "取消刺杀" : "刺杀"}
                    </span>
                    <small>刺客 · 3 金币</small>
                  </button>
                  <button
                    type="button"
                    className="action-button claim-captain"
                    disabled={
                      actionsLocked ||
                      stealTargetIds.length === 0 ||
                      (pendingTarget != null && pendingTarget !== "steal")
                    }
                    onClick={() => selectTargeted("steal")}
                  >
                    <span className="action-name">
                      {pendingTarget === "steal" ? "取消偷窃" : "偷窃"}
                    </span>
                    <small>队长 · +2</small>
                  </button>
                  <button
                    type="button"
                    className="action-button claim-ambassador"
                    disabled={actionsLocked || !canExchange}
                    onClick={() => selectUntargeted("exchange")}
                  >
                    <span className="action-name">交换</span>
                    <small>大使 · 换牌</small>
                  </button>
                </div>
              </div>
            </section>
          ) : null}
        </section>

        <aside className="event-rail" aria-label="对局记录">
          <div className="rail-title">
            <span>对局记录</span>
            <span>{view.projectedHistory.length} 条</span>
          </div>
          <ol className="event-list" ref={eventListRef}>
            {view.projectedHistory.map((event, index) => (
              <li
                key={`${event.type}-${index}`}
                className={`event event-${event.type}`}
              >
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
            style={{
              ["--role-deep" as string]: ROLE_VISUAL[overlay.character].deep,
              ["--role-lite" as string]: ROLE_VISUAL[overlay.character].lite,
            }}
          >
            <CharacterCardFace
              character={overlay.character}
              name={CHARACTER_LABEL[overlay.character]}
              ability={ROLE_HINTS[overlay.character]}
            />
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

      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`desk-toast ${toast.tone}`}>
            {toast.text}
          </div>
        ))}
      </div>

      <RulesPanel open={rulesOpen} onClose={() => setRulesOpen(false)} />
    </div>
  );
}

const ROLE_HINTS: Record<CharacterId, string> = {
  duke: "征税 +3 · 阻挡外援",
  assassin: "付 3 金币刺杀",
  captain: "偷取 2 金币 · 阻挡偷窃",
  ambassador: "交换手牌 · 阻挡偷窃",
  contessa: "阻挡刺杀",
};
