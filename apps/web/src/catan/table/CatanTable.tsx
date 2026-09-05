import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import {
  BUILD_COSTS,
  DEV_NAMES,
  RESOURCE_NAMES,
  RESOURCES,
  type CatanGame,
  type DevCardKind,
  type FloatChip,
  type PlayerState,
  type ResourceCount,
  type ResourceId,
} from "../mock/types.ts";
import { playerVP, tradeRate } from "../mock/game.ts";
import { BoardMap, ownedHarbors, type BuildMode, type ConfirmTarget } from "./BoardMap.js";
import { Dice, DevCardFace, ResourceCardFace, ResourceCostList, ResourceIcon } from "./pieces.js";
import { useCatanGame } from "./useCatanGame.js";

/**
 * 卡坦岛桌面：绿呢台面上的中央地图，玩家围坐四方，
 * 底部是你的手牌、发展卡、行动面板与骰子；交易与提示走轻量浮层。
 */

interface CatanTableProps {
  playerName: string;
  seatCount: 3 | 4;
  roomCode: string;
  onExit: () => void;
  onRestart: () => void;
  /** 演示模式：开局即 9 分 + 一手资源，用于走查胜利结算（仅 Mock）。 */
  demoWin?: boolean;
}

interface ToastItem {
  id: number;
  text: string;
}

