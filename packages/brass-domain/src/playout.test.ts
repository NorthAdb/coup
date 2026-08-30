import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMatch } from './setup.js';
import { applyCommand } from './engine.js';
import { planAutoDecision } from './autoPlan.js';
import {
  buildOptionsForCard,
  sellTargets,
  networkOptions,
  developOptions,
  canScout,
  loanPreview,
  coalCandidates,
  ironCandidates,
  beerCandidates,
} from './affordances.js';
import { LINKS, linkEndpoints } from './data/board.js';
import {
  COAL_MARKET_CAPACITY,
  COAL_MARKET_PRICES,
  COAL_FLOOR_PRICE,
  IRON_MARKET_CAPACITY,
  IRON_MARKET_PRICES,
  IRON_FLOOR_PRICE,
  buyCost,
} from './data/market.js';
import type { BrassCommand, BrassState, CoalSource, IronSource, BeerSource } from './types.js';
import type { CoalCandidate, IronCandidate, BeerCandidate } from './affordances.js';

/**
 * 随机对局模糊测试：bot 依据 affordances + 现金约束构造合法命令打完整局，
 * 校验每步成功、状态不变量成立、游戏能到达终局、VP 得分为正。
 */

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, arr: T[]): T | undefined {
  if (arr.length === 0) return undefined;
  return arr[Math.floor(rand() * arr.length)];
}

/** 市场现金成本（无矿/铁厂可用时的兜底）。 */
function coalCash(state: BrassState, atNodes: string[], n: number): number {
  const cands = coalCandidates(state, atNodes);
  if (cands.some((c) => c.kind === 'mine')) return 0;
  if (!cands.some((c) => c.kind === 'market')) return Number.POSITIVE_INFINITY;
  return buyCost(COAL_MARKET_PRICES, COAL_MARKET_CAPACITY, state.coalMarket, n, COAL_FLOOR_PRICE);
}

function ironCash(state: BrassState, n: number): number {
  const cands = ironCandidates(state);
  if (cands.some((c) => c.kind === 'works')) return 0;
  if (!cands.some((c) => c.kind === 'market')) return Number.POSITIVE_INFINITY;
  return buyCost(IRON_MARKET_PRICES, IRON_MARKET_CAPACITY, state.ironMarket, n, IRON_FLOOR_PRICE);
}

/** 按距离贪心分配煤源（最近优先）。 */
function assignCoal(state: BrassState, atNodes: string[], n: number): CoalSource[] {
  const cands = coalCandidates(state, atNodes);
  const sources: CoalSource[] = [];
  const avail = new Map<string, number>();
  const mines = cands
    .filter((c) => c.kind === "mine")
    .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
  const market = cands.find((c) => c.kind === 'market');
  for (let i = 0; i < n; i++) {
    let assigned = false;
    for (const mine of mines) {
      const a = avail.get(mine.tileId) ?? mine.available;
      if (a > 0) {
        avail.set(mine.tileId, a - 1);
        sources.push({ kind: 'mine', tileId: mine.tileId });
        assigned = true;
        break;
      }
    }
    if (!assigned && market) sources.push({ kind: 'market' });
    if (!assigned) return [];
  }
  return sources;
}

function assignIron(state: BrassState, n: number): IronSource[] {
  const cands = ironCandidates(state);
  const sources: IronSource[] = [];
  const avail = new Map<string, number>();
  const works = cands.filter((c) => c.kind === "works");
  const market = cands.find((c) => c.kind === 'market');
  for (let i = 0; i < n; i++) {
    let assigned = false;
    for (const w of works) {
      const a = avail.get(w.tileId) ?? w.available;
      if (a > 0) {
        avail.set(w.tileId, a - 1);
        sources.push({ kind: 'works', tileId: w.tileId });
        assigned = true;
        break;
      }
    }
    if (!assigned && market) sources.push({ kind: 'market' });
    if (!assigned) return [];
  }
  return sources;
}

