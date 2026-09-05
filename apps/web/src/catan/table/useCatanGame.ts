import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  bankTrade,
  buildCity,
  buildRoad,
  buildSettlement,
  buyDev,
  cancelTrade,
  createGame,
  endRobberMove,
  endTurn,
  legalCities,
  legalRoads,
  legalSettlements,
  moveRobber,
  playDev,
  proposeTrade,
  respondTrade,
  robberVictims,
  rollDice,
  steal,
  type PlayerSetup,
} from "../mock/game.ts";
import {
  RESOURCE_NAMES,
  type CatanGame,
  type DevCardKind,
  type FloatChip,
  type GameResult,
  type ResourceCount,
  type ResourceId,
} from "../mock/types.ts";

/**
 * 卡坦岛 Mock 对局状态钩子：持有引擎状态、驱动 AI 回合（分阶段、可取消）、
 * 把引擎事件翻译成桌面反馈（骰子滚动 / Token 点亮 / 资源飘卡 / 建筑落位 / 提示）。
 * AI 行为全是 Mock 启发式，不追求棋力。
 */

export type { FloatChip };

export interface DiceState {
  a: number;
  b: number;
  rolling: boolean;
}

const AI_NAMES = ["艾拉", "马库斯", "苏珊"] as const;
const ROBOT_THINK_MS = 950;

function makeRunner(): { cancel: () => void; sleep: (ms: number) => Promise<void> } {
  let cancelled = false;
  return {
    cancel: () => {
      cancelled = true;
    },
    sleep: (ms) =>
      new Promise((resolve, reject) => {
        setTimeout(() => {
          if (cancelled) reject(new Error("cancelled"));
          else resolve();
        }, ms);
      }),
  };
}

