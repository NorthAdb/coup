import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import {
  BUILD_COSTS,
  DEV_NAMES,
  PLAYER_COLORS,
  RESOURCE_NAMES,
  RESOURCES,
  legalCities,
  legalRoads,
  legalSettlements,
  publicVP,
  playerVP,
  robberVictims,
  tradeRate,
  type CatanCommand,
  type CatanGame,
  type DevCardKind,
  type FloatChip,
  type PlayerState,
  type ResourceCount,
  type ResourceId,
} from "@coup/catan-domain";
import { ownedHarbors, BoardMap, type BuildMode, type ConfirmTarget } from "./BoardMap.js";
import { Dice, DevCardFace, ResourceCardFace, ResourceCostList, ResourceIcon } from "./pieces.js";
import type { CatanMatchPollBody, CatanSeatAbsence, CatanView } from "../catanApi.js";

/**
 * 卡坦岛桌面：绿呢台面上的中央地图，玩家围坐四方，
 * 底部是你的手牌、发展卡、行动面板与骰子；交易与提示走轻量浮层。
 * 状态来自服务器座位投影（ADR-0010 平台栈），每次行动经 submit 决策提交。
 */

interface CatanTableProps {
  roomCode: string;
  view: CatanView;
  /** null = 观战。 */
  mySeatId: string | null;
  absences: CatanSeatAbsence[];
  pausedSeatId: string | null;
  turnDeadline: CatanMatchPollBody["turnDeadline"];
  autoDecision: CatanMatchPollBody["autoDecision"];
  onSubmit: (command: CatanCommand) => Promise<boolean>;
  onExit: () => void;
  onRematch: () => void;
  onConfirmRematch: () => void;
  onDeclineRematch: () => void;
}

interface ToastItem {
  id: number;
  text: string;
}

interface DiceState {
  a: number;
  b: number;
  rolling: boolean;
}