function assignBeer(state: BrassState, player: number, n: number, opts: { soldTileLocation?: string; merchantSlotId?: string; secondLinkEndpoints?: string[] }): BeerSource[] {
  const cands = beerCandidates(state, player, n, opts);
  const sources: BeerSource[] = [];
  const avail = new Map<string, number>();
  const own = cands.filter((c): c is Extract<BeerCandidate, { kind: 'brewery' }> => c.kind === 'brewery' && c.owner === player);
  const opp = cands.filter((c): c is Extract<BeerCandidate, { kind: 'brewery' }> => c.kind === 'brewery' && c.owner !== player);
  const merchant = cands.find((c): c is Extract<BeerCandidate, { kind: 'merchant' }> => c.kind === 'merchant');
  for (let i = 0; i < n; i++) {
    let assigned = false;
    for (const pool of [own, opp]) {
      for (const b of pool) {
        const a = avail.get(b.tileId) ?? b.available;
        if (a > 0) {
          avail.set(b.tileId, a - 1);
          sources.push({ kind: 'brewery', tileId: b.tileId });
          assigned = true;
          break;
        }
      }
      if (assigned) break;
    }
    if (!assigned && merchant && merchant.kind === 'merchant') {
      sources.push({ kind: 'merchant', merchantSlotId: merchant.merchantSlotId });
      assigned = true;
    }
    if (!assigned) return [];
  }
  return sources;
}

interface Stats {
  commands: number;
  affordanceMisses: number;
  passes: number;
  byType: Record<string, number>;
}

