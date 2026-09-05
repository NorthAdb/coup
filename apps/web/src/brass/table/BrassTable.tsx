import { useEffect, useMemo, useRef, useState } from "react";
import type { BeerSource, BrassCommand, BrassState, CoalSource, IronSource, IndustryType } from "@coup/brass-domain";
import {
  beerCandidates,
  buildOptionsForCard,
  buyPriceAt,
  canScout,
  coalCandidates,
  COAL_FLOOR_PRICE,
  COAL_MARKET_CAPACITY,
  COAL_MARKET_PRICES,
  developOptions,
  incomeLevelAt,
  IRON_FLOOR_PRICE,
  IRON_MARKET_CAPACITY,
  IRON_MARKET_PRICES,
  ironCandidates,
  LINKS,
  linkEndpoints,
  loanPreview,
  LOCATIONS,
  MERCHANTS,
  networkOptions,
  sellTargets,
  tileSpec,
} from "@coup/brass-domain";
import type { BrassSeatAbsence, BrassView } from "../brassApi.js";
import { submitBrassCommand } from "../brassApi.js";
import {
  INDUSTRY_CHIP,
  INDUSTRY_LABEL,
  INDUSTRY_SHORT,
  cardLabel,
  errorText,
  handOrder,
  linkLabel,
  locationLabel,
  logText,
  roman,
} from "../labels.js";
import { BoardMap, playerColor } from "./BoardMap.js";
import { RulesModal } from "./RulesModal.js";

type SaleDraft = {
  tileId: string;
  merchantSlotId: string;
  beerSources: BeerSource[];
  developIndustry?: IndustryType;
};

type Draft =
  | { mode: "idle" }
  | { mode: "build"; cardId: string; location: string | null; industry: IndustryType | null; slotIndex: number | null; overbuildTileId: string | null; coalSources: CoalSource[]; ironSources: IronSource[] }
  | { mode: "network"; cardId: string; linkIndexes: number[]; coalSources: CoalSource[][]; beerSource: BeerSource | null }
  | { mode: "develop"; cardId: string; industries: IndustryType[]; ironSources: IronSource[] }
  | { mode: "sell"; cardId: string; sales: SaleDraft[] }
  | { mode: "loan"; cardId: string }
  | { mode: "scout"; cardIds: string[] };

export type BrassTableProps = {
  view: BrassView;
  roomCode: string;
  absences: BrassSeatAbsence[];
  turnDeadline: { seatId: string; deadlineAt: number; durationMs: number } | null;
  autoDecision: { seatId: string; at: number; kind: string } | null;
  onError: (message: string) => void;
};

function coalLabel(state: BrassState, source: CoalSource): string {
  if (source.kind === "market") {
    return state.coalMarket > 0 ? `煤市场（£/块按格价）` : "煤市场（空 £8 兜底）";
  }
  const tile = state.placedTiles.find((t) => t.id === source.tileId);
  if (!tile) return "煤矿";
  return `${locationLabel(tile.location)} 的煤矿（免费）`;
}

function ironLabel(state: BrassState, source: IronSource): string {
  if (source.kind === "market") {
    return state.ironMarket > 0 ? "铁市场（£/块按格价）" : "铁市场（空 £6 兜底）";
  }
  const tile = state.placedTiles.find((t) => t.id === source.tileId);
  if (!tile) return "铁厂";
  return `${locationLabel(tile.location)} 的铁厂（免费）`;
}

function beerLabel(state: BrassState, source: BeerSource): string {
  if (source.kind === "merchant") {
    const m = state.merchantTiles.find((x) => x.slotId === source.merchantSlotId);
    return `商人啤酒：${locationLabel(m?.location ?? "")}${m ? `（${merchantBeerBonus(m.location)}）` : ""}`;
  }
  const tile = state.placedTiles.find((t) => t.id === source.tileId);
  if (!tile) return "酒厂";
  return `${tile.player === 0 ? "" : ""}${locationLabel(tile.location)} 的酒厂${tile.player !== 0 ? "（对手）" : "（自己）"}`;
}

function merchantBeerBonus(location: string): string {
  const bonus = MERCHANTS[location]?.bonus;
  if (!bonus) return "";
  if (bonus.type === "vp") return `+${bonus.amount}分`;
  if (bonus.type === "money") return `+£${bonus.amount}`;
  if (bonus.type === "income") return "收入+2格";
  return "免费研发";
}

/** 手牌卡：解析产业集合（地点卡 → 该地点可建产业；产业卡 → 卡面产业；万能 → null）。 */
function cardIndustries(cardId: string): IndustryType[] | null {
  if (cardId === "wild-location" || cardId === "wild-industry") return null;
  const base = cardId.slice(0, cardId.lastIndexOf("#") >= 0 ? cardId.lastIndexOf("#") : undefined);
  if (base.startsWith("loc-")) {
    const loc = LOCATIONS[base.slice(4)];
    if (!loc) return [];
    return Array.from(new Set(loc.slots.flatMap((s) => s.industries)));
  }
  if (base.startsWith("ind-")) {
    return base.slice(4).split("_") as IndustryType[];
  }
  return [];
}

function cardTitle(cardId: string): string {
  if (cardId === "wild-location") return "任意地点";
  if (cardId === "wild-industry") return "任意产业";
  const base = cardId.slice(0, cardId.lastIndexOf("#") >= 0 ? cardId.lastIndexOf("#") : undefined);
  if (base.startsWith("loc-")) return locationLabel(base.slice(4));
  if (base.startsWith("ind-")) return (cardIndustries(cardId) ?? []).map((i) => INDUSTRY_SHORT[i] ?? i).join(" / ");
  return cardId;
}

function cardKindLabel(cardId: string): string {
  if (cardId === "wild-location" || cardId === "wild-industry") return "万能";
  const base = cardId.slice(0, cardId.lastIndexOf("#") >= 0 ? cardId.lastIndexOf("#") : undefined);
  return base.startsWith("loc-") ? "地点" : "产业";
}