export function CatanTable({
  roomCode,
  view,
  mySeatId,
  pausedSeatId,
  autoDecision,
  onSubmit,
  onExit,
  onRematch,
  onConfirmRematch,
  onDeclineRematch,
}: CatanTableProps): ReactElement {
  const game = view.state;
  const myIdx = mySeatId ? Number(mySeatId) - 1 : -1;
  const isYou = view.isYourTurn && myIdx >= 0;

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastSeq = useRef(0);
  const announce = (text: string) => {
    const id = ++toastSeq.current;
    setToasts((cur) => [...cur.slice(-2), { id, text }]);
    window.setTimeout(() => setToasts((cur) => cur.filter((t) => t.id !== id)), 3200);
  };

  const [dice, setDice] = useState<DiceState>(() => ({
    a: game.lastDice?.a ?? 3,
    b: game.lastDice?.b ?? 4,
    rolling: false,
  }));
  const [hotTiles, setHotTiles] = useState<ReadonlySet<number>>(new Set());
  const [floatChips, setFloatChips] = useState<FloatChip[]>([]);
  const [freshPiece, setFreshPiece] = useState<{ kind: "road" | "settlement" | "city"; key: number } | null>(null);
  const chipSeq = useRef(0);
  const seenEvents = useRef(0);

  const [buildTool, setBuildTool] = useState<"road" | "settlement" | "city" | null>(null);
  const [buildMenuOpen, setBuildMenuOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null);
  const [tradeOpen, setTradeOpen] = useState(false);
  const [illegalHint, setIllegalHint] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [devReveal, setDevReveal] = useState(false);
  const [devPick, setDevPick] = useState<"yearOfPlenty" | "monopoly" | null>(null);

  const me: PlayerState | null = myIdx >= 0 ? game.players[myIdx] ?? null : null;
  const current = game.players[game.turn]!;

  // 事件流动画：按事件数差值处理新增事件（追加式，只增不减）。
  useEffect(() => {
    const events = view.events;
    if (events.length < seenEvents.current) {
      seenEvents.current = 0; // 恢复/重开：重置基准
    }
    const fresh = events.slice(seenEvents.current);
    seenEvents.current = events.length;
    const later = (ms: number, fn: () => void) => window.setTimeout(fn, ms);
    for (const ev of fresh) {
      if (ev.type === "dice") {
        setDice({ a: ev.a, b: ev.b, rolling: false });
      } else if (ev.type === "produce") {
        const tileId = ev.tileId;
        setHotTiles((cur) => new Set(cur).add(tileId));
        later(2300, () => setHotTiles((cur) => { const next = new Set(cur); next.delete(tileId); return next; }));
        const id = ++chipSeq.current;
        setFloatChips((cur) => [...cur, { id, tileId, player: ev.player, resource: ev.resource, n: ev.n }]);
        later(1700, () => setFloatChips((cur) => cur.filter((c) => c.id !== id)));
      } else if (ev.type === "build") {
        setFreshPiece({ kind: ev.kind, key: ev.key });
        later(950, () => setFreshPiece(null));
      } else if (ev.type === "steal") {
        if (ev.from === myIdx) announce("强盗从你手中摸走了一张资源卡");
        else if (ev.to === myIdx) announce("你从对手手中摸走了一张资源卡");
      } else if (ev.type === "win") {
        announce(ev.player === myIdx ? "你率先凑齐 10 分，赢得对局！" : `${game.players[ev.player]?.name ?? "有人"} 率先凑齐 10 分`);
      }
    }
    // view 事件随轮询追加；以 events 数组引用变化为触发依据。
  }, [view.events, myIdx, game.players]);

  // 回到你回合时的提示。
  const prevTurn = useRef(-1);
  useEffect(() => {
    if (isYou && game.turn !== prevTurn.current && game.phase !== "over") {
      announce("轮到你了 —— 掷骰子吧");
    }
    prevTurn.current = game.turn;
  }, [isYou, game.turn, game.phase]);

  // 掷骰的滚动动画：提交 roll 后滚动，直到骰子事件到达。
  useEffect(() => {
    if (game.phase !== "roll") return;
    setDice((d) => (d.rolling ? { ...d, rolling: false, a: game.lastDice?.a ?? d.a, b: game.lastDice?.b ?? d.b } : d));
  }, [game.phase, game.lastDice]);

  const legal = useMemo(
    () => ({
      roads: new Set(myIdx >= 0 ? legalRoads(game, myIdx) : []),
      settlements: new Set(myIdx >= 0 ? legalSettlements(game, myIdx) : []),
      cities: new Set(myIdx >= 0 ? legalCities(game, myIdx) : []),
    }),
    [game, myIdx],
  );

  const pending = game.pendingTrade;
  const canRespondTrade = pending != null && pending.to === myIdx && myIdx >= 0;
  const pendingFromHuman = pending != null && pending.from === myIdx && myIdx >= 0;

  // 掷 7 / 骑士之后：已挪强盗且轮到你 → 可抢的受害者（弹层选择）。
  const robberVictimChoices =
    game.phase === "robber" && game.robberMoved && isYou ? robberVictims(game, myIdx) : [];

  const submit = async (command: CatanCommand, okHint?: string): Promise<boolean> => {
    const sent = await onSubmit(command);
    if (!sent) flashIllegal("这条行动现在不可行 —— 局面可能已变化");
    else if (okHint) announce(okHint);
    return sent;
  };

  const clearTool = () => {
    setBuildTool(null);
    setConfirmTarget(null);
  };

  const flashIllegal = (text: string) => {
    setIllegalHint(text);
    window.setTimeout(() => setIllegalHint((cur) => (cur === text ? null : cur)), 1500);
  };

  const buildMode: BuildMode = game.phase === "robber" && isYou && !game.robberMoved ? "robber" : buildTool;

  const handleVertexClick = (vertexId: number) => {
    if (!me) return;
    if (buildTool === "settlement") {
      setConfirmTarget({
        kind: "settlement",
        key: vertexId,
        title: "建造村庄",
        cost: BUILD_COSTS.settlement,
        affordable: canAfford(me.hand, BUILD_COSTS.settlement),
      });
    } else if (buildTool === "city") {
      setConfirmTarget({
        kind: "city",
        key: vertexId,
        title: "升级为城市",
        cost: BUILD_COSTS.city,
        affordable: canAfford(me.hand, BUILD_COSTS.city),
      });
    }
  };

  const handleEdgeClick = (edgeId: number) => {
    if (!me) return;
    if (buildTool === "road") {
      setConfirmTarget({
        kind: "road",
        key: edgeId,
        title: "修建道路",
        cost: BUILD_COSTS.road,
        affordable: game.freeRoads > 0 || canAfford(me.hand, BUILD_COSTS.road),
      });
    }
  };

  const handleConfirm = async (accept: boolean) => {
    const target = confirmTarget;
    setConfirmTarget(null);
    if (!target || !accept || myIdx < 0) return;
    let command: CatanCommand | null = null;
    if (target.kind === "road") command = { type: "build_road", player: myIdx, edgeId: target.key, free: game.freeRoads > 0 };
    else if (target.kind === "settlement") command = { type: "build_settlement", player: myIdx, vertexId: target.key };
    else if (target.kind === "city") command = { type: "build_city", player: myIdx, vertexId: target.key };
    if (!command) return;
    const ok = await submit(command);
    if (!ok) {
      flashIllegal("资源不足，无法建造");
      return;
    }
    if (target.kind !== "road") clearTool();
    else if (me && !canAfford(me.hand, BUILD_COSTS.road) && game.freeRoads <= 1) clearTool();
  };

  const handleTileClick = (tileId: number) => {
    if (game.phase !== "robber" || !isYou || game.robberMoved) return;
    void submit({ type: "move_robber", player: myIdx, tileId });
  };

  // 结束对局画面。
  if (game.winner != null) {
    return (
      <VictoryScreen
        game={game}
        myIdx={myIdx}
        onRematch={onRematch}
        onConfirmRematch={onConfirmRematch}
        onDeclineRematch={onDeclineRematch}
        onExit={onExit}
      />
    );
  }

  return (
    <div className="ct-game">
      <div className="ct-table">
        <header className="ct-tabletop">
          <div className="ct-plaque">
            <span className="ct-plaque-room">{roomCode}</span>
            <span className="ct-plaque-dot" aria-hidden="true" />
            <span className="ct-plaque-round">第 {game.turnNo} 轮</span>
            <span className="ct-plaque-dot" aria-hidden="true" />
            <span className="ct-plaque-whos">{isYou ? "你的回合" : `${current.name} 的回合`}</span>
          </div>
          <div className="ct-tabletools">
            <button type="button" className="ct-toolbtn" onClick={() => setLogOpen((v) => !v)}>
              纪事
            </button>
            <button type="button" className="ct-toolbtn" onClick={() => setRulesOpen(true)}>
              玩法
            </button>
            <button type="button" className="ct-toolbtn" onClick={onExit}>
              离开
            </button>
          </div>
        </header>

        <div className="ct-felt">
          {game.players[1] ? (
            <PlayerPanel game={game} id={1} seat="left" isCurrent={game.turn === 1} />
          ) : null}
          {game.players[2] ? (
            <PlayerPanel game={game} id={2} seat="top" isCurrent={game.turn === 2} />
          ) : null}
          {game.players[3] ? (
            <PlayerPanel game={game} id={3} seat="right" isCurrent={game.turn === 3} />
          ) : null}

          <div className="ct-boardwrap">
            <BoardMap
              game={game}
              myColor={me?.color ?? PLAYER_COLORS[0]!}
              buildMode={buildMode}
              legalRoads={legal.roads}
              legalSettlements={legal.settlements}
              legalCities={legal.cities}
              hotTiles={hotTiles}
              floatChips={floatChips}
              freshPiece={freshPiece}
              activeHarbors={ownedHarbors(game, myIdx)}
              confirmTarget={confirmTarget}
              onTileClick={handleTileClick}
              onEdgeClick={handleEdgeClick}
              onVertexClick={handleVertexClick}
              onConfirm={(accept) => void handleConfirm(accept)}
              onVoidClick={() => {
                if (confirmTarget) setConfirmTarget(null);
                else if (buildTool) flashIllegal("这个位置现在不能建造");
              }}
            />
            {game.phase === "robber" && isYou && !game.robberMoved ? (
              <div className="ct-robberbar">
                <span className="ct-robberbar-icon" aria-hidden="true">♞</span>
                移动强盗 —— 点击任意地块安置他
              </div>
            ) : null}
            {illegalHint ? <div className="ct-illegal">{illegalHint}</div> : null}
            {canRespondTrade && pending ? (
              <IncomingOffer
                fromName={game.players[pending.from]!.name}
                give={pending.give}
                want={pending.want}
                onAccept={() => void submit({ type: "respond_trade", player: myIdx, accept: true }, "成交 —— 各取所需")}
                onReject={() => void submit({ type: "respond_trade", player: myIdx, accept: false })}
              />
            ) : null}
          </div>

          {logOpen ? (
            <aside className="ct-log">
              <div className="ct-log-head">对局纪事</div>
              <ul>
                {game.log
                  .slice()
                  .reverse()
                  .slice(0, 14)
                  .map((e) => (
                    <li key={e.seq}>
                      {e.color ? <i className="ct-log-dot" style={{ background: e.color } as CSSProperties} /> : null}
                      {e.text}
                    </li>
                  ))}
              </ul>
            </aside>
          ) : null}

          <TradePanel
            open={tradeOpen}
            game={game}
            myIdx={myIdx}
            onClose={() => setTradeOpen(false)}
            pendingFromHuman={pendingFromHuman}
            onCancel={() => void submit({ type: "cancel_trade", player: myIdx })}
            onPropose={(to, give, want) => void submit({ type: "propose_trade", player: myIdx, to, give, want }, "提议已送出")}
            onBank={(give, want) => void submit({ type: "bank_trade", player: myIdx, give, want })}
          />
        </div>

        <footer className="ct-bench">
          <section className="ct-me">
            {me ? (
              <>
                <PlayerBadge p={me} vp={playerVP(game, myIdx).total} isCurrent={game.turn === myIdx} isYou />
                <span className="ct-me-stats">
                  <i title="道路">▰ {game.roads.filter((r) => r.owner === myIdx).length}</i>
                  <i title="村庄">⌂ {game.buildings.filter((b) => b.owner === myIdx && !b.city).length}</i>
                  <i title="城市">◮ {game.buildings.filter((b) => b.owner === myIdx && b.city).length}</i>
                </span>
              </>
            ) : (
              <PlayerBadge p={current} vp={publicVP(game, game.turn)} isCurrent={false} isYou={false} />
            )}
          </section>

          <section className="ct-hand" aria-label="你的资源手牌">
            {me && RESOURCES.filter((r) => me.hand[r] > 0).length > 0 ? (
              RESOURCES.filter((r) => me.hand[r] > 0).map((r) => (
                <div key={r} className="ct-hand-slot">
                  <ResourceCardFace res={r} count={me.hand[r]} />
                </div>
              ))
            ) : (
              <span className="ct-hand-empty">手牌空空 —— 等待产出，或做一笔交易吧</span>
            )}
          </section>

          <section className="ct-devtray" aria-label="你的发展卡">
            <div className="ct-devtray-head">
              <span>发展卡</span>
              {me ? (
                <button type="button" className="ct-devpeek" onClick={() => setDevReveal((v) => !v)}>
                  {devReveal ? "扣回" : "查看"}
                </button>
              ) : null}
            </div>
            <div className="ct-devcards">
              {!me || view.devCards.length === 0 ? (
                <div className="ct-devcards-empty">
                  <DevCardFace kind="knight" revealed={false} />
                  <span className="ct-devcount">0</span>
                </div>
              ) : (
                view.devCards.map((kind, i) => {
                  // 牌多时自动收紧叠放（收进约 160px），避免牌堆溢出盖住相邻面板。
                  const overlap = Math.max(0, (74 * view.devCards.length - 160) / Math.max(1, view.devCards.length - 1));
                  return (
                  <button
                    key={`${kind}-${i}`}
                    type="button"
                    className={`ct-devcard${devReveal ? " is-revealed" : ""}`}
                    style={i > 0 ? { marginLeft: -overlap } : undefined}
                    title={
                      devReveal
                        ? kind === "vp"
                          ? `${DEV_NAMES[kind]}（自动计分，无需打出）`
                          : `打出「${DEV_NAMES[kind]}」`
                        : "先「查看」，再点击打出"
                    }
                    onClick={() => {
                      if (!devReveal) {
                        setDevReveal(true);
                        return;
                      }
                      if (kind === "vp") return;
                      if (kind === "knight" || kind === "roadBuilding") {
                        void submit({ type: "play_dev", player: myIdx, card: kind });
                        setDevReveal(false);
                      } else {
                        setDevPick(kind);
                      }
                    }}
                  >
                    <DevCardFace kind={kind} revealed={devReveal} />
                  </button>
                  );
                })
              )}
              {me && me.playedDev.filter((k) => k === "knight").length > 0 ? (
                <span className="ct-devknights">骑士 ×{me.playedDev.filter((k) => k === "knight").length}</span>
              ) : null}
            </div>
          </section>

          <section className="ct-actions" aria-label="行动面板">
            {isYou && game.phase === "robber" ? (
              game.robberMoved ? (
                <div className="ct-actionrow ct-waitrow">
                  <span className="ct-waiting">
                    <i className="ct-waitdot" aria-hidden="true" />
                    选择一位受害者摸牌，或放过这一程
                  </span>
                  <button type="button" className="ct-actbtn" onClick={() => void submit({ type: "end_robber_move", player: myIdx })}>
                    放过
                  </button>
                </div>
              ) : (
                <div className="ct-actionrow ct-waitrow">
                  <span className="ct-waiting">
                    <i className="ct-waitdot" aria-hidden="true" />
                    强盗出没 —— 在地图上为他选择新驻地
                  </span>
                </div>
              )
            ) : isYou && game.phase === "roll" ? (
                <div className="ct-actionrow">
                  <button
                    type="button"
                    className="ct-actbtn ct-actbtn--primary"
                    onClick={() => {
                      setDice((d) => ({ ...d, rolling: true }));
                      void submit({ type: "roll", player: myIdx });
                    }}
                  >
                    掷骰子
                  </button>
                  <button type="button" className="ct-actbtn" onClick={() => setTradeOpen(true)}>
                    交易
                  </button>
                </div>
              ) : isYou && myIdx >= 0 ? (
                <div className="ct-actionrow">
                  <div className="ct-buildmenu">
                    <button
                      type="button"
                      className={`ct-actbtn${buildTool ? " is-active" : ""}`}
                      onClick={() => setBuildMenuOpen((v) => !v)}
                    >
                      建造{buildTool ? "中" : ""} <i className="ct-caret" aria-hidden="true" />
                    </button>
                    {buildMenuOpen ? (
                      <div className="ct-buildlist">
                        <button
                          type="button"
                          className={`ct-builditem${buildTool === "road" ? " is-active" : ""}`}
                          onClick={() => {
                            setBuildTool(buildTool === "road" ? null : "road");
                            setBuildMenuOpen(false);
                          }}
                        >
                          <b>道路</b>
                          <ResourceCostList cost={BUILD_COSTS.road} />
                          <span className={`ct-afford${game.freeRoads > 0 || canAfford(me!.hand, BUILD_COSTS.road) ? "" : " is-poor"}`}>
                            {game.freeRoads > 0 ? "免费" : canAfford(me!.hand, BUILD_COSTS.road) ? "可建" : "资源不足"}
                          </span>
                        </button>
                        <button
                          type="button"
                          className={`ct-builditem${buildTool === "settlement" ? " is-active" : ""}`}
                          onClick={() => {
                            setBuildTool(buildTool === "settlement" ? null : "settlement");
                            setBuildMenuOpen(false);
                          }}
                        >
                          <b>村庄</b>
                          <ResourceCostList cost={BUILD_COSTS.settlement} />
                          <span className={`ct-afford${canAfford(me!.hand, BUILD_COSTS.settlement) ? "" : " is-poor"}`}>
                            {canAfford(me!.hand, BUILD_COSTS.settlement) ? "可建" : "资源不足"}
                          </span>
                        </button>
                        <button
                          type="button"
                          className={`ct-builditem${buildTool === "city" ? " is-active" : ""}`}
                          onClick={() => {
                            setBuildTool(buildTool === "city" ? null : "city");
                            setBuildMenuOpen(false);
                          }}
                        >
                          <b>城市</b>
                          <ResourceCostList cost={BUILD_COSTS.city} />
                          <span className={`ct-afford${canAfford(me!.hand, BUILD_COSTS.city) ? "" : " is-poor"}`}>
                            {canAfford(me!.hand, BUILD_COSTS.city) ? "可升级" : "资源不足"}
                          </span>
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <button type="button" className="ct-actbtn" onClick={() => setTradeOpen(true)}>
                    交易
                  </button>
                  <button
                    type="button"
                    className="ct-actbtn"
                    disabled={!canAfford(me!.hand, BUILD_COSTS.dev) || view.devDeckCount === 0}
                    title={view.devDeckCount === 0 ? "发展卡已被抽完" : "消耗 羊毛1 小麦1 矿石1"}
                    onClick={() => void submit({ type: "buy_dev", player: myIdx })}
                  >
                    买发展卡
                  </button>
                  {game.freeRoads > 0 ? <span className="ct-freeroads">免费道路 ×{game.freeRoads}</span> : null}
                  <button
                    type="button"
                    className="ct-actbtn ct-actbtn--end"
                    onClick={() => {
                      clearTool();
                      void submit({ type: "end_turn", player: myIdx });
                    }}
                  >
                    结束回合
                  </button>
                </div>
              ) : (
                <div className="ct-actionrow ct-waitrow">
                  <span className="ct-waiting">
                    <i className="ct-waitdot" aria-hidden="true" />
                    {pausedSeatId ? "有玩家离席，对局暂停…" : autoDecision ? `${current.name} 超时代打` : `${current.name} 正在行动…`}
                  </span>
                </div>
              )}
          </section>

          <section className="ct-dicetray" aria-label="骰子">
            <Dice value={dice.a} rolling={dice.rolling} />
            <Dice value={dice.b} rolling={dice.rolling} tint="red" />
            <span className={`ct-dicesum${dice.rolling ? " is-rolling" : ""}`}>{dice.rolling ? "…" : dice.a + dice.b}</span>
          </section>
        </footer>
      </div>

      {robberVictimChoices.length > 0 ? (
        <div className="ct-victims">
          <div className="ct-victims-card">
            <h3>从谁手中摸一张资源卡？</h3>
            <div className="ct-victims-row">
              {robberVictimChoices.map((v) => {
                const vp = game.players[v]!;
                return (
                  <button
                    key={v}
                    type="button"
                    className="ct-victimbtn"
                    onClick={() => void submit({ type: "steal", player: myIdx, victim: v })}
                  >
                    <i style={{ background: vp.color } as CSSProperties} aria-hidden="true" />
                    {vp.name}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {devPick ? (
        <ResourcePickModal
          kind={devPick}
          onClose={() => setDevPick(null)}
          onPick={(picks, resource) => {
            void submit({ type: "play_dev", player: myIdx, card: devPick, picks, resource });
            setDevPick(null);
            setDevReveal(false);
          }}
        />
      ) : null}

      {toasts.length > 0 ? (
        <div className="ct-toasts" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className="ct-toast">
              {t.text}
            </div>
          ))}
        </div>
      ) : null}

      {rulesOpen ? <RulesModal onClose={() => setRulesOpen(false)} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 子组件                                                              */
/* ------------------------------------------------------------------ */

function canAfford(hand: ResourceCount, cost: Partial<ResourceCount>): boolean {
  return (Object.keys(cost) as ResourceId[]).every((k) => hand[k] >= (cost[k] ?? 0));
}

function PlayerBadge({ p, vp, isCurrent, isYou }: { p: PlayerState; vp: number; isCurrent: boolean; isYou?: boolean }): ReactElement {
  return (
    <span className={`ct-badge${isCurrent ? " is-current" : ""}`}>
      <i className="ct-badge-chip" style={{ background: p.color } as CSSProperties} aria-hidden="true" />
      <b className="ct-badge-name">{p.name}</b>
      {isYou ? <span className="ct-badge-you">你</span> : null}
      <span className="ct-badge-vp" title="胜利点">
        {vp}
        <small>分</small>
      </span>
    </span>
  );
}

function seatStats(game: CatanGame, id: number) {
  const p = game.players[id]!;
  return {
    hand: p.handCount ?? RESOURCES.reduce((s, r) => s + p.hand[r], 0),
    roads: game.roads.filter((x) => x.owner === id).length,
    settlements: game.buildings.filter((x) => x.owner === id && !x.city).length,
    cities: game.buildings.filter((x) => x.owner === id && x.city).length,
    knights: p.knightsPlayed,
  };
}

/** 围坐四方的对手面板：铭牌式，不做成大卡片。 */
function PlayerPanel({
  game,
  id,
  seat,
  isCurrent,
}: {
  game: CatanGame;
  id: number;
  seat: "left" | "right" | "top";
  isCurrent: boolean;
}): ReactElement {
  const p = game.players[id]!;
  // 对手不公开发展卡分：只显示公开胜利点。
  const vp = publicVP(game, id);
  const stats = seatStats(game, id);
  return (
    <aside className={`ct-seat ct-seat--${seat}${isCurrent ? " is-current" : ""}`}>
      <div className="ct-seat-name">
        <i className="ct-badge-chip" style={{ background: p.color } as CSSProperties} aria-hidden="true" />
        <b>{p.name}</b>
        <span className="ct-seat-vp" title={`${vp} 胜利点（公开）`}>
          {vp}
          <small>分</small>
        </span>
      </div>
      <div className="ct-seat-meta">
        <span title="手牌数量">🂠 {stats.hand}</span>
        <span title="村庄">⌂ {stats.settlements}</span>
        <span title="城市">◮ {stats.cities}</span>
        <span title="道路">▰ {stats.roads}</span>
        {stats.knights > 0 ? <span title="已打出骑士">♞ {stats.knights}</span> : null}
      </div>
      <div className="ct-seat-status">{isCurrent ? "行动中" : "等待"}</div>
    </aside>
  );
}

function IncomingOffer({
  fromName,
  give,
  want,
  onAccept,
  onReject,
}: {
  fromName: string;
  give: ResourceCount;
  want: ResourceCount;
  onAccept: () => void;
  onReject: () => void;
}): ReactElement {
  return (
    <div className="ct-offer">
      <div className="ct-offer-text">
        <b>{fromName}</b> 想用 <TradeCounts counts={give} /> 换你的 <TradeCounts counts={want} />
      </div>
      <div className="ct-offer-btns">
        <button type="button" className="ct-offer-accept" onClick={onAccept}>
          成交
        </button>
        <button type="button" className="ct-offer-reject" onClick={onReject}>
          婉拒
        </button>
      </div>
    </div>
  );
}

function TradeCounts({ counts }: { counts: ResourceCount }): ReactElement {
  return (
    <span className="ct-counts">
      {RESOURCES.filter((r) => counts[r] > 0).map((r) => (
        <span key={r} className="ct-count">
          {counts[r]}×{RESOURCE_NAMES[r]}
        </span>
      ))}
    </span>
  );
}

/* ---------------- 发展卡选资源（丰收 / 垄断） ---------------- */

function ResourcePickModal({
  kind,
  onClose,
  onPick,
}: {
  kind: "yearOfPlenty" | "monopoly";
  onClose: () => void;
  onPick: (picks: [ResourceId, ResourceId] | undefined, resource: ResourceId | undefined) => void;
}): ReactElement {
  const [picks, setPicks] = useState<ResourceId[]>([]);
  const title = kind === "yearOfPlenty" ? "丰收 —— 任取两种资源" : "垄断 —— 宣告一种资源，收走各家全部库存";
  const done = kind === "yearOfPlenty" ? picks.length === 2 : picks.length === 1;
  return (
    <div className="ct-modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="ct-modal-card" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <div className="ct-pickrow">
          {RESOURCES.map((r) => (
            <button
              key={r}
              type="button"
              className={`ct-pickbtn${picks.includes(r) ? " is-active" : ""}`}
              onClick={() =>
                setPicks((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : kind === "monopoly" ? [r] : [...cur.slice(1), r]))
              }
            >
              <ResourceIcon res={r} size="lg" />
              <span>{RESOURCE_NAMES[r]}</span>
            </button>
          ))}
        </div>
        <div className="ct-victory-btns">
          <button type="button" className="ct-actbtn ct-actbtn--primary" disabled={!done} onClick={() => onPick(kind === "yearOfPlenty" ? [picks[0]!, picks[1] ?? picks[0]!] : undefined, kind === "monopoly" ? picks[0] : undefined)}>
            确定
          </button>
          <button type="button" className="ct-actbtn" onClick={onClose}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- 交易面板 ---------------- */

function TradePanel({
  open,
  game,
  myIdx,
  onClose,
  pendingFromHuman,
  onCancel,
  onPropose,
  onBank,
}: {
  open: boolean;
  game: CatanGame;
  myIdx: number;
  onClose: () => void;
  pendingFromHuman: boolean;
  onCancel: () => void;
  onPropose: (to: number, give: Partial<ResourceCount>, want: Partial<ResourceCount>) => void;
  onBank: (give: ResourceId, want: ResourceId) => void;
}): ReactElement | null {
  const me = game.players[myIdx]!;
  const [tab, setTab] = useState<"player" | "bank">("player");
  const [give, setGive] = useState<ResourceCount>({ wood: 0, brick: 0, wool: 0, wheat: 0, ore: 0 });
  const [want, setWant] = useState<ResourceCount>({ wood: 0, brick: 0, wool: 0, wheat: 0, ore: 0 });
  const [target, setTarget] = useState<number>(myIdx === 0 ? 1 : 0);
  const [bankGive, setBankGive] = useState<ResourceId>("wood");
  const [bankWant, setBankWant] = useState<ResourceId>("ore");

  if (!open) return null;
  const targets = game.players.filter((p) => p.id !== myIdx);
  const targetOk = targets.some((p) => p.id === target) ? target : targets[0]!.id;
  const giveTotal = RESOURCES.reduce((s, r) => s + give[r], 0);
  const wantTotal = RESOURCES.reduce((s, r) => s + want[r], 0);
  const offerOk = !pendingFromHuman && giveTotal > 0 && wantTotal > 0 && RESOURCES.every((r) => give[r] <= me.hand[r]);

  const rate = tradeRate(game, myIdx, bankGive);

  const step = (which: "give" | "want", r: ResourceId, d: number, cap: number) => {
    const set = which === "give" ? setGive : setWant;
    set((cur) => ({ ...cur, [r]: Math.max(0, Math.min(cap, cur[r] + d)) }));
  };
  return (
    <aside className="ct-trade is-open" aria-label="交易面板">
      <header className="ct-trade-head">
        <h3>交易</h3>
        <div className="ct-trade-tabs">
          <button type="button" className={tab === "player" ? "is-active" : ""} onClick={() => setTab("player")}>
            与玩家
          </button>
          <button type="button" className={tab === "bank" ? "is-active" : ""} onClick={() => setTab("bank")}>
            港口银行
          </button>
        </div>
        <button type="button" className="ct-trade-close" onClick={onClose} aria-label="关闭交易面板">
          ×
        </button>
      </header>

      {tab === "player" ? (
        <div className="ct-trade-body">
          <p className="ct-trade-note">
            {pendingFromHuman ? "提议已送出，等待回应…" : "像在桌边开口：以物易物，等对手点头。"}
          </p>
          <TradeRows label="你付出" counts={give} hand={me.hand} onStep={(r, d) => step("give", r, d, me.hand[r])} />
          <div className="ct-trade-swap" aria-hidden="true">
            ⇅
          </div>
          <TradeRows label="你想换" counts={want} hand={null} onStep={(r, d) => step("want", r, d, 4)} />
          <div className="ct-trade-targets">
            <span>对象</span>
            {targets.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`ct-target${targetOk === p.id ? " is-active" : ""}`}
                onClick={() => setTarget(p.id)}
              >
                <i style={{ background: p.color } as CSSProperties} aria-hidden="true" />
                {p.name}
              </button>
            ))}
          </div>
          {pendingFromHuman ? (
            <button type="button" className="ct-trade-send is-waiting" onClick={onCancel}>
              撤回提议
            </button>
          ) : (
            <button
              type="button"
              className="ct-trade-send"
              disabled={!offerOk}
              onClick={() => {
                onPropose(targetOk, give, want);
                setGive({ wood: 0, brick: 0, wool: 0, wheat: 0, ore: 0 });
                setWant({ wood: 0, brick: 0, wool: 0, wheat: 0, ore: 0 });
              }}
            >
              提议交易
            </button>
          )}
        </div>
      ) : (
        <div className="ct-trade-body">
          <p className="ct-trade-note">按你控制的港口比率与银行交易（无港 4:1 · 通用港 3:1 · 专属港 2:1）。</p>
          <div className="ct-bank-rate">
            换出 <b>{RESOURCE_NAMES[bankGive]}</b> 的比率：<em>{rate}:1</em>
          </div>
          <div className="ct-bank-picks">
            <span>换出</span>
            {RESOURCES.map((r) => (
              <button
                key={r}
                type="button"
                className={`ct-bankpick${bankGive === r ? " is-active" : ""}`}
                disabled={me.hand[r] < rate}
                title={`持有 ${me.hand[r]}`}
                onClick={() => setBankGive(r)}
              >
                <ResourceIcon res={r} size="sm" />
                <small>×{rate}</small>
              </button>
            ))}
          </div>
          <div className="ct-bank-picks">
            <span>换入</span>
            {RESOURCES.filter((r) => r !== bankGive).map((r) => (
              <button
                key={r}
                type="button"
                className={`ct-bankpick${bankWant === r ? " is-active" : ""}`}
                onClick={() => setBankWant(r)}
              >
                <ResourceIcon res={r} size="sm" />
              </button>
            ))}
          </div>
          <button
            type="button"
            className="ct-trade-send"
            disabled={me.hand[bankGive] < rate || bankGive === bankWant}
            onClick={() => onBank(bankGive, bankWant)}
          >
            与银行成交（{rate} {RESOURCE_NAMES[bankGive]} → 1 {RESOURCE_NAMES[bankWant]}）
          </button>
        </div>
      )}
    </aside>
  );
}

function TradeRows({
  label,
  counts,
  hand,
  onStep,
}: {
  label: string;
  counts: ResourceCount;
  hand: ResourceCount | null;
  onStep: (r: ResourceId, d: number) => void;
}): ReactElement {
  return (
    <div className="ct-traderows">
      <span className="ct-traderows-label">{label}</span>
      {RESOURCES.map((r) => (
        <div key={r} className={`ct-traderow${counts[r] > 0 ? " is-set" : ""}`}>
          <ResourceIcon res={r} size="sm" />
          <span className="ct-traderow-name">{RESOURCE_NAMES[r]}</span>
          <span className="ct-traderow-stepper">
            <button type="button" onClick={() => onStep(r, -1)} disabled={counts[r] === 0} aria-label={`减少${RESOURCE_NAMES[r]}`}>
              −
            </button>
            <b>{counts[r]}</b>
            <button
              type="button"
              onClick={() => onStep(r, +1)}
              disabled={hand != null && counts[r] >= hand[r]}
              aria-label={`增加${RESOURCE_NAMES[r]}`}
            >
              +
            </button>
          </span>
          {hand != null ? <span className="ct-traderow-hold">持有 {hand[r]}</span> : null}
        </div>
      ))}
    </div>
  );
}

/* ---------------- 胜利结算 ---------------- */

function VictoryScreen({
  game,
  myIdx,
  onRematch,
  onConfirmRematch,
  onDeclineRematch,
  onExit,
}: {
  game: CatanGame;
  myIdx: number;
  onRematch: () => void;
  onConfirmRematch: () => void;
  onDeclineRematch: () => void;
  onExit: () => void;
}): ReactElement {
  const winner = game.players[game.winner!]!;
  const scores = game.finalScores ?? [];
  const myScore = scores.find((s) => s.player === myIdx);
  const isYou = game.winner === myIdx;
  return (
    <div className={`ct-victory${isYou ? " is-you" : " is-other"}`}>
      <div className="ct-victory-card">
        <div className="ct-victory-laurel" aria-hidden="true">
          ♛
        </div>
        <h1 className="ct-victory-title">{isYou ? "胜 利" : "对局结束"}</h1>
        <p className="ct-victory-name">
          {winner.name} · <span>{myScore?.total ?? scores.find((s) => s.player === game.winner)?.total ?? 10} VP</span>
        </p>
        <div className="ct-victory-rule" aria-hidden="true" />
        {myScore ? (
          <dl className="ct-victory-break">
            <div>
              <dt>村庄与城市</dt>
              <dd>{myScore.buildings} 分</dd>
            </div>
            <div>
              <dt>胜利点卡</dt>
              <dd>{myScore.vpCards} 分</dd>
            </div>
            <div>
              <dt>最长道路</dt>
              <dd>{myScore.longestRoad} 分</dd>
            </div>
            <div>
              <dt>最大骑士军团</dt>
              <dd>{myScore.largestArmy} 分</dd>
            </div>
          </dl>
        ) : null}
        <table className="ct-victory-board">
          <tbody>
            {scores
              .slice()
              .sort((a, b) => b.total - a.total)
              .map((s) => {
                const p = game.players[s.player];
                if (!p) return null;
                return (
                  <tr key={s.player} className={s.player === game.winner ? " is-winner" : ""}>
                    <td>
                      <i style={{ background: p.color } as CSSProperties} aria-hidden="true" />
                      {p.name}
                    </td>
                    <td>{s.total} VP</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
        <div className="ct-victory-btns">
          {myIdx === 0 ? (
            <button type="button" className="ct-actbtn ct-actbtn--primary" onClick={onRematch}>
              再来一局
            </button>
          ) : myIdx >= 0 ? (
            <>
              <button type="button" className="ct-actbtn ct-actbtn--primary" onClick={onConfirmRematch}>
                确认续局
              </button>
              <button type="button" className="ct-actbtn" onClick={onDeclineRematch}>
                离开
              </button>
            </>
          ) : null}
          <button type="button" className="ct-actbtn" onClick={onExit}>
            回到首页
          </button>
        </div>
      </div>
      <div className="ct-victory-dust" aria-hidden="true">
        {Array.from({ length: 9 }, (_, i) => (
          <i key={i} style={{ "--i": i } as CSSProperties} />
        ))}
      </div>
    </div>
  );
}

/* ---------------- 玩法说明 ---------------- */

export function RulesModal({ onClose }: { onClose: () => void }): ReactElement {
  return (
    <div className="ct-modal" role="dialog" aria-modal="true" aria-label="玩法说明" onClick={onClose}>
      <div className="ct-modal-card" onClick={(e) => e.stopPropagation()}>
        <h3>卡坦岛 · 玩法速览</h3>
        <ul className="ct-rules">
          <li>掷两颗骰子，点数对应的地块产出资源 —— 相邻村庄得 1，城市得 2；掷出 7 时强盗出动，无人产出。</li>
          <li>花资源建造：道路（木+砖）延伸网络，村庄（木+砖+麦+羊）得 1 分，城市（麦×2+矿×3）得 2 分。</li>
          <li>与其他玩家以物易物，或按港口比率与银行交易（4:1 / 3:1 / 2:1）。</li>
          <li>买发展卡：骑士驱逐强盗（3 名得「最大骑士军团」+2 分）、道路建设、丰收、垄断与隐藏的胜利点卡。</li>
          <li>
            率先凑齐 <b>10 分</b>（含最长道路 +2）者赢下卡坦岛。
          </li>
        </ul>
        <button type="button" className="ct-actbtn ct-actbtn--primary" onClick={onClose}>
          明白了
        </button>
      </div>
    </div>
  );
}