export function CatanTable({ playerName, seatCount, roomCode, onExit, onRestart, demoWin }: CatanTableProps): ReactElement {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastSeq = useRef(0);
  const announce = (text: string) => {
    const id = ++toastSeq.current;
    setToasts((cur) => [...cur.slice(-2), { id, text }]);
    window.setTimeout(() => setToasts((cur) => cur.filter((t) => t.id !== id)), 3200);
  };

  const { game, dice, hotTiles, floatChips, freshPiece, humanTurn, legal, canRespondAI, pendingFromHuman, actions } =
    useCatanGame(playerName, seatCount, announce, { demoWin });

  const [buildTool, setBuildTool] = useState<"road" | "settlement" | "city" | null>(null);
  const [buildMenuOpen, setBuildMenuOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null);
  const [tradeOpen, setTradeOpen] = useState(false);
  const [victimChoice, setVictimChoice] = useState<number[] | null>(null);
  const [illegalHint, setIllegalHint] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [devReveal, setDevReveal] = useState(false);
  const [devPick, setDevPick] = useState<"yearOfPlenty" | "monopoly" | null>(null);

  const me = game.players[0]!;
  const current = game.players[game.turn]!;

  // 回到你回合时的提示。
  const prevTurn = useRef(-1);
  useEffect(() => {
    if (game.turn === 0 && game.turn !== prevTurn.current && game.phase !== "over" && !game.winner) {
      announce("轮到你了 —— 掷骰子吧");
    }
    prevTurn.current = game.turn;
  }, [game.turn, game.phase, game.winner]);

  const clearTool = () => {
    setBuildTool(null);
    setConfirmTarget(null);
  };

  const flashIllegal = (text: string) => {
    setIllegalHint(text);
    window.setTimeout(() => setIllegalHint((cur) => (cur === text ? null : cur)), 1500);
  };

  const buildMode: BuildMode = game.phase === "robber" && game.turn === 0 ? "robber" : buildTool;

  const handleVertexClick = (vertexId: number) => {
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
    if (buildTool === "road") {
      setConfirmTarget({
        kind: "road",
        key: edgeId,
        title: "修建道路",
        cost: BUILD_COSTS.road,
        affordable: canAfford(me.hand, BUILD_COSTS.road),
      });
    }
  };

  const handleConfirm = (accept: boolean) => {
    const target = confirmTarget;
    setConfirmTarget(null);
    if (!target || !accept) return;
    let ok = false;
    if (target.kind === "road") ok = actions.buildRoad(target.key);
    else if (target.kind === "settlement") ok = actions.buildSettlement(target.key);
    else if (target.kind === "city") ok = actions.buildCity(target.key);
    if (!ok) {
      flashIllegal("资源不足，无法建造");
      return;
    }
    if (target.kind !== "road") clearTool();
    else if (!canAfford(me.hand, BUILD_COSTS.road)) clearTool();
  };

  const handleTileClick = (tileId: number) => {
    if (game.phase !== "robber" || game.turn !== 0) return;
    const victims = actions.moveRobberTo(tileId);
    if (victims && victims.length > 0) setVictimChoice(victims);
  };

  // 结束对局画面。
  if (game.winner != null) {
    return <VictoryScreen game={game} onRestart={onRestart} onExit={onExit} />;
  }

  const pending = game.pendingTrade;

  return (
    <div className="ct-game">
      <div className="ct-table">
        <header className="ct-tabletop">
          <div className="ct-plaque">
            <span className="ct-plaque-room">{roomCode}</span>
            <span className="ct-plaque-dot" aria-hidden="true" />
            <span className="ct-plaque-round">第 {game.turnNo} 轮</span>
            <span className="ct-plaque-dot" aria-hidden="true" />
            <span className="ct-plaque-whos">{humanTurn ? "你的回合" : `${current.name} 的回合`}</span>
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
              myColor={me.color}
              buildMode={buildMode}
              legalRoads={legal.roads}
              legalSettlements={legal.settlements}
              legalCities={legal.cities}
              hotTiles={hotTiles}
              floatChips={floatChips}
              freshPiece={freshPiece}
              activeHarbors={ownedHarbors(game, 0)}
              confirmTarget={confirmTarget}
              onTileClick={handleTileClick}
              onEdgeClick={handleEdgeClick}
              onVertexClick={handleVertexClick}
              onConfirm={handleConfirm}
              onVoidClick={() => {
                if (confirmTarget) setConfirmTarget(null);
                else if (buildTool) flashIllegal("这个位置现在不能建造");
              }}
            />
            {game.phase === "robber" && game.turn === 0 ? (
              <div className="ct-robberbar">
                <span className="ct-robberbar-icon" aria-hidden="true">♞</span>
                移动强盗 —— 点击任意地块安置他
              </div>
            ) : null}
            {illegalHint ? <div className="ct-illegal">{illegalHint}</div> : null}
            {canRespondAI && pending ? (
              <IncomingOffer
                fromName={game.players[pending.from]!.name}
                give={pending.give}
                want={pending.want}
                onAccept={() => actions.respondToAI(true)}
                onReject={() => actions.respondToAI(false)}
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
            onClose={() => setTradeOpen(false)}
            pendingFromHuman={pendingFromHuman}
            onCancel={() => actions.cancelProposal()}
            onPropose={(to, give, want) => actions.proposeTo(to, give, want)}
            onBank={(give, want) => actions.bankExchange(give, want)}
          />
        </div>

        <footer className="ct-bench">
          <section className="ct-me">
            <PlayerBadge p={me} vp={playerVP(game, 0).total} isCurrent={game.turn === 0} isYou />
            <span className="ct-me-stats">
              <i title="道路">▰ {game.roads.filter((r) => r.owner === 0).length}</i>
              <i title="村庄">⌂ {game.buildings.filter((b) => b.owner === 0 && !b.city).length}</i>
              <i title="城市">◮ {game.buildings.filter((b) => b.owner === 0 && b.city).length}</i>
            </span>
          </section>

          <section className="ct-hand" aria-label="你的资源手牌">
            {RESOURCES.filter((r) => me.hand[r] > 0).length === 0 ? (
              <span className="ct-hand-empty">手牌空空 —— 等待产出，或做一笔交易吧</span>
            ) : (
              RESOURCES.filter((r) => me.hand[r] > 0).map((r) => (
                <div key={r} className="ct-hand-slot">
                  <ResourceCardFace res={r} count={me.hand[r]} />
                </div>
              ))
            )}
          </section>

          <section className="ct-devtray" aria-label="你的发展卡">
            <div className="ct-devtray-head">
              <span>发展卡</span>
              <button type="button" className="ct-devpeek" onClick={() => setDevReveal((v) => !v)}>
                {devReveal ? "扣回" : "查看"}
              </button>
            </div>
            <div className="ct-devcards">
              {me.dev.length === 0 ? (
                <div className="ct-devcards-empty">
                  <DevCardFace kind="knight" revealed={false} />
                  <span className="ct-devcount">0</span>
                </div>
              ) : (
                me.dev.map((kind, i) => {
                  // 牌多时自动收紧叠放（收进约 160px），避免牌堆溢出盖住相邻面板。
                  const overlap = Math.max(0, (74 * me.dev.length - 160) / Math.max(1, me.dev.length - 1));
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
                        actions.playDevCard(kind);
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
              {me.playedDev.filter((k) => k === "knight").length > 0 ? (
                <span className="ct-devknights">骑士 ×{me.playedDev.filter((k) => k === "knight").length}</span>
              ) : null}
            </div>
          </section>

          <section className="ct-actions" aria-label="行动面板">
            {humanTurn && game.phase === "robber" ? (
              <div className="ct-actionrow ct-waitrow">
                <span className="ct-waiting">
                  <i className="ct-waitdot" aria-hidden="true" />
                  强盗出没 —— 在地图上为他选择新驻地
                </span>
              </div>
            ) : humanTurn && game.phase === "roll" ? (
                <div className="ct-actionrow">
                  <button type="button" className="ct-actbtn ct-actbtn--primary" onClick={() => actions.roll()}>
                    掷骰子
                  </button>
                  <button type="button" className="ct-actbtn" onClick={() => setTradeOpen(true)}>
                    交易
                  </button>
                </div>
              ) : humanTurn ? (
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
                          <span className={`ct-afford${canAfford(me.hand, BUILD_COSTS.road) ? "" : " is-poor"}`}>
                            {canAfford(me.hand, BUILD_COSTS.road) ? "可建" : "资源不足"}
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
                          <span className={`ct-afford${canAfford(me.hand, BUILD_COSTS.settlement) ? "" : " is-poor"}`}>
                            {canAfford(me.hand, BUILD_COSTS.settlement) ? "可建" : "资源不足"}
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
                          <span className={`ct-afford${canAfford(me.hand, BUILD_COSTS.city) ? "" : " is-poor"}`}>
                            {canAfford(me.hand, BUILD_COSTS.city) ? "可升级" : "资源不足"}
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
                    disabled={!canAfford(me.hand, BUILD_COSTS.dev) || game.devDeck.length === 0}
                    title={game.devDeck.length === 0 ? "发展卡已被抽完" : "消耗 羊毛1 小麦1 矿石1"}
                    onClick={() => actions.buyDev()}
                  >
                    买发展卡
                  </button>
                  {game.freeRoads > 0 ? <span className="ct-freeroads">免费道路 ×{game.freeRoads}</span> : null}
                  <button
                    type="button"
                    className="ct-actbtn ct-actbtn--end"
                    onClick={() => {
                      clearTool();
                      actions.endTurn();
                    }}
                  >
                    结束回合
                  </button>
                </div>
              ) : (
                <div className="ct-actionrow ct-waitrow">
                  <span className="ct-waiting">
                    <i className="ct-waitdot" aria-hidden="true" />
                    {`${current.name} 正在行动…`}
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

      {victimChoice ? (
        <div className="ct-victims">
          <div className="ct-victims-card">
            <h3>从谁手中摸一张资源卡？</h3>
            <div className="ct-victims-row">
              {victimChoice.map((v) => {
                const vp = game.players[v]!;
                return (
                  <button
                    key={v}
                    type="button"
                    className="ct-victimbtn"
                    onClick={() => {
                      setVictimChoice(null);
                      actions.stealFrom(v);
                    }}
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
            actions.playDevCard(devPick, { picks, resource });
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
  return {
    hand: RESOURCES.reduce((s, r) => s + game.players[id]!.hand[r], 0),
    roads: game.roads.filter((x) => x.owner === id).length,
    settlements: game.buildings.filter((x) => x.owner === id && !x.city).length,
    cities: game.buildings.filter((x) => x.owner === id && x.city).length,
    knights: game.players[id]!.knightsPlayed,
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
  const vp = playerVP(game, id);
  const stats = seatStats(game, id);
  return (
    <aside className={`ct-seat ct-seat--${seat}${isCurrent ? " is-current" : ""}`}>
      <div className="ct-seat-name">
        <i className="ct-badge-chip" style={{ background: p.color } as CSSProperties} aria-hidden="true" />
        <b>{p.name}</b>
        <span className="ct-seat-vp" title={`${vp.total} 胜利点`}>
          {vp.total}
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
  onClose,
  pendingFromHuman,
  onCancel,
  onPropose,
  onBank,
}: {
  open: boolean;
  game: CatanGame;
  onClose: () => void;
  pendingFromHuman: boolean;
  onCancel: () => void;
  onPropose: (to: number, give: Partial<ResourceCount>, want: Partial<ResourceCount>) => void;
  onBank: (give: ResourceId, want: ResourceId) => void;
}): ReactElement | null {
  const me = game.players[0]!;
  const [tab, setTab] = useState<"player" | "bank">("player");
  const [give, setGive] = useState<ResourceCount>({ wood: 0, brick: 0, wool: 0, wheat: 0, ore: 0 });
  const [want, setWant] = useState<ResourceCount>({ wood: 0, brick: 0, wool: 0, wheat: 0, ore: 0 });
  const [target, setTarget] = useState<number>(1);
  const [bankGive, setBankGive] = useState<ResourceId>("wood");
  const [bankWant, setBankWant] = useState<ResourceId>("ore");

  if (!open) return null;
  const targets = game.players.filter((p) => p.id !== 0);
  const targetOk = targets.some((p) => p.id === target) ? target : targets[0]!.id;
  const giveTotal = RESOURCES.reduce((s, r) => s + give[r], 0);
  const wantTotal = RESOURCES.reduce((s, r) => s + want[r], 0);
  const offerOk = !pendingFromHuman && giveTotal > 0 && wantTotal > 0 && RESOURCES.every((r) => give[r] <= me.hand[r]);

  const rate = tradeRate(game, 0, bankGive);

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
  onRestart,
  onExit,
}: {
  game: CatanGame;
  onRestart: () => void;
  onExit: () => void;
}): ReactElement {
  const winner = game.players[game.winner!]!;
  const vp = playerVP(game, game.winner!);
  const isYou = game.winner === 0;
  return (
    <div className={`ct-victory${isYou ? " is-you" : " is-other"}`}>
      <div className="ct-victory-card">
        <div className="ct-victory-laurel" aria-hidden="true">
          ♛
        </div>
        <h1 className="ct-victory-title">{isYou ? "胜 利" : "对局结束"}</h1>
        <p className="ct-victory-name">
          {winner.name} · <span>{vp.total} VP</span>
        </p>
        <div className="ct-victory-rule" aria-hidden="true" />
        <dl className="ct-victory-break">
          <div>
            <dt>村庄与城市</dt>
            <dd>{vp.buildings} 分</dd>
          </div>
          <div>
            <dt>胜利点卡</dt>
            <dd>{vp.vpCards} 分</dd>
          </div>
          <div>
            <dt>最长道路</dt>
            <dd>{vp.longestRoad} 分</dd>
          </div>
          <div>
            <dt>最大骑士军团</dt>
            <dd>{vp.largestArmy} 分</dd>
          </div>
        </dl>
        <table className="ct-victory-board">
          <tbody>
            {game.players.map((p) => (
              <tr key={p.id} className={p.id === game.winner ? " is-winner" : ""}>
                <td>
                  <i style={{ background: p.color } as CSSProperties} aria-hidden="true" />
                  {p.name}
                </td>
                <td>{playerVP(game, p.id).total} VP</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="ct-victory-btns">
          <button type="button" className="ct-actbtn ct-actbtn--primary" onClick={onRestart}>
            再来一局
          </button>
          <button type="button" className="ct-actbtn" onClick={onExit}>
            回到大厅
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

export type { FloatChip };