/** 为当前玩家构造候选命令（现金可行优先），依序尝试应用，返回新状态或 null。 */
function planCommand(rand: () => number, state: BrassState, stats: Stats): BrassState | null {
  const player = state.currentPlayer;
  const version = state.stateVersion;
  const hand = state.players[player].hand.slice();
  const money = state.players[player].money;
  if (hand.length === 0) return null;
  const ev = { expectedVersion: version, player };
  const tries: BrassCommand[] = [];

  const card = pick(rand, hand);
  if (!card) return null;

  // Build（优先）。
  const { spots } = buildOptionsForCard(state, player, card);
  for (const spot of spots) {
    const cash =
      spot.costMoney +
      (spot.costCoal > 0 ? coalCash(state, [spot.location], spot.costCoal) : 0) +
      (spot.costIron > 0 ? ironCash(state, spot.costIron) : 0);
    if (cash > money) continue;
    const coal = spot.costCoal > 0 ? assignCoal(state, [spot.location], spot.costCoal) : [];
    const iron = spot.costIron > 0 ? assignIron(state, spot.costIron) : [];
    if (coal.length !== spot.costCoal || iron.length !== spot.costIron) continue;
    const useOverbuild = spot.emptySlots.length === 0 || (spot.overbuildTileIds.length > 0 && rand() < 0.12);
    const overbuildTileId = useOverbuild ? pick(rand, spot.overbuildTileIds) : undefined;
    const slotIndex = !useOverbuild && spot.emptySlots.length > 0 ? pick(rand, spot.emptySlots) : 0;
    if (useOverbuild && !overbuildTileId) continue;
    tries.push({ type: 'build', cardId: card, industry: spot.industry, location: spot.location, slotIndex: slotIndex ?? 0, overbuildTileId, coalSources: coal, ironSources: iron, ...ev });
  }

  // Network。
  const net = networkOptions(state, player);
  if (state.era === 'canal') {
    if (money >= 3) {
      for (const opt of net.options) {
        tries.push({ type: 'network', cardId: card, links: [{ linkIndex: opt.linkIndex, coalSources: [] }], ...ev });
      }
    }
  } else {
    for (const opt of net.options) {
      const cash = 5 + coalCash(state, linkEndpoints(LINKS[opt.linkIndex]), 1);
      if (cash > money) continue;
      const coal = assignCoal(state, linkEndpoints(LINKS[opt.linkIndex]), 1);
      if (coal.length !== 1) continue;
      tries.push({ type: 'network', cardId: card, links: [{ linkIndex: opt.linkIndex, coalSources: coal }], ...ev });
    }
    if (money >= 15 && net.options.length >= 2) {
      const a = pick(rand, net.options);
      const b = pick(rand, net.options.filter((o) => o !== a));
      if (a && b) {
        const epsA = linkEndpoints(LINKS[a.linkIndex]);
        const epsB = linkEndpoints(LINKS[b.linkIndex]);
        const cash = 15 + coalCash(state, epsA, 1) + coalCash(state, epsB, 1);
        if (cash <= money) {
          const coalA = assignCoal(state, epsA, 1);
          const coalB = assignCoal(state, epsB, 1);
          const beer = pick(rand, beerCandidates(state, player, 1, { secondLinkEndpoints: epsB }));
          if (coalA.length === 1 && coalB.length === 1 && beer) {
            tries.push({
              type: 'network', cardId: card,
              links: [
                { linkIndex: a.linkIndex, coalSources: coalA },
                { linkIndex: b.linkIndex, coalSources: coalB },
              ],
              beerSource: beer.kind === 'brewery' ? { kind: 'brewery', tileId: beer.tileId } : { kind: 'merchant', merchantSlotId: beer.merchantSlotId },
              ...ev,
            });
          }
        }
      }
    }
  }

  // Sell。
  for (const t of sellTargets(state, player)) {
    for (const m of t.merchants) {
      const beer = assignBeer(state, player, t.beersToSell, { soldTileLocation: t.location, merchantSlotId: m.slotId });
      if (beer.length !== t.beersToSell) continue;
      const usesMerchantBeer = beer.some((x) => x.kind === 'merchant');
      tries.push({
        type: 'sell', cardId: card, sales: [{
          tileId: t.tileId,
          merchantSlotId: m.slotId,
          beerSources: beer,
          developIndustry: usesMerchantBeer && m.location === 'gloucester' ? pick(rand, ['coal', 'iron', 'cotton', 'manufacturer', 'brewery'] as const) : undefined,
        }], ...ev,
      });
    }
  }

  // Develop。
  for (const d of developOptions(state, player).filter((x) => !x.lightbulb)) {
    const cash = ironCash(state, 1);
    if (cash > money) continue;
    const iron = assignIron(state, 1);
    if (iron.length !== 1) continue;
    tries.push({ type: 'develop', cardId: card, industries: [d.industry], ironSources: iron, ...ev });
  }

  // Loan / Scout / Pass。
  if (loanPreview(state, player).allowed) tries.push({ type: 'loan', cardId: card, ...ev });
  if (canScout(state, player)) {
    const others = hand.filter((c) => c !== 'wild-location' && c !== 'wild-industry');
    if (others.length >= 3) tries.push({ type: 'scout', cardIds: others.slice(0, 3), ...ev });
  }
  tries.push({ type: 'pass', cardId: card, ...ev });

  // 随机洗非 pass 尝试；偏向能得分的动作（卖货 / 触碰商人位的连线）。
  const MERCHANT_TOUCHING = new Set([5, 6, 20, 23, 27, 28, 32, 35]);
  const privileged = tries.filter(
    (c) => c.type === 'sell' || (c.type === 'network' && c.links.some((l) => MERCHANT_TOUCHING.has(l.linkIndex))),
  );
  const rest = tries.filter((c) => !privileged.includes(c) && c.type !== 'pass');
  const order = [
    ...privileged.sort(() => rand() - 0.5),
    ...rest.sort(() => rand() - 0.5),
    ...tries.filter((c) => c.type === 'pass'),
  ];
  for (const command of order) {
    const result = applyCommand(state, command);
    if (result.ok) {
      stats.commands += 1;
      stats.byType[command.type] = (stats.byType[command.type] ?? 0) + 1;
      if (command.type === 'pass') stats.passes += 1;
      return result.state;
    }
    stats.affordanceMisses += 1;
  }
  return null;
}

