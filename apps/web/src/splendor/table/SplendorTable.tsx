import { useEffect, useState } from "react";
import type { GemColor, SplendorCommand } from "@coup/splendor-domain";
import {
  submitSplendorCommand,
  type SplendorLobbySeat,
  type SplendorSeatAbsence,
  type SplendorView,
} from "../splendorApi.js";
import { errorText, eventText, GEM_ORDER, nobleName } from "../labels.js";
import { DevCardFace, DeckStack, GemChip, NobleTileFace, ScoreMedallion } from "./pieces.js";

/**
 * 璀璨宝石主桌面：桌面俯视布局——贵族区、三级牌列、宝石供应区居中；
 * 对手列于左右侧栏；当前玩家席位于底部；右侧为行动面板与对局纪事。
 */

type GemBag = Record<GemColor, number>;

const emptyBag = (): GemBag => ({ white: 0, blue: 0, green: 0, red: 0, black: 0 });

function shortfallFor(player: { cards: GemBag; gems: GemBag; gold: number }, cost: GemBag) {
  const shortfall = emptyBag();
  let goldNeeded = 0;
  for (const color of GEM_ORDER) {
    const need = Math.max(0, cost[color] - player.cards[color]);
    const gap = need - Math.min(need, player.gems[color]);
    shortfall[color] = gap;
    goldNeeded += gap;
  }
  return { shortfall, goldNeeded, affordable: goldNeeded <= player.gold };
}

function selectionError(sel: GemColor[], color: GemColor, pool: GemBag): string | null {
  const picked = sel.filter((c) => c === color).length;
  if (picked >= 2) return "同色最多拿 2 枚";
  if (picked === 1) {
    if (sel.length !== 1) return "同色只能单独拿取 2 枚";
    if (pool[color] < 4) return "拿两枚同色需供应区有 4 枚";
    return null;
  }
  if (sel.length >= 3) return "一次至多拿 3 枚";
  if (sel.length === 2 && sel[0] === sel[1]) return "已选同色两枚，无法再加";
  if (sel.length === 2 && sel.includes(color)) return "第三枚须与已选不同色";
  if (pool[color] < 1) return "该色宝石已空";
  return null;
}

function selectionValid(sel: GemColor[], pool: GemBag): boolean {
  if (sel.length === 3) return new Set(sel).size === 3 && sel.every((c) => pool[c] >= 1);
  if (sel.length === 2) return sel[0] === sel[1] && pool[sel[0]] >= 4;
  return false;
}

/**
 * 供应区宝石点选：点一下取 1 枚；再点同一色升级为同色 2 枚（需池中 ≥4）；
 * 第三次点击整个取消该色。点击其他已选色 = 取消那一枚。
 */
function nextSelection(sel: GemColor[], color: GemColor, pool: GemBag): { gems?: GemColor[]; error?: string } {
  const picked = sel.filter((c) => c === color).length;
  if (picked === 0) {
    if (sel.length >= 3) return { error: "一次至多拿 3 枚" };
    if (sel.length === 2 && sel[0] === sel[1]) return { error: "已选同色两枚，无法再加" };
    if (sel.includes(color)) return { error: "第三枚须与已选不同色" };
    if (pool[color] < 1) return { error: "该色宝石已空" };
    return { gems: [...sel, color] };
  }
  if (picked === 1) {
    if (sel.length !== 1) return { gems: sel.filter((c) => c !== color) };
    if (pool[color] < 4) return { error: "拿两枚同色需供应区有 4 枚（已取消选择）", gems: [] };
    return { gems: [color, color] };
  }
  return { gems: sel.filter((c) => c !== color) };
}

export type SplendorTableProps = {
  view: SplendorView;
  roomCode: string;
  absences: SplendorSeatAbsence[];
  turnDeadline: { seatId: string; deadlineAt: number; durationMs: number } | null;
  autoDecision: { seatId: string; at: number; kind: string } | null;
  onError: (message: string) => void;
  onSubmitted?: () => void;
  rematchPhase: string;
  rematchSeats: SplendorLobbySeat[];
  mySeatId: string | null;
  onRematch: () => void;
  onConfirmRematch: () => void;
  onSpectate: () => void;
};

