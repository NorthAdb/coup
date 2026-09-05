import { useState, type ReactElement, type ReactNode } from "react";
import { sfx } from "@coup/web-desk";

/**
 * 平台级「游戏首页 / 房间等待室」骨架（brass / splendor 共用）。
 *
 * 结构统一：品牌头 → 邀请卡（大号房号 + 复制）→ 座位列表 → 设置与开局；
 * 个性保留：通过 `game` 属性映射的主题色与背景（见 styles.css 的 .proom[data-game]）。
 * coup 的首页/大厅是更早的定制实现（视觉基准），catan 的首页带专属玩法引导，
 * 两者保持原样；本组件覆盖两块最"表单化"的屏幕。
 */

export type RoomUiSeat = {
  seatId: string;
  kind: "local_human" | "remote_human" | "bot" | "open" | "closed";
  displayName?: string | null;
  rematchStatus?: "awaiting" | "confirmed" | "left" | null;
};

const KIND_LABEL: Record<RoomUiSeat["kind"], string> = {
  local_human: "房主",
  remote_human: "已入座",
  bot: "AI 队友",
  open: "空位 · 可加入",
  closed: "已关闭",
};

function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(
      () => true,
      () => false,
    );
  }
  return Promise.resolve(false);
}

/** 复制按钮：Affordance → Feedback（✓ 已复制）→ 自动复位。 */
function CopyChip({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button
      type="button"
      className="proom-chip"
      onClick={() => {
        void copyText(text).then((ok) => {
          setState(ok ? "copied" : "failed");
          sfx.play(ok ? "confirm" : "error");
          window.setTimeout(() => setState("idle"), 2200);
        });
      }}
    >
      {state === "copied" ? "✓ 已复制" : state === "failed" ? "复制失败" : label}
    </button>
  );
}

export function GameHomeScreen(props: {
  game: "brass" | "splendor";
  backHref: string;
  backLabel?: string;
  title: string;
  subtitle: string;
  createCta: string;
  onCreate: () => void;
  busy: boolean;
  joinCode: string;
  onJoinCodeChange: (code: string) => void;
  onJoin: () => void;
  displayName: string;
  onDisplayNameChange: (name: string) => void;
  recoveryItems?: Array<{ code: string; reason: string | null }>;
  onAbandonRecovery?: (code: string) => void;
  footerNote?: string;
}): ReactElement {
  const {
    game,
    backHref,
    backLabel = "← 返回大厅",
    title,
    subtitle,
    createCta,
    onCreate,
    busy,
    joinCode,
    onJoinCodeChange,
    onJoin,
    displayName,
    onDisplayNameChange,
    recoveryItems = [],
    onAbandonRecovery,
    footerNote,
  } = props;
  return (
    <div className="proom" data-game={game}>
      <header className="proom-top">
        <a className="proom-back" href={backHref}>
          {backLabel}
        </a>
        <span className="proom-top-title">{title}</span>
        <span className="proom-top-spacer" aria-hidden="true" />
      </header>
      <main className="proom-body proom-body--home">
        <section className="proom-panel proom-hero">
          <h2 className="proom-title">{title}</h2>
          <p className="proom-lede">{subtitle}</p>
        </section>
        <section className="proom-panel">
          <h3 className="proom-panel-title">创建房间</h3>
          <button
            type="button"
            className="proom-btn proom-btn--primary"
            disabled={busy}
            onClick={onCreate}
          >
            {createCta}
          </button>
        </section>
        <section className="proom-panel">
          <h3 className="proom-panel-title">加入房间</h3>
          <div className="proom-joinrow">
            <input
              className="proom-code"
              inputMode="numeric"
              maxLength={4}
              placeholder="房号"
              aria-label="4 位房间号"
              value={joinCode}
              onChange={(e) => onJoinCodeChange(e.target.value.replace(/\D/g, "").slice(0, 4))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && joinCode.length === 4) onJoin();
              }}
            />
            <button
              type="button"
              className="proom-btn proom-btn--primary"
              disabled={busy || joinCode.length !== 4}
              onClick={onJoin}
            >
              加入
            </button>
          </div>
          <label className="proom-nameline">
            昵称
            <input
              className="proom-name"
              value={displayName}
              maxLength={12}
              placeholder="起一个桌上的名字"
              onChange={(e) => onDisplayNameChange(e.target.value)}
            />
          </label>
        </section>
        {recoveryItems.length > 0 ? (
          <section className="proom-panel">
            <h3 className="proom-panel-title">中断的对局</h3>
            {recoveryItems.map((item) => (
              <div key={item.code} className="proom-recovery">
                <span>
                  房间 {item.code}（{item.reason === "match_missing" ? "缺少对局" : "恢复失败"}）
                </span>
                <button
                  type="button"
                  className="proom-chip"
                  onClick={() => onAbandonRecovery?.(item.code)}
                >
                  放弃
                </button>
              </div>
            ))}
          </section>
        ) : null}
        {footerNote ? <p className="proom-footnote">{footerNote}</p> : null}
      </main>
    </div>
  );
}