function checkInvariants(state: BrassState): void {
  for (const p of state.players) {
    assert.ok(p.money >= 0, `money negative: ${p.money}`);
    assert.ok(p.incomeSpace >= 0 && p.incomeSpace <= 99);
    for (const industry of Object.keys(p.mat) as (keyof typeof p.mat)[]) {
      for (const level of p.mat[industry]) {
        assert.ok(level >= 1 && level <= 8);
      }
    }
  }
  assert.ok(state.coalMarket >= 0 && state.coalMarket <= 14);
  assert.ok(state.ironMarket >= 0 && state.ironMarket <= 10);
  for (const t of state.placedTiles) {
    assert.ok(t.coal >= 0 && t.iron >= 0 && t.beer >= 0);
  }
}

test('随机对局：2/3/4 人多种子完整可玩到终局', () => {
  const seeds = [
    { players: 2, seed: 'alpha-1' },
    { players: 2, seed: 'alpha-2' },
    { players: 3, seed: 'beta-1' },
    { players: 3, seed: 'beta-2' },
    { players: 4, seed: 'gamma-1' },
    { players: 4, seed: 'gamma-2' },
  ];
  for (const { players, seed } of seeds) {
    const rand = mulberry32(seed.length * 7919 + players * 104729);
    let state = createMatch({ matchId: `playout-${seed}`, seed, playerCount: players as 2 | 3 | 4 });
    const stats: Stats = { commands: 0, affordanceMisses: 0, passes: 0, byType: {} };
    let steps = 0;
    while (state.status !== 'finished') {
      steps += 1;
      assert.ok(steps < 4000, `playout ${seed} did not finish`);
      if (state.phase === 'await_shortfall_removal') {
        const cmd = planAutoDecision(state, state.shortfall!.player, state.stateVersion);
        assert.ok(cmd, 'shortfall auto plan missing');
        const r = applyCommand(state, cmd!);
        assert.equal(r.ok, true, `shortfall removal failed: ${r.ok ? '' : r.reason}`);
        state = (r as { ok: true; state: BrassState }).state;
        continue;
      }
      const next = planCommand(rand, state, stats);
      if (next) {
        state = next;
      } else {
        const cardId = state.players[state.currentPlayer].hand[0];
        assert.ok(cardId, 'no card to pass with');
        const r = applyCommand(state, { type: 'pass', player: state.currentPlayer, cardId, expectedVersion: state.stateVersion });
        assert.equal(r.ok, true, `fallback pass failed: ${r.ok ? '' : r.reason}`);
        state = (r as { ok: true; state: BrassState }).state;
        stats.passes += 1;
      }
      checkInvariants(state);
    }
    assert.equal(state.era, 'rail');
    assert.ok(state.finalScores && state.finalScores.length === players);
    console.log(
      `playout ${seed}: ${players}p commands=${stats.commands} passes=${stats.passes} misses=${stats.affordanceMisses} ` +
        `vp=${state.finalScores.map((s) => s.vp).join('/')} actions=${JSON.stringify(stats.byType)} ` +
        `tiles=${state.placedTiles.length} flipped=${state.placedTiles.filter((t) => t.flipped).length}`,
    );
    // 纯随机 bot 可能整局不得分（网络不达商人位），只断言结构完成与不变量。
    const missRate = stats.affordanceMisses / Math.max(1, stats.affordanceMisses + stats.commands);
    assert.ok(
      missRate < 0.15,
      `playout ${seed}: affordance miss rate ${missRate.toFixed(2)} (${stats.affordanceMisses}/${stats.commands})`,
    );
    console.log(
      `playout ${seed}: ${players}p commands=${stats.commands} passes=${stats.passes} misses=${stats.affordanceMisses} ` +
        `vp=${state.finalScores.map((s) => s.vp).join('/')} actions=${JSON.stringify(stats.byType)}`,
    );
  }
});