export function SplendorTable(props: SplendorTableProps) {
  const { view, roomCode, absences, turnDeadline, autoDecision, onError, onSubmitted } = props;
  const state = view.state;
  const isSpectator = view.spectator;
  const myPlayer = isSpectator || view.seatId === "spectator" ? null : Number(view.seatId) - 1;
  const mySeatId = isSpectator ? null : view.seatId;
  const myTurn = view.isYourTurn && myPlayer !== null;

  const [selection, setSelection] = useState<GemColor[]>([]);
  const [discardSel, setDiscardSel] = useState<GemBag>(emptyBag());
  const [busy, setBusy] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [resultDismissed, setResultDismissed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!turnDeadline) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [turnDeadline]);

  const decidingName = (seatId: string | null) =>
    seatId == null ? null : seatId === mySeatId ? "你" : view.displayNames[seatId] ?? `${seatId} 号`;

  const me = myPlayer != null ? state.players[myPlayer] : null;
  const myReservedCount = myPlayer != null ? (view.reservedCounts[myPlayer] ?? 0) : 0;
  const opponents = state.players
    .map((p) => p.index)
    .filter((index) => index !== myPlayer);

  const logTail = state.log.slice(-7).reverse();

  async function submit(command: SplendorCommand) {
    if (busy) return;
    setBusy(true);
    try {
      await submitSplendorCommand(roomCode, command, `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
      setSelection([]);
      setDiscardSel(emptyBag());
      onSubmitted?.();
    } catch (e) {
      onError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const needDiscard = me
    ? Math.max(0, me.gold + GEM_ORDER.reduce((sum, c) => sum + me.gems[c], 0) - 10)
    : 0;
  const discardPicked = GEM_ORDER.reduce((sum, c) => sum + discardSel[c], 0);

  const turnSeconds = turnDeadline ? Math.max(0, Math.ceil((turnDeadline.deadlineAt - now) / 1000)) : null;

  // --------------------------------------------------------------
  // 渲染
  // --------------------------------------------------------------

  const topbar = (
    <header className="spl-topbar">
      <a className="spl-topbar-back" href="/">← 大厅</a>
      <div className={`spl-turn-banner${myTurn ? " is-my-turn" : ""}`}>
        {state.status === "finished" ? (
          <span>对局已结束</span>
        ) : isSpectator ? (
          <span>观战中 · 当前 {decidingName(view.decidingSeatId) ?? "—"} 行动</span>
        ) : myTurn ? (
          <span>轮到你了{state.phase === "await_discard" ? " · 归还超额宝石" : state.phase === "await_noble" ? " · 贵族造访" : ""}</span>
        ) : (
          <span>等待 {decidingName(view.decidingSeatId) ?? "—"} 行动</span>
        )}
        {turnSeconds != null && turnDeadline && view.decidingSeatId === turnDeadline.seatId && state.status !== "finished" ? (
          <b className={`spl-timer${turnSeconds <= 10 ? " is-low" : ""}`}>{turnSeconds}s</b>
        ) : null}
      </div>
      <div className="spl-topbar-right">
        {autoDecision ? <span className="spl-auto-note">· {decidingName(autoDecision.seatId)} 超时自动行动</span> : null}
        <span className="spl-room-chip">房间 {roomCode}</span>
        <button type="button" className="spl-btn spl-btn--ghost spl-btn--sm" onClick={() => setHelpOpen(true)}>
          规则
        </button>
      </div>
    </header>
  );

  const noblesRow = (
    <section className="spl-nobles-row" aria-label="贵族">
      <div className="spl-section-title">贵族造访</div>
      <div className="spl-nobles">
        {state.nobles.length === 0 ? (
          <span className="spl-hint">贵族已全部受邀离席</span>
        ) : (
          state.nobles.map((noble) => <NobleTileFace key={noble.id} noble={noble} />)
        )}
      </div>
    </section>
  );

  const levelRow = (level: 1 | 2 | 3) => (
    <section className="spl-level-row" data-level={level} key={level}>
      <div className="spl-level-deck">
        <DeckStack level={level} count={state.deckCounts[level]} />
        {myTurn && state.phase === "action" ? (
          <button
            type="button"
            className="spl-mini-btn"
            disabled={busy || myReservedCount >= 3}
            title={myReservedCount >= 3 ? "预留已满" : `盲留 ${level} 级牌库顶`}
            onClick={() => void submit({ type: "reserve_deck", player: myPlayer!, expectedVersion: state.stateVersion, level })}
          >
            盲留
          </button>
        ) : null}
      </div>
      <div className="spl-level-cards">
        {state.table[level].map((card, slot) => {
          if (!card) {
            return (
              <div className="spl-cardwrap is-empty" key={`empty-${level}-${slot}`}>
                <div className="spl-card-empty">{level === 3 ? "已取尽" : ""}</div>
              </div>
            );
          }
          const pay = me ? shortfallFor(me, card.cost) : null;
          const canBuy = Boolean(myTurn && state.phase === "action" && pay?.affordable);
          const canReserve = Boolean(myTurn && state.phase === "action" && myReservedCount < 3);
          return (
            <div className="spl-cardwrap" key={card.id}>
              <DevCardFace card={card} shortfall={pay?.affordable ? null : pay?.shortfall} />
              {myTurn && state.phase === "action" && !isSpectator ? (
                <div className="spl-card-actions">
                  {canBuy ? (
                    <button
                      type="button"
                      className="spl-mini-btn spl-mini-btn--buy"
                      disabled={busy}
                      onClick={() =>
                        void submit({ type: "purchase_table", player: myPlayer!, expectedVersion: state.stateVersion, level, slot })
                      }
                    >
                      购买{pay && pay.goldNeeded > 0 ? ` ·黄金${pay.goldNeeded}` : ""}
                    </button>
                  ) : (
                    <span className="spl-card-note">{pay && !pay.affordable ? "宝石不足" : null}</span>
                  )}
                  {canReserve ? (
                    <button
                      type="button"
                      className="spl-mini-btn"
                      disabled={busy}
                      onClick={() =>
                        void submit({ type: "reserve_table", player: myPlayer!, expectedVersion: state.stateVersion, level, slot })
                      }
                    >
                      预留
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );

  const poolSection = (
    <section className="spl-pool" aria-label="宝石供应区">
      <div className="spl-section-title">宝石供应</div>
      <div className="spl-pool-chips">
        {GEM_ORDER.map((color) => (
          <div className="spl-pool-slot" key={color}>
            <GemChip
              color={color}
              size="lg"
              count={Math.max(1, state.pool[color])}
              dimmed={state.pool[color] === 0}
              selected={selection.includes(color)}
              onClick={
                myTurn && state.phase === "action"
                  ? () => {
                      const next = nextSelection(selection, color, state.pool);
                      if (next.error) onError(next.error);
                      setSelection(next.gems ?? selection);
                    }
                  : undefined
              }
            />
            <span className="spl-pool-count">{state.pool[color]}</span>
          </div>
        ))}
        <div className="spl-pool-slot spl-pool-slot--gold">
          <GemChip color="gold" size="lg" count={Math.max(1, state.gold)} dimmed={state.gold === 0} />
          <span className="spl-pool-count">{state.gold}</span>
        </div>
      </div>
    </section>
  );

  const opponentPanel = (index: number) => {
    const player = state.players[index]!;
    const seatId = String(index + 1);
    const absence = absences.find((a) => a.seatId === seatId);
    const isDeciding = view.decidingSeatId === seatId && state.status !== "finished";
    return (
      <article key={index} className={`spl-opp${isDeciding ? " is-deciding" : ""}`}>
        <div className="spl-opp-head">
          <span className="spl-opp-seat">{seatId} 号</span>
          <span className="spl-opp-name">{view.displayNames[seatId] ?? "客人"}</span>
          <ScoreMedallion points={player.points} />
        </div>
        <div className="spl-opp-gems">
          {GEM_ORDER.map((color) => (
            <span key={color} className="spl-opp-gem">
              <GemChip color={color} size="xs" />
              <b>{player.gems[color]}</b>
            </span>
          ))}
          <span className="spl-opp-gem">
            <GemChip color="gold" size="xs" />
            <b>{player.gold}</b>
          </span>
        </div>
        <div className="spl-opp-meta">
          <span title="永久宝石加成（已购卡）">
            {GEM_ORDER.filter((c) => player.cards[c] > 0).map((c) => (
              <i key={c} className={`spl-bonus-dot spl-bonus-dot--${c}`}>{player.cards[c]}</i>
            ))}
            {GEM_ORDER.every((c) => player.cards[c] === 0) ? <em className="spl-dim">尚无加成</em> : null}
          </span>
          <span className="spl-opp-figures">
            卡 <b>{player.purchasedCount}</b> · 预留 <b>{view.reservedCounts[index] ?? 0}</b> · 贵族{" "}
            <b>{player.nobles.length}</b>
          </span>
        </div>
        {absence && absence.phase !== "present" ? (
          <span className={`spl-absence-flag is-${absence.phase}`}>
            {absence.phase === "reconnecting" ? "重连中" : absence.phase === "timed_out" ? "久未响应" : "离席"}
          </span>
        ) : null}
      </article>
    );
  };

  const actionPanel = (
    <section className="spl-actions" aria-label="行动面板">
      <div className="spl-actions-title">行 动</div>
      {!myTurn && state.status === "in_progress" ? (
        <p className="spl-hint">
          {decidingName(view.decidingSeatId) ?? "—"} 正在斟酌……
          <br />
          你可借机检视牌面与对手牌库。
        </p>
      ) : null}

      {myTurn && state.phase === "action" ? (
        <>
          <p className="spl-hint">
            点选供应区宝石（三散或同色两枚），或悬停卡牌进行 购买 / 预留。
          </p>
          <div className="spl-selection">
            {selection.length === 0 ? (
              <span className="spl-dim">尚未选宝石</span>
            ) : (
              selection.map((color, i) => <GemChip key={`${color}-${i}`} color={color} size="sm" />)
            )}
          </div>
          <div className="spl-actions-row">
            <button
              type="button"
              className="spl-btn spl-btn--primary"
              disabled={busy || !selectionValid(selection, state.pool)}
              onClick={() =>
                void submit({ type: "take_gems", player: myPlayer!, expectedVersion: state.stateVersion, gems: selection })
              }
            >
              拿取宝石
            </button>
            <button
              type="button"
              className="spl-btn spl-btn--ghost"
              disabled={busy || selection.length === 0}
              onClick={() => setSelection([])}
            >
              清空
            </button>
          </div>
        </>
      ) : null}

      {myTurn && state.phase === "await_discard" ? (
        <>
          <p className="spl-hint">
            筹码超过 10 枚：请归还 <b>{needDiscard}</b> 枚（已选 <b className={discardPicked === needDiscard ? "is-ok" : "is-bad"}>{discardPicked}</b>）。
          </p>
          <div className="spl-discard">
            {GEM_ORDER.map((color) => (
              <div key={color} className="spl-discard-row">
                <GemChip color={color} size="sm" />
                <span className="spl-discard-own">{me?.gems[color] ?? 0}</span>
                <button
                  type="button"
                  className="spl-stepper"
                  disabled={busy || discardSel[color] <= 0}
                  onClick={() => setDiscardSel({ ...discardSel, [color]: discardSel[color] - 1 })}
                >
                  −
                </button>
                <b>{discardSel[color]}</b>
                <button
                  type="button"
                  className="spl-stepper"
                  disabled={busy || discardSel[color] >= (me?.gems[color] ?? 0) || discardPicked >= needDiscard}
                  onClick={() => setDiscardSel({ ...discardSel, [color]: discardSel[color] + 1 })}
                >
                  +
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="spl-btn spl-btn--primary"
            disabled={busy || discardPicked !== needDiscard}
            onClick={() => void submit({ type: "discard_gems", player: myPlayer!, expectedVersion: state.stateVersion, gems: discardSel })}
          >
            确认归还
          </button>
        </>
      ) : null}

      {myTurn && state.phase === "await_noble" && state.nobleChoice?.player === myPlayer ? (
        <>
          <p className="spl-hint">多位贵族愿意见你——选择一位造访：</p>
          <div className="spl-noble-choice">
            {state.nobles
              .filter((n) => state.nobleChoice?.candidates.includes(n.id))
              .map((noble) => (
                <button
                  key={noble.id}
                  type="button"
                  className="spl-noble-pick"
                  disabled={busy}
                  onClick={() => void submit({ type: "choose_noble", player: myPlayer!, expectedVersion: state.stateVersion, nobleId: noble.id })}
                >
                  <NobleTileFace noble={noble} size="sm" />
                  <span>邀请 {nobleName(noble.name)}</span>
                </button>
              ))}
          </div>
        </>
      ) : null}
    </section>
  );

  const logPanel = (
    <section className="spl-log" aria-label="对局纪事">
      <div className="spl-actions-title">对局纪事</div>
      <ol className="spl-log-list">
        {logTail.map((event, i) => (
          <li key={event.seq} className={`spl-log-item${i === 0 ? " is-new" : ""}${event.kind === "noble_visits" ? " is-noble" : ""}${event.kind === "final_round" ? " is-final" : ""}`}>
            {eventText(event, view.displayNames, mySeatId)}
          </li>
        ))}
      </ol>
    </section>
  );

  const selfMat = me ? (
    <footer className="spl-self">
      <div className="spl-self-identity">
        <span className="spl-self-seat">{view.seatId} 号 · {view.displayName ?? "你"}</span>
        <ScoreMedallion points={me.points} pulseKey={`${state.stateVersion}`} />
        <span className="spl-self-nobles">
          {me.nobles.length > 0 ? `${me.nobles.length} 位贵族造访` : "尚无贵族造访"}
        </span>
      </div>
      <div className="spl-self-gems">
        {GEM_ORDER.map((color) => (
          <span key={color} className="spl-self-gem">
            <GemChip color={color} size="sm" />
            <b>{me.gems[color]}</b>
          </span>
        ))}
        <span className="spl-self-gem">
          <GemChip color="gold" size="sm" />
          <b>{me.gold}</b>
        </span>
      </div>
      <div className="spl-self-cards" title="已购发展卡（按加成色分组，层叠为永久加成）">
        {GEM_ORDER.filter((c) => me.cards[c] > 0).map((color) => (
          <span key={color} className={`spl-stack spl-stack--${color}`}>
            <i />
            <b>{me.cards[color]}</b>
          </span>
        ))}
        {GEM_ORDER.every((c) => me.cards[c] === 0) ? <span className="spl-dim">尚未购得发展卡</span> : null}
      </div>
      <div className="spl-self-reserved">
        <span className="spl-dim">预留 {view.yourReserved?.length ?? 0}/3</span>
        {(view.yourReserved ?? []).map((card) => {
          const pay = shortfallFor(me, card.cost);
          return (
            <div className="spl-minicard-wrap" key={card.id}>
              <DevCardFace card={card} size="sm" shortfall={pay.affordable ? null : pay.shortfall} />
              {myTurn && state.phase === "action" ? (
                <div className="spl-card-actions">
                  {pay.affordable ? (
                    <button
                      type="button"
                      className="spl-mini-btn spl-mini-btn--buy"
                      disabled={busy}
                      onClick={() => void submit({ type: "purchase_reserved", player: myPlayer!, expectedVersion: state.stateVersion, cardId: card.id })}
                    >
                      购买{pay.goldNeeded > 0 ? ` ·黄金${pay.goldNeeded}` : ""}
                    </button>
                  ) : (
                    <span className="spl-card-note">宝石不足</span>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </footer>
  ) : (
    <footer className="spl-self spl-self--spectator">
      <span>观战模式——仅可见公开信息，预留牌对所有人保密。</span>
    </footer>
  );

  const finished = state.status === "finished";
  const winnerSeats = state.winners.map((p) => String(p + 1));
  const finishEvent = state.log.find((e) => e.kind === "match_finished");
  const standings = finishEvent && finishEvent.kind === "match_finished" ? finishEvent.standings : [];

  return (
    <div className="spl-table">
      {topbar}
      <main className="spl-stage">
        <aside className="spl-rail spl-rail--left">{opponents.filter((_, i) => i % 2 === 0).map(opponentPanel)}</aside>
        <section className="spl-center">
          {noblesRow}
          {levelRow(3)}
          {levelRow(2)}
          {levelRow(1)}
          {poolSection}
        </section>
        <aside className="spl-rail spl-rail--right">
          {opponents.filter((_, i) => i % 2 === 1).map(opponentPanel)}
          {actionPanel}
          {logPanel}
        </aside>
      </main>
      {selfMat}

      {finished && !resultDismissed ? (
        <div className="spl-overlay" role="dialog">
          <div className="spl-gameover">
            <svg className="spl-laurel" viewBox="0 0 120 70" aria-hidden="true">
              <g fill="none" stroke="#d5b06a" strokeWidth="2">
                <path d="M30 62 C10 50 6 28 14 12" />
                <path d="M90 62 C110 50 114 28 106 12" />
              </g>
              {[...Array(6)].map((_, i) => (
                <ellipse key={`l${i}`} cx={16 + i * 3} cy={16 + i * 8} rx="7" ry="3.2" fill="#8a9a5b" opacity="0.8" transform={`rotate(${-40 + i * 8} ${16 + i * 3} ${16 + i * 8})`} />
              ))}
              {[...Array(6)].map((_, i) => (
                <ellipse key={`r${i}`} cx={104 - i * 3} cy={16 + i * 8} rx="7" ry="3.2" fill="#8a9a5b" opacity="0.8" transform={`rotate(${40 - i * 8} ${104 - i * 3} ${16 + i * 8})`} />
              ))}
            </svg>
            <h2>
              {winnerSeats.map((seat) => (seat === mySeatId ? "你" : view.displayNames[seat] ?? `${seat} 号`)).join("、")}
              {winnerSeats.length > 1 ? " 共享荣耀" : " 折桂"}
            </h2>
            <table className="spl-standings">
              <thead>
                <tr>
                  <th>名次</th>
                  <th>玩家</th>
                  <th>积分</th>
                  <th>发展卡</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((row, i) => {
                  const seatId = String(row.player + 1);
                  return (
                    <tr key={row.player} className={winnerSeats.includes(seatId) ? "is-winner" : ""}>
                      <td>{i + 1}</td>
                      <td>{seatId === mySeatId ? "你" : view.displayNames[seatId] ?? `${seatId} 号`}</td>
                      <td><b>{row.points}</b></td>
                      <td>{row.cards}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="spl-actions-row">
              {props.rematchPhase === "rematch" && props.rematchSeats.some((s) => s.seatId === mySeatId && s.rematchStatus === "awaiting") ? (
                <button type="button" className="spl-btn spl-btn--primary" onClick={props.onConfirmRematch}>
                  确认再来一局
                </button>
              ) : null}
              {mySeatId === "1" && props.rematchPhase !== "rematch" ? (
                <button type="button" className="spl-btn spl-btn--primary" onClick={props.onRematch}>
                  发起续局
                </button>
              ) : null}
              <button type="button" className="spl-btn spl-btn--ghost" onClick={props.onSpectate}>
                保持观战
              </button>
              <button type="button" className="spl-btn spl-btn--ghost" onClick={() => setResultDismissed(true)}>
                收起看牌面
              </button>
              <a className="spl-btn spl-btn--ghost" href="/">
                返回大厅
              </a>
            </div>
          </div>
        </div>
      ) : null}

      {helpOpen ? (
        <div className="spl-overlay" role="dialog" onClick={(e) => { if (e.target === e.currentTarget) setHelpOpen(false); }}>
          <div className="spl-modal">
            <h3>璀璨宝石 · 规则要义</h3>
            <div className="spl-modal-body">
              <p><b>目标</b>：率先达到 <b>15 点声望</b>。有人达标后，本轮打完（人人回合数相同）即结算；平局时已购卡少者胜。</p>
              <p><b>你的回合</b>须恰好执行其一：</p>
              <ul>
                <li><b>拿取宝石</b>：三枚不同色，或同色两枚（仅当供应区该色 ≥ 4 枚）。</li>
                <li><b>预留一张卡</b>：从明牌或牌库顶（盲留）取走，并获得 1 枚黄金（若还有）。手上至多预留 3 张。</li>
                <li><b>购买一张卡</b>：明牌或自己的预留牌。支付 = 费用 − 永久加成，差额用黄金抵充。</li>
              </ul>
              <p><b>筹码上限</b>：回合结束时你手中的宝石与黄金合计不可超过 10 枚，超出须立即归还。</p>
              <p><b>贵族</b>：回合结束时，若你的<b>永久加成</b>（不是宝石）满足某贵族的要求，该贵族自动造访，+3 分；多位贵族同时中意时由你挑选一位。</p>
              <p><b>加成</b>：每张已购发展卡提供 1 枚对应色的永久加成，购买同色卡时直接抵扣。</p>
            </div>
            <button type="button" className="spl-btn spl-btn--primary" onClick={() => setHelpOpen(false)}>
              明白了
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