export function useCatanGame(
  playerName: string,
  seatCount: 3 | 4,
  announce: (text: string) => void,
  opts: { demoWin?: boolean } = {},
) {
  const setups: PlayerSetup[] = useMemo(() => {
    const ais = AI_NAMES.slice(0, seatCount - 1);
    return [
      { name: playerName || "你", color: "#b3573f", isHuman: true },
      ...ais.map((n) => ({ name: n, color: "", isHuman: false })),
    ].map((s, i) => ({ ...s, color: ["#b3573f", "#3f6d8e", "#5d7048", "#c9973f"][i]! }));
  }, [playerName, seatCount]);

  const [game, setGame] = useState<CatanGame>(() => {
    const created = createGame(setups, (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0);
    if (opts.demoWin) {
      // 演示模式（/catan/play#demo-win）：2 建筑 + 8 张胜利点卡 = 10 分，
      // 任何一次建造都会触发终局，用于人工走查胜利结算页。仅 Mock 阶段存在。
      created.players[0]!.dev = ["vp", "vp", "vp", "vp", "vp", "vp", "vp", "vp"];
      created.players[0]!.hand = { wood: 2, brick: 2, wool: 2, wheat: 2, ore: 2 };
    }
    return created;
  });
  const gameRef = useRef(game);
  const [dice, setDice] = useState<DiceState>({ a: 3, b: 4, rolling: false });
  const [hotTiles, setHotTiles] = useState<ReadonlySet<number>>(new Set());
  const [floatChips, setFloatChips] = useState<FloatChip[]>([]);
  const [freshPiece, setFreshPiece] = useState<{ kind: "road" | "settlement" | "city"; key: number } | null>(null);
  const chipSeq = useRef(0);
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    const set = timers.current;
    return () => {
      for (const t of set) clearTimeout(t);
      set.clear();
    };
  }, []);

  const later = useCallback((ms: number, fn: () => void): void => {
    const t = setTimeout(() => {
      timers.current.delete(t);
      fn();
    }, ms);
    timers.current.add(t);
  }, []);

  /** 把引擎结果写入状态并处理事件反馈。返回是否成功。 */
  const apply = useCallback(
    (result: GameResult): boolean => {
      if (!result.ok) return false;
      gameRef.current = result.game;
      setGame(result.game);
      for (const ev of result.events) {
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
          if (ev.from === 0) announce("强盗从你手中摸走了一张资源卡");
          else if (ev.to === 0) announce(`你从对手手中摸走了一张资源卡`);
        } else if (ev.type === "win") {
          announce(ev.player === 0 ? "你率先凑齐 10 分，赢得对局！" : `${result.game.players[ev.player]!.name} 率先凑齐 10 分`);
        }
      }
      return true;
    },
    [announce, later],
  );

  const rollNow = useCallback(
    async (forAI: boolean): Promise<void> => {
      setDice((d) => ({ ...d, rolling: true }));
      await new Promise((r) => setTimeout(r, forAI ? 820 : 780));
      const result = rollDice(gameRef.current);
      if (!result.ok) {
        setDice((d) => ({ ...d, rolling: false }));
        return;
      }
      const ev = result.events.find((e) => e.type === "dice");
      if (ev && ev.type === "dice") {
        const roller = gameRef.current.players[gameRef.current.turn]!;
        announce(forAI ? `${roller.name} 掷出 ${ev.a} + ${ev.b}` : `你掷出 ${ev.a} + ${ev.b} = ${ev.a + ev.b}`);
      }
      apply(result);
    },
    [announce, apply],
  );

  /* ---------------- AI 回合调度（按阶段分步，效果重跑时取消重建） ---------------- */

  const turnKey = `${game.turn}:${game.phase}:${game.winner ?? ""}`;
  useEffect(() => {
    const cur = gameRef.current.players[gameRef.current.turn]!;
    if (gameRef.current.phase === "over" || cur.isHuman) return;
    const runner = makeRunner();
    const aiIndex = cur.id;
    const name = cur.name;

    void (async () => {
      try {
        let g = gameRef.current;

        if (g.phase === "roll") {
          await runner.sleep(ROBOT_THINK_MS);
          await rollNow(true);
          g = gameRef.current;
        }

        if (g.phase === "robber") {
          await runner.sleep(820);
          g = gameRef.current;
          const tiles = g.tiles
            .filter((t) => t.id !== g.robberTile && t.terrain !== "desert")
            .map((t) => t.id);
          // 六成概率挑人类建筑邻块，否则随机。
          const humanTiles = tiles.filter((id) =>
            g.buildings.some((b) => b.owner === 0 && g.vertices[b.vertex]!.tiles.includes(id)),
          );
          const target =
            humanTiles.length > 0 && Math.random() < 0.6
              ? humanTiles[Math.floor(Math.random() * humanTiles.length)]!
              : tiles[Math.floor(Math.random() * tiles.length)]!;
          const mv = moveRobber(g, aiIndex, target);
          if (mv.ok) {
            apply(mv);
            g = mv.game;
          }
          if (g.phase === "robber") {
            await runner.sleep(700);
            g = gameRef.current;
            const victims = robberVictims(g, aiIndex);
            if (victims.length > 0) {
              const victim = victims.includes(0) && Math.random() < 0.65 ? 0 : victims[Math.floor(Math.random() * victims.length)]!;
              const st = steal(g, aiIndex, victim);
              if (st.ok) apply(st);
            } else {
              const en = endRobberMove(g);
              if (en.ok) apply(en);
            }
          }
          g = gameRef.current;
        }

        if (g.phase === "main") {
          await runner.sleep(760);
          g = gameRef.current;

          // 打骑士（三成概率，若手上有）。
          if (g.players[aiIndex]!.dev.includes("knight") && Math.random() < 0.3) {
            const played = playDev(g, aiIndex, "knight");
            if (played.ok) {
              apply(played);
              await runner.sleep(820);
              g = gameRef.current;
              if (g.phase === "robber") {
                // 与掷 7 相同的处理：挪强盗、抢人。
                const tiles = g.tiles.filter((t) => t.id !== g.robberTile && t.terrain !== "desert").map((t) => t.id);
                const humanTiles = tiles.filter((id) =>
                  g.buildings.some((b) => b.owner === 0 && g.vertices[b.vertex]!.tiles.includes(id)),
                );
                const target =
                  humanTiles.length > 0 ? humanTiles[Math.floor(Math.random() * humanTiles.length)]! : tiles[Math.floor(Math.random() * tiles.length)]!;
                const mv = moveRobber(g, aiIndex, target);
                if (mv.ok) {
                  apply(mv);
                  g = mv.game;
                }
                if (g.phase === "robber") {
                  await runner.sleep(650);
                  g = gameRef.current;
                  const victims = robberVictims(g, aiIndex);
                  if (victims.length > 0) {
                    const victim = victims.includes(0) ? 0 : victims[Math.floor(Math.random() * victims.length)]!;
                    const st = steal(g, aiIndex, victim);
                    if (st.ok) apply(st);
                  } else {
                    const en = endRobberMove(g);
                    if (en.ok) apply(en);
                  }
                }
                g = gameRef.current;
              }
            }
          }

          // 建造：城 → 村 → 路。
          const mine = g.players[aiIndex]!;
          const afford = (cost: Partial<ResourceCount>): boolean =>
            (Object.keys(cost) as ResourceId[]).every((k) => mine.hand[k] >= (cost[k] ?? 0));
          const citySpots = legalCities(g, aiIndex);
          if (citySpots.length > 0 && afford({ wheat: 2, ore: 3 }) && Math.random() < 0.55) {
            const r = buildCity(g, aiIndex, citySpots[Math.floor(Math.random() * citySpots.length)]!);
            if (r.ok) {
              apply(r);
              await runner.sleep(600);
              g = gameRef.current;
            }
          }
          let spotSets = legalSettlements(g, aiIndex);          if (spotSets.length > 0 && afford({ wood: 1, brick: 1, wheat: 1, wool: 1 }) && Math.random() < 0.6) {
            const r = buildSettlement(g, aiIndex, spotSets[Math.floor(Math.random() * spotSets.length)]!);
            if (r.ok) {
              apply(r);
              await runner.sleep(600);
              g = gameRef.current;
            }
          }
          let spotRoads = legalRoads(g, aiIndex);
          if (spotRoads.length > 0 && afford({ wood: 1, brick: 1 }) && Math.random() < 0.6) {
            const r = buildRoad(g, aiIndex, spotRoads[Math.floor(Math.random() * spotRoads.length)]!);
            if (r.ok) {
              apply(r);
              await runner.sleep(560);
              g = gameRef.current;
            }
          }

          // 买发展卡。
          if (afford({ wool: 1, wheat: 1, ore: 1 }) && g.devDeck.length > 0 && Math.random() < 0.3) {
            const r = buyDev(g, aiIndex);
            if (r.ok) {
              apply(r);
              g = r.game;
            }
          }

          // 偶尔向人类提议交易。
          if (!g.pendingTrade && Math.random() < 0.14) {
            const hand = g.players[aiIndex]!.hand;
            const rich = (Object.entries(hand) as Array<[ResourceId, number]>)
              .filter(([, n]) => n >= 2)
              .map(([k]) => k);
            const wants = (Object.keys(hand) as ResourceId[]).filter((k) => hand[k] === 0);
            if (rich.length > 0 && wants.length > 0) {
              const give = rich[Math.floor(Math.random() * rich.length)]!;
              const want = wants[Math.floor(Math.random() * wants.length)]!;
              const r = proposeTrade(g, aiIndex, { [give]: 1 }, { [want]: 1 }, 0);
              if (r.ok) {
                apply(r);
                announce(`${name} 想用 1${RESOURCE_NAMES[give]} 换你的 1${RESOURCE_NAMES[want]}`);
                g = r.game;
              }
            }
          }

          await runner.sleep(860);
          const et = endTurn(gameRef.current);
          if (et.ok) apply(et);
        }
      } catch {
        /* 效果重建/卸载导致的取消 */
      }
    })();

    return runner.cancel;
    // turnKey 覆盖 回合/阶段/终局 三个维度；game 引用变化不重跑（避免循环）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnKey]);

  /* ---------------- 人类向 AI 提议后，AI 延迟回应 ---------------- */

  const pendingFromHuman = game.pendingTrade != null && game.pendingTrade.from === 0 && game.pendingTrade.to !== 0;
  useEffect(() => {
    if (!pendingFromHuman) return;
    const runner = makeRunner();
    void (async () => {
      try {
        await runner.sleep(1150 + Math.random() * 900);
        const g = gameRef.current;
        if (!g.pendingTrade || g.pendingTrade.from !== 0) return;
        const responderName = g.players[g.pendingTrade.to]!.name;
        // 启发式：想要的东西越富余越容易答应。
        const wantKey = (Object.entries(g.pendingTrade.want) as Array<[ResourceId, number]>).find(([, n]) => n > 0)?.[0];
        const stock = wantKey ? g.players[g.pendingTrade.to]!.hand[wantKey] : 0;
        const accept = Math.random() < (stock >= 3 ? 0.72 : stock >= 1 ? 0.5 : 0.28);
        const r = respondTrade(g, accept);
        if (r.ok) {
          apply(r);
          announce(accept ? `${responderName} 点头成交` : `${responderName} 婉拒了你的提议`);
        }
      } catch {
        /* cancelled */
      }
    })();
    return runner.cancel;
  }, [pendingFromHuman, apply, announce]);

  /* ---------------- 人类动作 ---------------- */

  const act = useCallback(
    (fn: (g: CatanGame) => GameResult): boolean => {
      const result = fn(gameRef.current);
      if (!result.ok) {
        return false;
      }
      apply(result);
      return true;
    },
    [apply],
  );

  const humanTurn = game.turn === 0 && !game.winner;

  const actions = useMemo(
    () => ({
      roll: () => void rollNow(false),
      buildRoad: (edgeId: number) => act((g) => buildRoad(g, 0, edgeId)),
      buildSettlement: (vertexId: number) => act((g) => buildSettlement(g, 0, vertexId)),
      buildCity: (vertexId: number) => act((g) => buildCity(g, 0, vertexId)),
      buyDev: () => act((g) => buyDev(g, 0)),
      playDevCard: (card: DevCardKind, payload?: { picks?: [ResourceId, ResourceId]; resource?: ResourceId }) =>
        act((g) => playDev(g, 0, card, payload)),
      moveRobberTo: (tileId: number): number[] | null => {
        const r = moveRobber(gameRef.current, 0, tileId);
        if (!r.ok) return null;
        apply(r);
        return r.game.phase === "robber" ? robberVictims(r.game, 0) : [];
      },
      stealFrom: (victim: number) => {
        act((g) => steal(g, 0, victim));
      },
      proposeTo: (to: number, give: Partial<ResourceCount>, want: Partial<ResourceCount>) => act((g) => proposeTrade(g, 0, give, want, to)),
      respondToAI: (accept: boolean) => {
        act((g) => respondTrade(g, accept));
      },
      cancelProposal: () => act((g) => cancelTrade(g)),
      bankExchange: (give: ResourceId, want: ResourceId) => act((g) => bankTrade(g, 0, give, want)),
      endTurn: () => {
        act((g) => endTurn(g));
      },
    }),
    [act, rollNow],
  );

  // 掷 7 后人类移动强盗：移动前受害者未知（受害者由新驻地决定），
  // 由 moveRobberTo 的返回值交给 UI 弹出选择，hook 不再持有受害者状态。

  const legal = useMemo(
    () => ({
      roads: new Set(legalRoads(game, 0)),
      settlements: new Set(legalSettlements(game, 0)),
      cities: new Set(legalCities(game, 0)),
    }),
    [game],
  );

  return {
    game,
    dice,
    hotTiles,
    floatChips,
    freshPiece,
    humanTurn,
    legal,
    canRespondAI: game.pendingTrade != null && game.pendingTrade.from !== 0 && game.pendingTrade.to === 0,
    pendingFromHuman,
    actions,
  };
}