export function GameRoomScreen(props: {
  game: "brass" | "splendor";
  homeHref: string;
  title: string;
  code: string;
  seats: RoomUiSeat[];
  phase: string;
  isHost: boolean;
  mySeatId: string | null;
  busy: boolean;
  displayName: string;
  onDisplayNameChange: (name: string) => void;
  onRename: () => void;
  onClaim: (seatId: string) => void;
  onConfigure: (seatId: string, kind: "open" | "closed" | "bot") => void;
  onLeaveSeat: () => void;
  onStart: () => void;
  startLabel: string;
  turnTimeLimitSec: number;
  onTurnTimeLimitChange: (sec: number) => void;
  timeChoices?: number[];
  hostHint?: string;
  spectateAvailable?: boolean;
  onSpectate?: () => void;
  waitingNote?: string;
}): ReactElement {
  const {
    game,
    homeHref,
    title,
    code,
    seats,
    phase,
    isHost,
    mySeatId,
    busy,
    displayName,
    onDisplayNameChange,
    onRename,
    onClaim,
    onConfigure,
    onLeaveSeat,
    onStart,
    startLabel,
    turnTimeLimitSec,
    onTurnTimeLimitChange,
    timeChoices = [0, 30, 60, 90, 120],
    hostHint,
    spectateAvailable = true,
    onSpectate,
    waitingNote,
  } = props;
  const joinUrl = `${window.location.origin}${homeHref}/join?code=${code}`;
  const occupiedCount = seats.filter(
    (s) => s.kind === "local_human" || s.kind === "remote_human" || s.kind === "bot",
  ).length;
  const openCount = seats.filter((s) => s.kind === "open").length;
  const openSeats = seats.filter((s) => s.kind === "open");

  return (
    <div className="proom" data-game={game}>
      <header className="proom-top">
        <a className="proom-back" href={homeHref}>
          ← 大厅
        </a>
        <span className="proom-top-title">{title} · 等待室</span>
        <span className="proom-roomchip">房间 {code}</span>
      </header>
      <main className="proom-body">
        <div className="proom-grid">
          <div className="proom-col">
            <section className="proom-panel proom-invite">
              <h3 className="proom-panel-title">邀友入席</h3>
              <div className="proom-codebig" aria-label={`房间号 ${code}`}>
                {code.split("").map((digit, i) => (
                  <span key={i}>{digit}</span>
                ))}
              </div>
              <p className="proom-hint">
                好友访问 <code>{joinUrl}</code> 或在本页输入房间号加入。
              </p>
              <div className="proom-chiprow">
                <CopyChip text={code} label="复制房间号" />
                <CopyChip text={joinUrl} label="复制邀请链接" />
              </div>
            </section>

            {isHost ? (
              <section className="proom-panel">
                <h3 className="proom-panel-title">回合计时</h3>
                <div className="proom-chiprow">
                  {timeChoices.map((sec) => (
                    <button
                      key={sec}
                      type="button"
                      className={`proom-chip${turnTimeLimitSec === sec ? " is-active" : ""}`}
                      disabled={busy}
                      onClick={() => onTurnTimeLimitChange(sec)}
                    >
                      {sec === 0 ? "不限时" : `${sec} 秒`}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="proom-btn proom-btn--primary proom-start"
                  disabled={busy || occupiedCount < 2}
                  title={
                    openCount > 0
                      ? "仍有开放空位：开局时将自动关闭"
                      : occupiedCount < 2
                        ? "至少需要 2 个有效座位（人类或 AI）"
                        : "全体就绪"
                  }
                  onClick={onStart}
                >
                  {startLabel}
                </button>
                {hostHint ? <p className="proom-hint">{hostHint}</p> : null}
              </section>
            ) : (
              <section className="proom-panel">
                <h3 className="proom-panel-title">等待房主开局</h3>
                {mySeatId ? (
                  <p className="proom-hint">
                    你已就座 {mySeatId} 号。保持本页打开，掉线 15 秒内回到本页可自动回席。
                  </p>
                ) : (
                  <>
                    <div className="proom-chiprow">
                      {openSeats.map((s) => (
                        <button
                          key={s.seatId}
                          type="button"
                          className="proom-chip"
                          disabled={busy}
                          onClick={() => onClaim(s.seatId)}
                        >
                          就座 {s.seatId} 号
                        </button>
                      ))}
                      {spectateAvailable && onSpectate ? (
                        <button
                          type="button"
                          className="proom-chip"
                          onClick={onSpectate}
                        >
                          观战
                        </button>
                      ) : null}
                    </div>
                    {waitingNote ? <p className="proom-hint">{waitingNote}</p> : null}
                  </>
                )}
              </section>
            )}
          </div>

          <section className="proom-panel proom-seats">
            <h3 className="proom-panel-title">
              座位
              <span className="proom-seat-count">
                {occupiedCount} / {seats.filter((s) => s.kind !== "closed").length} 就座
              </span>
            </h3>
            <ul className="proom-seatlist">
              {seats.map((seat) => {
                const mine = mySeatId === seat.seatId && seat.kind === "remote_human";
                const filled =
                  seat.kind === "local_human" ||
                  seat.kind === "remote_human" ||
                  seat.kind === "bot";
                return (
                  <li
                    key={seat.seatId}
                    className={[
                      "proom-seat",
                      mine ? "is-mine" : "",
                      filled ? "is-filled" : "",
                      seat.kind === "bot" ? "is-bot" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <span className="proom-seat-orb" aria-hidden="true">
                      {seat.kind === "bot" ? "AI" : filled ? (seat.displayName?.slice(0, 1) ?? seat.seatId) : "—"}
                    </span>
                    <span className="proom-seat-main">
                      <b className={filled ? "" : "is-empty"}>
                        {seat.kind === "local_human"
                          ? "房主（你）"
                          : seat.kind === "remote_human"
                            ? `${seat.displayName ?? "客人"}${mine ? "（你）" : ""}`
                            : seat.kind === "bot"
                              ? (seat.displayName ?? "AI 队友")
                              : seat.kind === "open"
                                ? "空位"
                                : "已关闭"}
                      </b>
                      {seat.kind === "local_human" ? (
                        <input
                          className="proom-seat-name"
                          value={displayName}
                          maxLength={12}
                          placeholder="起一个桌上的名字"
                          aria-label="你的名字"
                          onChange={(e) => onDisplayNameChange(e.target.value)}
                          onBlur={onRename}
                        />
                      ) : null}
                    </span>
                    <span className="proom-seat-kind">{KIND_LABEL[seat.kind]}</span>
                    {seat.rematchStatus === "confirmed" ? (
                      <span className="proom-seat-flag">已确认</span>
                    ) : null}
                    <span className="proom-seat-actions">
                      {isHost && seat.seatId !== "1" && phase === "lobby" ? (
                        seat.kind === "open" ? (
                          <>
                            <button type="button" className="proom-chip" disabled={busy} onClick={() => onConfigure(seat.seatId, "bot")}>
                              加AI
                            </button>
                            <button type="button" className="proom-chip" disabled={busy} onClick={() => onConfigure(seat.seatId, "closed")}>
                              关闭
                            </button>
                          </>
                        ) : seat.kind === "bot" ? (
                          <button type="button" className="proom-chip" disabled={busy} onClick={() => onConfigure(seat.seatId, "open")}>
                            撤下AI
                          </button>
                        ) : (
                          <button type="button" className="proom-chip" disabled={busy} onClick={() => onConfigure(seat.seatId, "open")}>
                            重新开放
                          </button>
                        )
                      ) : null}
                      {!isHost && seat.kind === "open" && !mySeatId ? (
                        <button type="button" className="proom-chip" disabled={busy} onClick={() => onClaim(seat.seatId)}>
                          入座
                        </button>
                      ) : null}
                      {mine && phase === "lobby" ? (
                        <button type="button" className="proom-chip" disabled={busy} onClick={onLeaveSeat}>
                          让出座位
                        </button>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </main>
    </div>
  );
}