export function BrassTable({ view, roomCode, absences, turnDeadline, autoDecision, onError }: BrassTableProps) {
  const state = view.state;
  const myPlayer = view.spectator ? null : Number(view.seatId) - 1;
  const isMyTurn = view.isYourTurn && state.status === "in_progress";
  const [draft, setDraft] = useState<Draft>({ mode: "idle" });
  const [submitting, setSubmitting] = useState(false);
  const [showLog, setShowLog] = useState(true);
  const [now, setNow] = useState(Date.now());

  // 每秒刷新倒计时显示。
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const hand = handOrder(state, view.hand);

  function patchDraft(partial: Partial<Extract<Draft, { mode: "build" }>>): void {
    setDraft((d) => (d.mode === "build" ? { ...d, ...partial } : d));
  }

  function startAction(mode: Draft["mode"]): void {
    if (!isMyTurn || state.actionsLeft <= 0 || hand.length === 0) return;
    const cardId = draft.mode !== "idle" && "cardId" in draft ? draft.cardId : hand[0];
    if (mode === "build") {
      setDraft({ mode: "build", cardId, location: null, industry: null, slotIndex: null, overbuildTileId: null, coalSources: [], ironSources: [] });
    } else if (mode === "network") {
      setDraft({ mode: "network", cardId, linkIndexes: [], coalSources: [], beerSource: null });
    } else if (mode === "develop") {
      setDraft({ mode: "develop", cardId, industries: [], ironSources: [] });
    } else if (mode === "sell") {
      setDraft({ mode: "sell", cardId, sales: [] });
    } else if (mode === "loan") {
      setDraft({ mode: "loan", cardId });
    } else if (mode === "scout") {
      const others = hand.filter((c) => c !== "wild-location" && c !== "wild-industry");
      setDraft({ mode: "scout", cardIds: others.slice(0, 3) });
    }
  }

  async function submit(command: BrassCommand): Promise<void> {
    setSubmitting(true);
    try {
      await submitBrassCommand(roomCode, command, `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
      setDraft({ mode: "idle" });
    } catch (error) {
      onError(errorText(error));
    } finally {
      setSubmitting(false);
    }
  }

  // ----------------------------------------------------------------
  // Build 草稿派生
  // ----------------------------------------------------------------
  const buildInfo = useMemo(() => {
    if (draft.mode !== "build") return null;
    const info = buildOptionsForCard(state, myPlayer ?? 0, draft.cardId);
    if (!draft.location) return { info, spot: null };
    const spots = info.spots.filter((s) => s.location === draft.location);
    const industry =
      draft.industry && spots.some((s) => s.industry === draft.industry)
        ? draft.industry
        : (spots[0]?.industry ?? null);
    const spot = spots.find((s) => s.industry === industry) ?? null;
    return { info, spot };
  }, [draft, state, myPlayer]);

  // 覆盖目标：无空槽时强制取第一个候选；有空槽时仅在用户勾选后生效。
  const effectiveOverbuildId = useMemo(() => {
    if (draft.mode !== "build" || !buildInfo?.spot) return null;
    const ids = buildInfo.spot.overbuildTileIds;
    if (ids.length === 0) return null;
    if (draft.overbuildTileId && ids.includes(draft.overbuildTileId)) return draft.overbuildTileId;
    return buildInfo.spot.emptySlots.length === 0 ? ids[0] : null;
  }, [draft, buildInfo]);

  const buildCoalCandidates = useMemo(() => {
    if (draft.mode !== "build" || !buildInfo?.spot || buildInfo.spot.costCoal === 0) return [];
    return coalCandidates(state, [draft.location!]);
  }, [draft, buildInfo, state]);

  const buildIronCandidates = useMemo(() => {
    if (draft.mode !== "build" || !buildInfo?.spot || buildInfo.spot.costIron === 0) return [];
    return ironCandidates(state);
  }, [draft, buildInfo, state]);

  // 建造：地点/产业变化时重置资源选择（默认贪心最近）。
  const buildDraftKey = draft.mode === "build" ? `${draft.cardId}|${draft.location}|${draft.industry}|${draft.overbuildTileId}` : "";
  const [lastBuildKey, setLastBuildKey] = useState("");
  useEffect(() => {
    if (draft.mode !== "build" || !buildInfo?.spot) return;
    if (buildDraftKey === lastBuildKey) return;
    setLastBuildKey(buildDraftKey);
    const spot = buildInfo.spot;
    const coal = spot.costCoal > 0 ? greedyCoal(state, [spot.location], spot.costCoal) : [];
    const iron = spot.costIron > 0 ? greedyIron(state, spot.costIron) : [];
    setDraft((d) => (d.mode === "build" ? { ...d, coalSources: coal, ironSources: iron } : d));
  }, [draft, buildInfo, buildDraftKey, lastBuildKey, state]);

  const highlightedLocations = useMemo(() => {
    const set = new Set<string>();
    if (draft.mode === "build" && buildInfo) {
      for (const spot of buildInfo.info.spots) set.add(spot.location);
    }
    if (draft.mode === "sell" && myPlayer !== null) {
      // 卖货模式：高亮所有可出售瓦片所在地点
      for (const t of sellTargets(state, myPlayer)) set.add(t.location);
    }
    return set;
  }, [draft, buildInfo, state, myPlayer]);

  const highlightedLinks = useMemo(() => {
    const set = new Set<number>();
    if (draft.mode === "network") {
      const net = networkOptions(state, myPlayer ?? 0);
      for (const opt of net.options) set.add(opt.linkIndex);
    }
    return set;
  }, [draft, state, myPlayer]);

  // ----------------------------------------------------------------
  // 各动作提交按钮可用性
  // ----------------------------------------------------------------
  function buildCommand(): BrassCommand | null {
    if (draft.mode === "build" && draft.location && buildInfo?.spot) {
      const spot = buildInfo.spot;
      return {
        type: "build",
        player: myPlayer ?? 0,
        cardId: draft.cardId,
        expectedVersion: state.stateVersion,
        industry: spot.industry,
        location: draft.location,
        slotIndex: draft.slotIndex ?? spot.emptySlots[0] ?? 0,
        overbuildTileId: (draft.mode === "build" ? effectiveOverbuildId : null) ?? undefined,
        coalSources: draft.coalSources,
        ironSources: draft.ironSources,
      };
    }
    if (draft.mode === "network") {
      const isRail = state.era === "rail";
      return {
        type: "network",
        player: myPlayer ?? 0,
        cardId: draft.cardId,
        expectedVersion: state.stateVersion,
        links: draft.linkIndexes.map((linkIndex, i) => ({ linkIndex, coalSources: draft.coalSources[i] ?? [] })),
        beerSource: draft.beerSource ?? undefined,
      };
    }
    if (draft.mode === "develop") {
      return {
        type: "develop",
        player: myPlayer ?? 0,
        cardId: draft.cardId,
        expectedVersion: state.stateVersion,
        industries: draft.industries,
        ironSources: draft.ironSources,
      };
    }
    if (draft.mode === "sell") {
      return {
        type: "sell",
        player: myPlayer ?? 0,
        cardId: draft.cardId,
        expectedVersion: state.stateVersion,
        sales: draft.sales.map((s) => ({
          tileId: s.tileId,
          merchantSlotId: s.merchantSlotId,
          beerSources: s.beerSources,
          developIndustry: s.developIndustry,
        })),
      };
    }
    if (draft.mode === "loan") {
      return { type: "loan", player: myPlayer ?? 0, cardId: draft.cardId, expectedVersion: state.stateVersion };
    }
    if (draft.mode === "scout") {
      return { type: "scout", player: myPlayer ?? 0, cardIds: draft.cardIds, expectedVersion: state.stateVersion };
    }
    return null;
  }

  const canSubmitBuild =
    draft.mode === "build" &&
    Boolean(draft.location && buildInfo?.spot) &&
    (buildInfo?.spot?.costCoal ?? 0) === draft.coalSources.length &&
    (buildInfo?.spot?.costIron ?? 0) === draft.ironSources.length;
  const canSubmitNetwork =
    draft.mode === "network" &&
    (state.era === "canal" ? draft.linkIndexes.length === 1 : draft.linkIndexes.length >= 1 && draft.linkIndexes.length <= 2) &&
    (state.era === "canal" || draft.linkIndexes.every((_, i) => (draft.coalSources[i]?.length ?? 0) === 1)) &&
    (state.era === "canal" || draft.linkIndexes.length !== 2 || draft.beerSource !== null);
  const canSubmitDevelop = draft.mode === "develop" && draft.industries.length >= 1 && draft.ironSources.length === draft.industries.length;
  // 消耗 develop 奖励商人（Gloucester）啤酒的出售必须声明免费研发目标。
  const canSubmitSell =
    draft.mode === "sell" &&
    draft.sales.length >= 1 &&
    draft.sales.every((s) => {
      if (!s.beerSources.some((b) => b.kind === "merchant")) return true;
      const loc = state.merchantTiles.find((m) => m.slotId === s.merchantSlotId)?.location ?? "";
      if (MERCHANTS[loc]?.bonus.type !== "develop") return true;
      const stack = s.developIndustry ? state.players[myPlayer ?? 0]?.mat[s.developIndustry] : undefined;
      return Boolean(stack && stack.length > 0);
    });

  // ----------------------------------------------------------------
  // 渲染
  // ----------------------------------------------------------------
  const deadlineLeft = turnDeadline ? Math.max(0, Math.ceil((turnDeadline.deadlineAt - now) / 1000)) : null;
  const shortfall = state.phase === "await_shortfall_removal" ? state.shortfall : null;

  return (
    <div className="brass-table">
      <header className="brass-topbar">
        <div className="brass-topbar-title">
          <span className="brass-topbar-badge">工业革命 · 伯明翰</span>
          <span className="brass-era-pill">{state.era === "canal" ? "运河时代" : "铁路时代"}</span>
          <span className="brass-round">第 {state.round} 回合</span>
          <span className="brass-actions-left">剩余行动 {state.actionsLeft}</span>
          {shortfall ? <span className="brass-era-pill" style={{ background: "#7a3b2e" }}>缺额拆板</span> : null}
          {deadlineLeft !== null ? (
            <span className={`brass-deadline ${deadlineLeft <= 10 ? "urgent" : ""}`}>
              {turnDeadline?.seatId === view.seatId ? "你的倒计时 " : `${turnDeadline?.seatId} 号 `}
              {Math.floor(deadlineLeft / 60)}:{String(deadlineLeft % 60).padStart(2, "0")}
            </span>
          ) : null}
          {isMyTurn ? <span className="brass-your-turn">轮到你了</span> : null}
          {autoDecision ? <span className="brass-auto-note">已自动代打</span> : null}
        </div>
        <div className="brass-topbar-right">
          <span className="brass-room-code">房间 {roomCode}</span>
          <RulesModal />
          <button type="button" className="brass-ghost-btn" onClick={() => setShowLog((v) => !v)}>
            {showLog ? "收起日志" : "查看日志"}
          </button>
          <a className="brass-ghost-btn" href="/brass">
            离开桌面
          </a>
        </div>
      </header>

      <div className="brass-main">
        <section className="brass-board-wrap">
          <BoardMap
            state={state}
            myPlayer={myPlayer}
            highlightedLocations={highlightedLocations}
            highlightedLinks={highlightedLinks}
            selectedLocation={draft.mode === "build" ? draft.location : null}
            selectedLinkIndex={draft.mode === "network" ? (draft.linkIndexes[draft.linkIndexes.length - 1] ?? null) : null}
            previewSlot={
              draft.mode === "build" && draft.location && buildInfo?.spot
                ? {
                    location: draft.location,
                    slotIndex: overbuildSlotIndex(state, buildInfo.spot, effectiveOverbuildId),
                    industry: buildInfo.spot.industry,
                    level: buildInfo.spot.tileLevel,
                  }
                : null
            }
            onLocationClick={(loc) => {
              if (draft.mode === "build") patchDraft({ location: loc, industry: null, slotIndex: null, overbuildTileId: null });
            }}
            onLinkClick={(linkIndex) => {
              if (draft.mode !== "network") return;
              const max = state.era === "canal" ? 1 : 2;
              setDraft((d) => {
                if (d.mode !== "network") return d;
                if (d.linkIndexes.includes(linkIndex)) return d;
                if (d.linkIndexes.length >= max) return d;
                const linkIndexes = [...d.linkIndexes, linkIndex];
                const coalSources = [...d.coalSources];
                if (state.era === "rail") {
                  coalSources[linkIndexes.length - 1] = greedyCoal(state, linkEndpoints(LINKS[linkIndex]), 1);
                }
                return { ...d, linkIndexes, coalSources };
              });
            }}
          />
          {state.status === "finished" ? (
            <div className="brass-gameover">
              <h2>对局结束</h2>
              <ol>
                {(state.finalScores ?? []).map((s) => (
                  <li key={s.player}>
                    <span className="brass-final-rank">{s.player + 1} 号</span>
                    {s.vp} 分
                    <span className="brass-final-sub">
                      （收入 {s.income} · £{s.money}）
                    </span>
                    {s.player === state.winner ? <b> 胜</b> : null}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </section>

        <aside className="brass-side">
          <PlayersPanel state={state} myPlayer={myPlayer} othersHandCount={view.othersHandCount} displayNames={view.displayNames} absences={absences} />
          <div className="brass-panel brass-markets">
            <h3>市场</h3>
            <div className="brass-market-row">
              <span className="brass-market-name">煤</span>
              <MarketBar
                count={state.coalMarket}
                capacity={COAL_MARKET_CAPACITY}
                prices={COAL_MARKET_PRICES}
                floor={COAL_FLOOR_PRICE}
                kind="coal"
              />
            </div>
            <div className="brass-market-row">
              <span className="brass-market-name">铁</span>
              <MarketBar
                count={state.ironMarket}
                capacity={IRON_MARKET_CAPACITY}
                prices={IRON_MARKET_PRICES}
                floor={IRON_FLOOR_PRICE}
                kind="iron"
              />
            </div>
            <div className="brass-market-hint">买煤需连通商人位；市场空：煤£8 / 铁£6</div>
          </div>
          {showLog ? <LogPanel state={state} myPlayer={myPlayer} /> : null}
        </aside>
      </div>

      {/* 行动区 */}
      <footer className="brass-actionbar">
        {shortfall ? (
          <ShortfallPanel
            state={state}
            myPlayer={myPlayer}
            submitting={submitting}
            onRemove={(tileId) =>
              submit({ type: "shortfall_removal", player: myPlayer ?? 0, tileId, expectedVersion: state.stateVersion })
            }
          />
        ) : (
        <>
        <div className="brass-hand">
          {hand.map((cardId) => {
            const isSelected =
              (draft.mode !== "idle" && "cardId" in draft && draft.cardId === cardId) ||
              (draft.mode === "scout" && draft.cardIds.includes(cardId));
            const isWild = cardId === "wild-location" || cardId === "wild-industry";
            const base = cardId.slice(0, cardId.lastIndexOf("#") >= 0 ? cardId.lastIndexOf("#") : undefined);
            const isLoc = !isWild && base.startsWith("loc-");
            const inds = Array.from(new Set(cardIndustries(cardId) ?? []));
            const band = isWild
              ? "linear-gradient(90deg, #caa64a, #8a6f2c)"
              : isLoc
                ? "linear-gradient(90deg, #6b5a41, #4a3d2c)"
                : INDUSTRY_CHIP[inds[0]]
                  ? `linear-gradient(90deg, ${INDUSTRY_CHIP[inds[0]].color}, ${INDUSTRY_CHIP[inds[0]].color}99)`
                  : undefined;
            const slotCount = isLoc ? (LOCATIONS[base.slice(4)]?.slots.length ?? 0) : 0;
            return (
              <button
                key={cardId}
                type="button"
                className={`brass-card ${isSelected ? "selected" : ""}`}
                title={cardLabel(cardId)}
                onClick={() => {
                  if (draft.mode === "scout") {
                    setDraft((d) => {
                      if (d.mode !== "scout") return d;
                      const has = d.cardIds.includes(cardId);
                      const cardIds = has ? d.cardIds.filter((c) => c !== cardId) : [...d.cardIds, cardId].slice(0, 3);
                      return { ...d, cardIds };
                    });
                  } else if (draft.mode === "build") {
                    // 切换建造卡后旧地点/产业多半不再合法：换卡时重置建造目标。
                    setDraft(
                      draft.cardId === cardId
                        ? { ...draft, cardId }
                        : { mode: "build", cardId, location: null, industry: null, slotIndex: null, overbuildTileId: null, coalSources: [], ironSources: [] },
                    );
                  } else if (draft.mode !== "idle") {
                    setDraft({ ...draft, cardId });
                  } else {
                    setDraft({ mode: "build", cardId, location: null, industry: null, slotIndex: null, overbuildTileId: null, coalSources: [], ironSources: [] });
                  }
                }}
                disabled={!isMyTurn}
              >
                <span className="brass-card-band" style={band ? { background: band } : undefined} />
                <span className="brass-card-kind">{cardKindLabel(cardId)}{isLoc && slotCount ? ` · ${slotCount} 槽` : ""}</span>
                <span className="brass-card-title">{cardTitle(cardId)}</span>
                <span className="brass-card-chips">
                  {isWild ? (
                    <i className="chip wild">✦</i>
                  ) : (
                    inds.map((ind) => (
                      <i key={ind} className="chip" style={{ background: INDUSTRY_CHIP[ind].color, color: INDUSTRY_CHIP[ind].ink }}>
                        {INDUSTRY_SHORT[ind]}
                      </i>
                    ))
                  )}
                </span>
              </button>
            );
          })}
          {view.spectator ? <span className="brass-spectating">观战模式</span> : null}
        </div>

        <div className="brass-actions">
          <button type="button" className="brass-act" disabled={!isMyTurn || submitting} onClick={() => startAction("build")} data-active={draft.mode === "build"}>
            建造
          </button>
          <button type="button" className="brass-act" disabled={!isMyTurn || submitting} onClick={() => startAction("network")} data-active={draft.mode === "network"}>
            铺路
          </button>
          <button type="button" className="brass-act" disabled={!isMyTurn || submitting} onClick={() => startAction("develop")} data-active={draft.mode === "develop"}>
            研发
          </button>
          <button type="button" className="brass-act" disabled={!isMyTurn || submitting} onClick={() => startAction("sell")} data-active={draft.mode === "sell"}>
            卖货
          </button>
          <button type="button" className="brass-act" disabled={!isMyTurn || submitting} onClick={() => startAction("loan")} data-active={draft.mode === "loan"}>
            贷款
          </button>
          <button type="button" className="brass-act" disabled={!isMyTurn || submitting || !canScout(state, myPlayer ?? 0)} onClick={() => startAction("scout")} data-active={draft.mode === "scout"}>
            侦察
          </button>
          <button
            type="button"
            className="brass-act brass-act-pass"
            disabled={!isMyTurn || submitting}
            onClick={() => submit({ type: "pass", player: myPlayer ?? 0, cardId: hand[0] ?? "", expectedVersion: state.stateVersion })}
          >
            跳过
          </button>
        </div>

        {/* 草稿详情 */}
        {draft.mode === "build" ? (
          <BuildDraft
            draft={draft}
            state={state}
            myPlayer={myPlayer ?? 0}
            spot={buildInfo?.spot ?? null}
            spots={buildInfo?.info.spots ?? []}
            effectiveOverbuildId={effectiveOverbuildId}
            coalCandidates={buildCoalCandidates}
            ironCandidates={buildIronCandidates}
            onPatch={patchDraft}
            onSubmit={() => {
              const command = buildCommand();
              if (command) void submit(command);
            }}
            canSubmit={canSubmitBuild}
            submitting={submitting}
          />
        ) : null}
        {draft.mode === "network" ? (
          <NetworkDraft
            draft={draft}
            state={state}
            myPlayer={myPlayer ?? 0}
            onPatch={(partial) => setDraft((d) => (d.mode === "network" ? { ...d, ...partial } : d))}
            onSubmit={() => {
              const command = buildCommand();
              if (command) void submit(command);
            }}
            canSubmit={canSubmitNetwork}
            submitting={submitting}
          />
        ) : null}
        {draft.mode === "develop" ? (
          <DevelopDraft
            draft={draft}
            state={state}
            myPlayer={myPlayer ?? 0}
            onPatch={(partial) => setDraft((d) => (d.mode === "develop" ? { ...d, ...partial } : d))}
            onSubmit={() => {
              const command = buildCommand();
              if (command) void submit(command);
            }}
            canSubmit={canSubmitDevelop}
            submitting={submitting}
          />
        ) : null}
        {draft.mode === "sell" ? (
          <SellDraft
            draft={draft}
            state={state}
            myPlayer={myPlayer ?? 0}
            onPatch={(partial) => setDraft((d) => (d.mode === "sell" ? { ...d, ...partial } : d))}
            onSubmit={() => {
              const command = buildCommand();
              if (command) void submit(command);
            }}
            canSubmit={canSubmitSell}
            submitting={submitting}
          />
        ) : null}
        {draft.mode === "loan" ? (
          <div className="brass-draft">
            <span>
              贷款 £30，收入等级降至 {loanPreview(state, myPlayer ?? 0).newLevel}。弃置「{cardLabel(draft.cardId)}」。
            </span>
            <button
              type="button"
              className="brass-primary-btn"
              disabled={submitting}
              onClick={() => submit({ type: "loan", player: myPlayer ?? 0, cardId: draft.cardId, expectedVersion: state.stateVersion })}
            >
              确认贷款
            </button>
          </div>
        ) : null}
        {draft.mode === "scout" ? (
          <div className="brass-draft">
            <span>弃置 3 张手牌换取 万能地点 + 万能产业：已选 {draft.cardIds.length}/3（在手牌上点击选择）</span>
            <button
              type="button"
              className="brass-primary-btn"
              disabled={submitting || draft.cardIds.length !== 3}
              onClick={() => submit({ type: "scout", player: myPlayer ?? 0, cardIds: draft.cardIds, expectedVersion: state.stateVersion })}
            >
              确认侦察
            </button>
          </div>
        ) : null}
        </>
        )}
      </footer>
    </div>
  );
}

/** 缺额拆板：仅缺额玩家可操作（拆板块得半价，直至补足；无板块则扣 VP 结算）。 */
function ShortfallPanel({
  state,
  myPlayer,
  submitting,
  onRemove,
}: {
  state: BrassState;
  myPlayer: number | null;
  submitting: boolean;
  onRemove: (tileId: string) => void;
}) {
  const sf = state.shortfall;
  if (!sf) return null;
  const mine = sf.player === myPlayer;
  const tiles = state.placedTiles.filter((t) => t.player === sf.player);
  return (
    <div className="brass-draft">
      {mine ? (
        <>
          <span className="brass-draft-warn">
            收入缺额 £{sf.amount}：点击拆除一块场上板块换取半价，直到足以补足缺额
          </span>
          <div className="brass-sell-targets">
            {tiles.map((t) => (
              <button key={t.id} type="button" className="brass-mat-btn" disabled={submitting} onClick={() => onRemove(t.id)}>
                {INDUSTRY_LABEL[t.industry]} {roman(t.level)} @ {locationLabel(t.location)} · 拆得 £
                {Math.floor(tileSpec(t.industry, t.level).costMoney / 2)}
              </button>
            ))}
          </div>
          {tiles.length === 0 ? <span className="brass-draft-hint">已无板块可拆，将按 VP 扣减结算</span> : null}
        </>
      ) : (
        <span className="brass-draft-hint">
          {sf.player + 1} 号玩家无法支付收入缺额 £{sf.amount}，正在拆除板块抵债…请稍候
        </span>
      )}
    </div>
  );
}

function greedyCoal(state: BrassState, atNodes: string[], n: number): CoalSource[] {
  const cands = coalCandidates(state, atNodes);
  const sources: CoalSource[] = [];
  const avail = new Map<string, number>();
  const mines = cands.filter((c): c is Extract<import("@coup/brass-domain").CoalCandidate, { kind: "mine" }> => c.kind === "mine").sort((a, b) => a.distance - b.distance);
  const market = cands.find((c): c is Extract<import("@coup/brass-domain").CoalCandidate, { kind: "market" }> => c.kind === "market");
  for (let i = 0; i < n; i++) {
    let assigned = false;
    for (const m of mines) {
      const a = avail.get(m.tileId!) ?? m.available;
      if (a > 0) {
        avail.set(m.tileId!, a - 1);
        sources.push({ kind: "mine", tileId: m.tileId as string });
        assigned = true;
        break;
      }
    }
    if (!assigned && market) sources.push({ kind: "market" });
    if (!assigned) return [];
  }
  return sources;
}

function greedyIron(state: BrassState, n: number): IronSource[] {
  const cands = ironCandidates(state);
  const sources: IronSource[] = [];
  const avail = new Map<string, number>();
  const works = cands.filter((c): c is Extract<import("@coup/brass-domain").IronCandidate, { kind: "works" }> => c.kind === "works");
  const market = cands.find((c): c is Extract<import("@coup/brass-domain").IronCandidate, { kind: "market" }> => c.kind === "market");
  for (let i = 0; i < n; i++) {
    let assigned = false;
    for (const w of works) {
      const a = avail.get(w.tileId!) ?? w.available;
      if (a > 0) {
        avail.set(w.tileId!, a - 1);
        sources.push({ kind: "works", tileId: w.tileId as string });
        assigned = true;
        break;
      }
    }
    if (!assigned && market) sources.push({ kind: "market" });
    if (!assigned) return [];
  }
  return sources;
}

function greedyBeer(state: BrassState, player: number, n: number, opts: { soldTileLocation?: string; merchantSlotId?: string; secondLinkEndpoints?: string[] }): BeerSource[] {
  const cands = beerCandidates(state, player, n, opts);
  const sources: BeerSource[] = [];
  const avail = new Map<string, number>();
  const own = cands.filter((c): c is Extract<import("@coup/brass-domain").BeerCandidate, { kind: "brewery" }> => c.kind === "brewery" && c.owner === player);
  const opp = cands.filter((c): c is Extract<import("@coup/brass-domain").BeerCandidate, { kind: "brewery" }> => c.kind === "brewery" && c.owner !== player);
  const merchant = cands.find((c): c is Extract<import("@coup/brass-domain").BeerCandidate, { kind: "merchant" }> => c.kind === "merchant");
  for (let i = 0; i < n; i++) {
    let assigned = false;
    for (const pool of [own, opp]) {
      for (const b of pool) {
        const a = avail.get(b.tileId!) ?? b.available;
        if (a > 0) {
          avail.set(b.tileId!, a - 1);
          sources.push({ kind: "brewery", tileId: b.tileId as string });
          assigned = true;
          break;
        }
      }
      if (assigned) break;
    }
    if (!assigned && merchant) {
      sources.push({ kind: "merchant", merchantSlotId: merchant.merchantSlotId as string });
      assigned = true;
    }
    if (!assigned) return [];
  }
  return sources;
}

function MarketBar({
  count,
  capacity,
  prices,
  floor,
  kind,
}: {
  count: number;
  capacity: number;
  prices: readonly number[];
  floor: number;
  kind: "coal" | "iron";
}) {
  const buyPrice = buyPriceAt(prices, capacity, count, 0, floor);
  const sellPrice = count < capacity ? prices[capacity - 1 - count] : null;
  return (
    <span className="brass-market-wrap">
      <span className="brass-market-bar">
        {Array.from({ length: capacity }, (_, i) => {
          const occupied = i >= capacity - count;
          const price = prices[i];
          return (
            <span key={i} className={`brass-market-slot ${occupied ? "filled" : ""}`} title={`£${price}`}>
              {occupied ? <span className={`brass-market-cube brass-market-cube--${kind}`} /> : <span className="brass-market-price">£{price}</span>}
            </span>
          );
        })}
      </span>
      <span className="brass-market-quote">
        <b>买 £{buyPrice}</b>
        <i>卖 {sellPrice === null ? "无空位" : `£${sellPrice}`}</i>
      </span>
    </span>
  );
}

function PlayersPanel({
  state,
  myPlayer,
  othersHandCount,
  displayNames,
  absences,
}: {
  state: BrassState;
  myPlayer: number | null;
  othersHandCount: Record<number, number>;
  displayNames: Record<string, string>;
  absences: BrassSeatAbsence[];
}) {
  return (
    <div className="brass-panel brass-players">
      <h3>玩家</h3>
      {state.players.map((p, i) => {
        const seatId = String(i + 1);
        const absence = absences.find((a) => a.seatId === seatId);
        const name = displayNames[seatId] ?? `${i + 1} 号`;
        const isTurn = state.status === "in_progress" && state.currentPlayer === i;
        const handCount = i === myPlayer ? state.players[i].hand.length : (othersHandCount[i] ?? 0);
        return (
          <div key={i} className={`brass-player-row ${isTurn ? "turn" : ""} ${absence && absence.phase !== "present" ? "absent" : ""}`}>
            <span className="brass-player-dot" style={{ background: playerColor(i) }} />
            <span className="brass-player-name">
              {i === myPlayer && name.includes("你") ? name : `${name}${i === myPlayer ? "（你）" : ""}`}
              {isTurn ? " ▸" : ""}
              {absence && absence.phase !== "present" ? " ⚠离席" : ""}
            </span>
            <span className="brass-player-stats">
              <span className="stat">
                <i>资金</i>
                <b>£{p.money}</b>
              </span>
              <span className="stat">
                <i>收入</i>
                <b>{incomeLevelAt(p.incomeSpace)}</b>
              </span>
              <span className="stat">
                <i>分数</i>
                <b>{p.vp}</b>
              </span>
              <span className="stat">
                <i>连线</i>
                <b>{state.linksLeft[i]}</b>
              </span>
              <span className="stat">
                <i>手牌</i>
                <b>{handCount}</b>
              </span>
            </span>
            <MatSummary mat={p.mat} />
          </div>
        );
      })}
    </div>
  );
}

function MatSummary({ mat }: { mat: Record<IndustryType, number[]> }) {
  return (
    <span className="brass-mat">
      {(Object.keys(mat) as IndustryType[]).map((ind) => {
        const stack = mat[ind];
        if (!stack || stack.length === 0) return null;
        return (
          <span key={ind} className="brass-mat-chip" title={`${INDUSTRY_LABEL[ind]}：剩 ${stack.length} 块（最低 ${roman(Math.min(...stack))} 级）`}>
            <i className="mat-char" style={{ background: INDUSTRY_CHIP[ind].color, color: INDUSTRY_CHIP[ind].ink }}>
              {INDUSTRY_SHORT[ind]}
            </i>
            {stack.length}
          </span>
        );
      })}
    </span>
  );
}

function LogPanel({ state, myPlayer }: { state: BrassState; myPlayer: number | null }) {
  const listRef = useRef<HTMLDivElement>(null);
  const entries = state.log.slice(-60);
  const lastSeq = entries.length > 0 ? entries[entries.length - 1].seq : 0;
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastSeq]);
  return (
    <div className="brass-panel brass-log">
      <h3>对局日志</h3>
      <div className="brass-log-list" ref={listRef}>
        {entries.map((entry) => (
          <div key={entry.seq} className={`brass-log-entry ${entry.player === myPlayer ? "self" : ""}`}>
            <span
              className="brass-log-dot"
              style={{ background: entry.player !== undefined ? playerColor(entry.player) : "#9a8c6d" }}
            />
            <span>{logText(entry, myPlayer)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function overbuildSlotIndex(
  state: BrassState,
  spot: { emptySlots: number[]; overbuildTileIds: string[] },
  overbuildTileId: string | null,
): number {
  if (overbuildTileId) {
    const tile = state.placedTiles.find((t) => t.id === overbuildTileId);
    if (tile) return tile.slotIndex;
  }
  return spot.emptySlots[0] ?? 0;
}

function BuildDraft({
  draft,
  state,
  myPlayer,
  spot,
  spots,
  effectiveOverbuildId,
  coalCandidates: coalCands,
  ironCandidates: ironCands,
  onPatch,
  onSubmit,
  canSubmit,
  submitting,
}: {
  draft: Extract<Draft, { mode: "build" }>;
  state: BrassState;
  myPlayer: number;
  spot: ReturnType<typeof buildOptionsForCard>["spots"][number] | null;
  spots: ReturnType<typeof buildOptionsForCard>["spots"];
  effectiveOverbuildId: string | null;
  coalCandidates: ReturnType<typeof coalCandidates>;
  ironCandidates: ReturnType<typeof ironCandidates>;
  onPatch: (partial: Partial<Extract<Draft, { mode: "build" }>>) => void;
  onSubmit: () => void;
  canSubmit: boolean;
  submitting: boolean;
}) {
  const industries = Array.from(new Set(spots.filter((s) => s.location === draft.location).map((s) => s.industry)));
  const overbuildLabel = (tileId: string): string => {
    const t = state.placedTiles.find((x) => x.id === tileId);
    if (!t) return tileId;
    return `${t.player === myPlayer ? "自己的" : "对手的"} ${INDUSTRY_LABEL[t.industry]} ${roman(t.level)}`;
  };
  return (
    <div className="brass-draft">
      <span className="brass-draft-step">1. 点击地图上的高亮地点</span>
      {draft.location ? (
        <>
          {industries.length > 1 ? (
            <label className="brass-inline">
              产业
              <select
                value={spot?.industry ?? ""}
                onChange={(e) => onPatch({ industry: e.target.value as IndustryType, slotIndex: null, overbuildTileId: null })}
              >
                {industries.map((ind) => (
                  <option key={ind} value={ind}>
                    {INDUSTRY_LABEL[ind]}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {spot ? (
            <>
              <span className="brass-draft-detail">
                {INDUSTRY_LABEL[spot.industry]} {roman(spot.tileLevel)} · £{spot.costMoney}
                {spot.costCoal > 0 ? ` + ${spot.costCoal}煤` : ""}
                {spot.costIron > 0 ? ` + ${spot.costIron}铁` : ""}
                {spot.overbuildTileIds.length > 0 && spot.emptySlots.length === 0 ? " · 覆盖" : ""}
              </span>
              {spot.overbuildTileIds.length > 0 ? (
                spot.emptySlots.length === 0 ? (
                  <label className="brass-inline">
                    覆盖目标
                    <select value={effectiveOverbuildId ?? ""} onChange={(e) => onPatch({ overbuildTileId: e.target.value })}>
                      {spot.overbuildTileIds.map((tileId) => (
                        <option key={tileId} value={tileId}>
                          {overbuildLabel(tileId)}
                        </option>
                      ))}
                    </select>
                    <span className="brass-draft-detail">无空槽，将覆盖所选瓦片</span>
                  </label>
                ) : (
                  <label className="brass-inline">
                    <input
                      type="checkbox"
                      checked={Boolean(effectiveOverbuildId)}
                      onChange={(e) => onPatch({ overbuildTileId: e.target.checked ? spot.overbuildTileIds[0] : null })}
                    />
                    覆盖 {overbuildLabel(spot.overbuildTileIds[0])}
                  </label>
                )
              ) : null}
              {spot.costCoal > 0 ? (
                coalCands.length > 1 ? (
                  <CoalPicker
                    count={spot.costCoal}
                    candidates={coalCands}
                    sources={draft.coalSources}
                    state={state}
                    onChange={(sources) => onPatch({ coalSources: sources })}
                  />
                ) : coalCands.length === 1 ? (
                  <span className="brass-draft-detail">
                    {coalCands[0].kind === "mine"
                      ? coalLabel(state, { kind: "mine", tileId: coalCands[0].tileId })
                      : coalLabel(state, { kind: "market" })}
                  </span>
                ) : (
                  <span className="brass-draft-warn">无可用煤源：需连通未翻面煤矿，或连通商人位从市场购买</span>
                )
              ) : null}
              {spot.costIron > 0 ? (
                ironCands.length > 1 ? (
                  <IronPicker count={spot.costIron} candidates={ironCands} sources={draft.ironSources} state={state} onChange={(sources) => onPatch({ ironSources: sources })} />
                ) : ironCands.length === 1 ? (
                  <span className="brass-draft-detail">
                    {ironCands[0].kind === "works"
                      ? ironLabel(state, { kind: "works", tileId: ironCands[0].tileId })
                      : ironLabel(state, { kind: "market" })}
                  </span>
                ) : (
                  <span className="brass-draft-warn">无可用铁源（场上有未翻面铁厂时必须用铁厂）</span>
                )
              ) : null}
              <button type="button" className="brass-primary-btn" disabled={!canSubmit || submitting} onClick={onSubmit}>
                确认建造
              </button>
            </>
          ) : (
            <span className="brass-draft-hint">该地点无可建产业</span>
          )}
        </>
      ) : null}
      <button type="button" className="brass-ghost-btn" onClick={() => onPatch({ location: null, industry: null })}>
        重选
      </button>
    </div>
  );
}

function CoalPicker({
  count,
  candidates,
  sources,
  state,
  onChange,
}: {
  count: number;
  candidates: ReturnType<typeof coalCandidates>;
  sources: CoalSource[];
  state: BrassState;
  onChange: (sources: CoalSource[]) => void;
}) {
  return (
    <span className="brass-inline">
      {Array.from({ length: count }, (_, i) => {
        const current = sources[i] ?? { kind: "market" as const };
        return (
          <select
            key={i}
            value={current.kind === "mine" ? current.tileId : "market"}
            onChange={(e) => {
              const next = sources.slice();
              const v = e.target.value;
              next[i] = v === "market" ? { kind: "market" } : { kind: "mine", tileId: v };
              onChange(next);
            }}
          >
            {candidates.map((c) => (
              <option key={c.kind === "mine" ? c.tileId : "market"} value={c.kind === "mine" ? c.tileId : "market"}>
                {coalLabel(state, c.kind === "mine" ? { kind: "mine", tileId: c.tileId } : { kind: "market" })}
                {c.kind === "mine" ? ` · ${c.available}块` : ""}
              </option>
            ))}
          </select>
        );
      })}
    </span>
  );
}

function IronPicker({
  count,
  candidates,
  sources,
  state,
  onChange,
}: {
  count: number;
  candidates: ReturnType<typeof ironCandidates>;
  sources: IronSource[];
  state: BrassState;
  onChange: (sources: IronSource[]) => void;
}) {
  return (
    <span className="brass-inline">
      {Array.from({ length: count }, (_, i) => {
        const current = sources[i] ?? { kind: "market" as const };
        return (
          <select
            key={i}
            value={current.kind === "works" ? current.tileId : "market"}
            onChange={(e) => {
              const next = sources.slice();
              const v = e.target.value;
              next[i] = v === "market" ? { kind: "market" } : { kind: "works", tileId: v };
              onChange(next);
            }}
          >
            {candidates.map((c) => (
              <option key={c.kind === "works" ? c.tileId : "market"} value={c.kind === "works" ? c.tileId : "market"}>
                {ironLabel(state, c.kind === "works" ? { kind: "works", tileId: c.tileId } : { kind: "market" })}
                {c.kind === "works" ? ` · ${c.available}块` : ""}
              </option>
            ))}
          </select>
        );
      })}
    </span>
  );
}

function NetworkDraft({
  draft,
  state,
  myPlayer,
  onPatch,
  onSubmit,
  canSubmit,
  submitting,
}: {
  draft: Extract<Draft, { mode: "network" }>;
  state: BrassState;
  myPlayer: number;
  onPatch: (partial: Partial<Extract<Draft, { mode: "network" }>>) => void;
  onSubmit: () => void;
  canSubmit: boolean;
  submitting: boolean;
}) {
  const isRail = state.era === "rail";
  const beerOpts = (isRail && draft.linkIndexes.length === 2 ? beerCandidates(state, myPlayer, 1, { secondLinkEndpoints: linkEndpoints(LINKS[draft.linkIndexes[1] ?? 0]) }) : []) as import("@coup/brass-domain").BeerCandidate[];
  return (
    <div className="brass-draft">
      <span className="brass-draft-step">
        {isRail ? "点击地图上的铁路线（可两条 £15+1啤酒）" : "点击地图上的运河线（£3）"}
      </span>
      {draft.linkIndexes.map((linkIndex, i) => (
        <span key={linkIndex} className="brass-draft-detail">
          {linkLabel(linkIndex)}
          {isRail ? (
            <select
              value={draft.coalSources[i]?.[0]?.kind === "mine" ? (draft.coalSources[i]?.[0] as { tileId: string }).tileId : "market"}
              onChange={(e) => {
                const v = e.target.value;
                onPatch({
                  coalSources: draft.coalSources.map((s, si) =>
                    si === i ? [v === "market" ? { kind: "market" } : { kind: "mine", tileId: v }] : s,
                  ),
                });
              }}
            >
              {coalCandidates(state, linkEndpoints(LINKS[linkIndex])).map((c) => (
                <option key={c.kind === "mine" ? c.tileId : "market"} value={c.kind === "mine" ? c.tileId : "market"}>
                  {c.kind === "mine" ? `${locationLabel(NODE_LOC(c.tileId, state))} 煤矿（免费）` : "煤市场（£按格价/£8）"}
                </option>
              ))}
            </select>
          ) : null}
          <button type="button" className="brass-ghost-btn" onClick={() => onPatch({ linkIndexes: draft.linkIndexes.filter((x) => x !== linkIndex), coalSources: draft.coalSources.filter((_, si) => si !== i) })}>
            ✕
          </button>
        </span>
      ))}
      {isRail && draft.linkIndexes.length === 2 ? (
        <label className="brass-inline">
          啤酒
          <select
            value={draft.beerSource?.kind === "brewery" ? draft.beerSource.tileId : draft.beerSource?.kind === "merchant" ? draft.beerSource.merchantSlotId : ""}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "merchant") {
                const c = beerOpts.find((x) => x.kind === "merchant");
                if (c) onPatch({ beerSource: { kind: "merchant", merchantSlotId: c.merchantSlotId! } });
                return;
              }
              onPatch({ beerSource: { kind: "brewery", tileId: v } });
            }}
          >
            <option value="" disabled>
              选择啤酒来源
            </option>
            {beerOpts.map((c) => (
              <option key={c.kind === "brewery" ? c.tileId : c.merchantSlotId} value={c.kind === "brewery" ? c.tileId : c.merchantSlotId}>
                {c.kind === "brewery" ? `${locationLabel(NODE_LOC(c.tileId!, state))} 的酒厂${c.owner === myPlayer ? "（自己）" : "（对手，须连通第二条铁路）"}` : `商人啤酒：${locationLabel(NODE_MLOC(c.merchantSlotId!, state))}`}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <button type="button" className="brass-primary-btn" disabled={!canSubmit || submitting} onClick={onSubmit}>
        确认铺路（{state.era === "canal" ? "£3" : draft.linkIndexes.length === 2 ? "£15+1啤酒" : "£5+1煤"}）
      </button>
    </div>
  );
}

function NODE_LOC(tileId: string, state: BrassState): string {
  return state.placedTiles.find((t) => t.id === tileId)?.location ?? "";
}
function NODE_MLOC(slotId: string, state: BrassState): string {
  return state.merchantTiles.find((m) => m.slotId === slotId)?.location ?? "";
}

function DevelopDraft({
  draft,
  state,
  myPlayer,
  onPatch,
  onSubmit,
  canSubmit,
  submitting,
}: {
  draft: Extract<Draft, { mode: "develop" }>;
  state: BrassState;
  myPlayer: number;
  onPatch: (partial: Partial<Extract<Draft, { mode: "develop" }>>) => void;
  onSubmit: () => void;
  canSubmit: boolean;
  submitting: boolean;
}) {
  const mine = myMat(state, myPlayer);
  const ironCands = ironCandidates(state);
  return (
    <div className="brass-draft">
      <span className="brass-draft-step">选择要移除的面板产业（每块耗 1 铁；灯泡陶不可研发）</span>
      {(Object.keys(mine) as IndustryType[]).map((ind) => {
        const stack = mine[ind];
        if (!stack || stack.length === 0) return null;
        const lowest = Math.min(...stack);
        const isLightbulb = (ind === "pottery" && (lowest === 1 || lowest === 3));
        const chosen = draft.industries.includes(ind);
        return (
          <button
            key={ind}
            type="button"
            className={`brass-mat-btn ${chosen ? "selected" : ""}`}
            disabled={isLightbulb}
            onClick={() => {
              const industries = chosen ? draft.industries.filter((x) => x !== ind) : [...draft.industries, ind].slice(0, 2);
              onPatch({ industries, ironSources: greedyIron(state, industries.length) });
            }}
          >
            {INDUSTRY_LABEL[ind]} {roman(lowest)}
            {isLightbulb ? "（灯泡）" : ""}
          </button>
        );
      })}
      {draft.industries.length > 0 ? (
        <IronPicker count={draft.industries.length} candidates={ironCands} sources={draft.ironSources} state={state} onChange={(sources) => onPatch({ ironSources: sources })} />
      ) : null}
      <button type="button" className="brass-primary-btn" disabled={!canSubmit || submitting} onClick={onSubmit}>
        确认研发（{draft.industries.length} 块）
      </button>
    </div>
  );
}

function myMat(state: BrassState, player: number): Record<IndustryType, number[]> {
  return state.players[player]?.mat ?? ({} as Record<IndustryType, number[]>);
}

function SellDraft({
  draft,
  state,
  myPlayer,
  onPatch,
  onSubmit,
  canSubmit,
  submitting,
}: {
  draft: Extract<Draft, { mode: "sell" }>;
  state: BrassState;
  myPlayer: number;
  onPatch: (partial: Partial<Extract<Draft, { mode: "sell" }>>) => void;
  onSubmit: () => void;
  canSubmit: boolean;
  submitting: boolean;
}) {
  const targets = sellTargets(state, myPlayer);
  const soldTileIds = new Set(draft.sales.map((s) => s.tileId));
  const available = targets.filter((t) => !soldTileIds.has(t.tileId));
  const merchantLocation = (slotId: string): string => state.merchantTiles.find((m) => m.slotId === slotId)?.location ?? "";
  const isDevelopMerchant = (slotId: string): boolean => MERCHANTS[merchantLocation(slotId)]?.bonus.type === "develop";
  const developEligible = (): IndustryType[] =>
    (Object.keys(state.players[myPlayer]?.mat ?? {}) as IndustryType[]).filter((ind) => {
      const stack = state.players[myPlayer]?.mat[ind];
      if (!stack || stack.length === 0) return false;
      return !tileSpec(ind, Math.min(...stack)).lightbulb;
    });
  // 用到 develop 奖励商人（Gloucester）的啤酒时补齐/清除免费研发目标。
  const withDevelop = (sale: SaleDraft): SaleDraft => {
    const usesMerchantBeer = sale.beerSources.some((b) => b.kind === "merchant");
    if (!usesMerchantBeer || !isDevelopMerchant(sale.merchantSlotId)) return { ...sale, developIndustry: undefined };
    const eligible = developEligible();
    if (eligible.length === 0) return sale;
    return { ...sale, developIndustry: sale.developIndustry && eligible.includes(sale.developIndustry) ? sale.developIndustry : eligible[0] };
  };
  const beerAvailable = (t: (typeof targets)[number], slotId: string): boolean => {
    const cands = beerCandidates(state, myPlayer, t.beersToSell, { soldTileLocation: t.location, merchantSlotId: slotId });
    return cands.reduce((sum, c) => sum + c.available, 0) >= t.beersToSell;
  };
  return (
    <div className="brass-draft brass-sell-draft">
      <span className="brass-draft-step">选择要出售的瓦片（连通商人位 + 消耗啤酒；可多块）</span>
      <div className="brass-sell-targets">
        {available.map((t) => (
          <button
            key={t.tileId}
            type="button"
            className="brass-mat-btn"
            onClick={() => {
              const m = t.merchants[0];
              const beer = greedyBeer(state, myPlayer, t.beersToSell, { soldTileLocation: t.location, merchantSlotId: m.slotId });
              onPatch({
                sales: [...draft.sales, withDevelop({ tileId: t.tileId, merchantSlotId: m.slotId, beerSources: beer })],
              });
            }}
            disabled={t.beersToSell > 0 && !t.merchants.some((m) => beerAvailable(t, m.slotId))}
          >
            {INDUSTRY_LABEL[t.industry]} {roman(t.level)} @ {locationLabel(t.location)} · 需{t.beersToSell}啤酒 · 收入+{t.incomeOnFlip}
          </button>
        ))}
        {available.length === 0 ? <span className="brass-draft-hint">没有可出售的瓦片</span> : null}
      </div>
      {draft.sales.map((sale, si) => {
        const tile = state.placedTiles.find((t) => t.id === sale.tileId);
        const target = targets.find((t) => t.tileId === sale.tileId);
        return (
          <div key={`${sale.tileId}-${si}`} className="brass-sale-row">
            <span>
              {INDUSTRY_LABEL[tile?.industry as IndustryType]} {roman(tile?.level ?? 0)}
            </span>
            <select
              value={sale.merchantSlotId}
              onChange={(e) => {
                const merchantSlotId = e.target.value;
                const beer = greedyBeer(state, myPlayer, target?.beersToSell ?? 0, { soldTileLocation: tile?.location, merchantSlotId });
                onPatch({ sales: draft.sales.map((s, i) => (i === si ? withDevelop({ ...s, merchantSlotId, beerSources: beer }) : s)) });
              }}
            >
              {(target?.merchants ?? []).map((m) => (
                <option key={m.slotId} value={m.slotId}>
                  {locationLabel(m.location)}（{merchantBeerBonus(m.location)}{m.hasBeer ? " · 有啤酒" : ""}）
                </option>
              ))}
            </select>
            {sale.beerSources.map((src, bi) => (
              <BeerPicker
                key={bi}
                state={state}
                myPlayer={myPlayer}
                soldTileLocation={tile?.location}
                merchantSlotId={sale.merchantSlotId}
                value={src}
                onChange={(next) =>
                  onPatch({
                    sales: draft.sales.map((s, i) =>
                      i === si ? withDevelop({ ...s, beerSources: s.beerSources.map((x, xi) => (xi === bi ? next : x)) }) : s,
                    ),
                  })
                }
              />
            ))}
            {sale.beerSources.some((b) => b.kind === "merchant") && isDevelopMerchant(sale.merchantSlotId) ? (
              (() => {
                const eligible = developEligible();
                if (eligible.length === 0) {
                  return <span className="brass-draft-warn">Gloucester 商人啤酒须免费研发，但面板已无可研发板块</span>;
                }
                return (
                  <select
                    value={sale.developIndustry ?? eligible[0]}
                    onChange={(e) =>
                      onPatch({ sales: draft.sales.map((s, i) => (i === si ? { ...s, developIndustry: e.target.value as IndustryType } : s)) })
                    }
                  >
                    {eligible.map((ind) => {
                      const lowest = Math.min(...(state.players[myPlayer]?.mat[ind] ?? [0]));
                      return (
                        <option key={ind} value={ind}>
                          免费研发：{INDUSTRY_LABEL[ind]} {roman(lowest)}
                        </option>
                      );
                    })}
                  </select>
                );
              })()
            ) : null}
            <button
              type="button"
              className="brass-ghost-btn"
              onClick={() => onPatch({ sales: draft.sales.filter((_, i) => i !== si) })}
            >
              ✕
            </button>
          </div>
        );
      })}
      <button type="button" className="brass-primary-btn" disabled={!canSubmit || submitting} onClick={onSubmit}>
        确认出售（{draft.sales.length} 块）
      </button>
    </div>
  );
}

function BeerPicker({
  state,
  myPlayer,
  soldTileLocation,
  merchantSlotId,
  value,
  onChange,
}: {
  state: BrassState;
  myPlayer: number;
  soldTileLocation?: string;
  merchantSlotId: string;
  value: BeerSource;
  onChange: (next: BeerSource) => void;
}) {
  const opts = beerCandidates(state, myPlayer, 1, { soldTileLocation, merchantSlotId });
  return (
    <select
      value={value.kind === "brewery" ? value.tileId : value.merchantSlotId}
      onChange={(e) => {
        const v = e.target.value;
        const merchant = opts.find((x): x is Extract<import("@coup/brass-domain").BeerCandidate, { kind: "merchant" }> => x.kind === "merchant" && x.merchantSlotId === v);
        if (merchant) {
          onChange({ kind: "merchant", merchantSlotId: merchant.merchantSlotId });
          return;
        }
        onChange({ kind: "brewery", tileId: v });
      }}
    >
      {opts.map((c) => (
        <option key={c.kind === "brewery" ? c.tileId : c.merchantSlotId} value={c.kind === "brewery" ? c.tileId : c.merchantSlotId}>
          {c.kind === "brewery" ? `${locationLabel(NODE_LOC(c.tileId!, state))} 酒厂${c.owner === myPlayer ? "（自己）" : "（对手）"}` : `商人啤酒（${merchantBeerBonus(c.location ?? "")}）`}
        </option>
      ))}
    </select>
  );
}

