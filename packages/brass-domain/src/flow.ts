import type { BrassState, LogEntry, LogKind, PlacedLink } from './types.js';
import { HAND_SIZE } from './data/cards.js';
import { incomeLevelAt, advanceIncome } from './data/income.js';
import { MERCHANTS, LINKS, linkEndpoints } from './data/board.js';
import { tileSpec } from './data/tiles.js';
import { hashSeed, mulberry32, shuffled } from './rng.js';
import { LINKS_PER_PLAYER_PER_ERA } from './setup.js';

export class RuleError extends Error {
  reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

export function err(reason: string): never {
  throw new RuleError(reason);
}

export function log(state: BrassState, kind: LogKind, player: number | undefined, payload?: Record<string, string | number | boolean>): void {
  const entry: LogEntry = { seq: state.log.length, kind, player, payload };
  state.log.push(entry);
}

/** 时代内每回合行动数：运河时代第 1 回合 1 个，其余 2 个。 */
export function perTurnActions(state: BrassState): number {
  return state.era === 'canal' && state.round === 1 ? 1 : 2;
}

export function cardFaceOf(cardId: string): { kind: 'location'; location: string } | { kind: 'industry'; industries: string[] } | { kind: 'wild-location' } | { kind: 'wild-industry' } {
  if (cardId === 'wild-location') return { kind: 'wild-location' };
  if (cardId === 'wild-industry') return { kind: 'wild-industry' };
  const hash = cardId.lastIndexOf('#');
  const base = hash >= 0 ? cardId.slice(0, hash) : cardId;
  if (base.startsWith('loc-')) return { kind: 'location', location: base.slice(4) };
  if (base.startsWith('ind-')) return { kind: 'industry', industries: base.slice(4).split('_') };
  err('unknown_card');
}

export function refillHand(state: BrassState, player: number): void {
  const p = state.players[player];
  while (p.hand.length < HAND_SIZE && state.deck.length > 0) {
    p.hand.push(state.deck.shift()!);
  }
}

function rngFor(state: BrassState): () => number {
  return mulberry32(hashSeed(`${state.seed}#${state.stateVersion}`));
}

/** 行动消耗后推进：减行动数、空手提前结束、回合/轮次流转。 */
export function afterActionConsumed(state: BrassState): void {
  state.actionsLeft -= 1;
  const handEmpty = state.players[state.currentPlayer].hand.length === 0;
  if (state.actionsLeft > 0 && !handEmpty) return;
  endTurn(state);
}

function endTurn(state: BrassState): void {
  refillHand(state, state.currentPlayer);
  const pos = state.turnOrder.indexOf(state.currentPlayer);
  if (pos === state.turnOrder.length - 1) {
    endRound(state);
    return;
  }
  state.currentPlayer = state.turnOrder[pos + 1];
  startTurn(state);
}

function startTurn(state: BrassState): void {
  state.actionsLeft = perTurnActions(state);
  if (state.players[state.currentPlayer].hand.length === 0) {
    // 牌库已空且该玩家无手牌：跳过其回合。
    endTurn(state);
  }
}

/** 时代是否在本轮结束时切换（牌库与所有手牌同时耗尽）。 */
export function eraEndsNow(state: BrassState): boolean {
  return state.deck.length === 0 && state.players.every((p) => p.hand.length === 0);
}

function endRound(state: BrassState): void {
  // 1. 下轮座次：本轮花费升序（稳定排序，并列保持相对序）。
  state.turnOrder = state.turnOrder
    .slice()
    .sort((a, b) => state.players[a].spent - state.players[b].spent);
  for (const p of state.players) p.spent = 0;

  // 2. 收入（游戏最终回合除外）。
  const gameEnds = eraEndsNow(state) && state.era === 'rail';
  if (!gameEnds) {
    const shortfallPlayers: { player: number; amount: number }[] = [];
    for (const player of state.turnOrder) {
      const p = state.players[player];
      const level = incomeLevelAt(p.incomeSpace);
      if (level >= 0) {
        p.money += level;
        log(state, 'income', player, { level, gained: level });
      } else {
        const owed = -level;
        const paid = Math.min(p.money, owed);
        p.money -= paid;
        const need = owed - paid;
        log(state, 'income', player, { level, gained: -paid });
        if (need > 0) {
          shortfallPlayers.push({ player, amount: need });
        }
      }
    }
    if (shortfallPlayers.length > 0) {
      const first = shortfallPlayers.shift()!;
      state.shortfallQueue = shortfallPlayers;
      state.shortfall = first;
      state.phase = 'await_shortfall_removal';
      log(state, 'shortfall', first.player, { amount: first.amount, stage: 'enter' });
      checkShortfallHopeless(state);
      if (state.phase !== 'await_shortfall_removal') return; // 已在 checkShortfallHopeless 中推进
      return;
    }
  }

  finishRoundEnd(state);
}

/** 缺额玩家已无场上板块可拆 → 按 VP 扣减结算。 */
function checkShortfallHopeless(state: BrassState): void {
  const sf = state.shortfall;
  if (!sf) return;
  const hasTiles = state.placedTiles.some((t) => t.player === sf.player);
  if (hasTiles) return;
  const p = state.players[sf.player];
  const loss = Math.min(p.vp, sf.amount);
  p.vp -= loss;
  const unpaid = sf.amount - loss;
  log(state, 'shortfall', sf.player, { amount: sf.amount, vpLost: loss, unpaid, stage: 'vp_loss' });
  advanceShortfallQueue(state);
}

/** 一块缺额拆板：补钱，够付则自动结清。 */
export function applyShortfallRemoval(state: BrassState, tileId: string): void {
  const sf = state.shortfall;
  if (!sf) err('no_shortfall');
  const tile = state.placedTiles.find((t) => t.id === tileId);
  if (!tile) err('tile_not_found');
  if (tile.player !== sf.player) err('not_your_tile');
  const value = Math.floor(tileSpec(tile.industry, tile.level).costMoney / 2);
  state.placedTiles = state.placedTiles.filter((t) => t.id !== tileId);
  const p = state.players[sf.player];
  p.money += value;
  log(state, 'shortfall', sf.player, { tileId, value, stage: 'remove' });
  if (p.money >= sf.amount) {
    p.money -= sf.amount;
    log(state, 'shortfall', sf.player, { amount: sf.amount, stage: 'paid' });
    advanceShortfallQueue(state);
  } else {
    checkShortfallHopeless(state);
  }
}

function advanceShortfallQueue(state: BrassState): void {
  const next = state.shortfallQueue?.shift();
  if (next) {
    state.shortfall = next;
    log(state, 'shortfall', next.player, { amount: next.amount, stage: 'enter' });
    checkShortfallHopeless(state);
    return;
  }
  state.shortfall = null;
  state.shortfallQueue = [];
  state.phase = 'await_action';
  finishRoundEnd(state);
}

function finishRoundEnd(state: BrassState): void {
  if (eraEndsNow(state)) {
    endEra(state);
    return;
  }
  state.round += 1;
  state.currentPlayer = state.turnOrder[0];
  startTurn(state);
}

/** 某地点对 Link 计分的贡献：商人位恒 2；其余=该地已翻面板块的连接图标数之和。 */
export function linkValueOfNode(state: BrassState, node: string): number {
  if (MERCHANTS[node]) return 2;
  let value = 0;
  for (const tile of state.placedTiles) {
    if (tile.location === node && tile.flipped) {
      value += tileSpec(tile.industry, tile.level).linkPoints;
    }
  }
  return value;
}

export function linkScore(state: BrassState, link: PlacedLink): number {
  const def = LINKS[link.linkIndex];
  if (!def) return 0;
  let total = 0;
  for (const node of linkEndpoints(def)) total += linkValueOfNode(state, node);
  return total;
}

function endEra(state: BrassState): void {
  // 1. Link 计分（计分后移除）。
  const linkVp = new Map<number, number>();
  for (const link of state.placedLinks) {
    linkVp.set(link.player, (linkVp.get(link.player) ?? 0) + linkScore(state, link));
  }
  for (const [player, vp] of linkVp) {
    state.players[player].vp += vp;
    log(state, 'era_score', player, { source: 'links', vp });
  }
  state.placedLinks = [];

  // 2. 翻面产业计分。
  const tileVp = new Map<number, number>();
  for (const tile of state.placedTiles) {
    if (tile.flipped) {
      tileVp.set(tile.player, (tileVp.get(tile.player) ?? 0) + tileSpec(tile.industry, tile.level).vp);
    }
  }
  for (const [player, vp] of tileVp) {
    state.players[player].vp += vp;
    log(state, 'era_score', player, { source: 'tiles', vp });
  }

  if (state.era === 'canal') {
    // 3. 移除场上 1 级板块。
    const removed = state.placedTiles.filter((t) => t.level === 1).length;
    state.placedTiles = state.placedTiles.filter((t) => t.level > 1);
    log(state, 'era_end', undefined, { stage: 'remove_level1', removed });
    // 4. 商人啤酒补满。
    for (const m of state.merchantTiles) {
      if (!m.blank) m.beer = true;
    }
    // 5. 弃牌堆洗成新牌库；6. 重抽手牌。
    const discards = state.players.flatMap((p) => {
      const d = p.discard;
      p.discard = [];
      return d;
    });
    state.deck = shuffled(discards, rngFor(state));
    for (const p of state.players) {
      p.hand = state.deck.splice(0, HAND_SIZE);
    }
    state.era = 'rail';
    state.round = 1;
    state.linksLeft = state.players.map(() => LINKS_PER_PLAYER_PER_ERA);
    log(state, 'era_end', undefined, { stage: 'rail_era_start' });
    state.currentPlayer = state.turnOrder[0];
    startTurn(state);
    return;
  }

  // 终局。
  log(state, 'era_end', undefined, { stage: 'game_end' });
  const scores = state.players.map((p, i) => ({
    player: i,
    vp: p.vp,
    income: incomeLevelAt(p.incomeSpace),
    money: p.money,
  }));
  const sorted = scores.slice().sort((a, b) => b.vp - a.vp || b.income - a.income || b.money - a.money);
  const best = sorted[0];
  const winners = scores.filter((s) => s.vp === best.vp && s.income === best.income && s.money === best.money);
  state.winner = winners.length === 1 ? winners[0].player : null;
  state.finalScores = scores.slice().sort((a, b) => b.vp - a.vp || b.income - a.income || b.money - a.money);
  state.status = 'finished';
  log(state, 'game_end', state.winner ?? undefined, { winners: winners.map((w) => w.player).join(',') });
}

/** 翻面板块并推进收入。 */
export function flipTile(state: BrassState, tileId: string): void {
  const tile = state.placedTiles.find((t) => t.id === tileId);
  if (!tile || tile.flipped) return;
  tile.flipped = true;
  const spec = tileSpec(tile.industry, tile.level);
  const p = state.players[tile.player];
  p.incomeSpace = advanceIncome(p.incomeSpace, spec.income);
  log(state, 'flip', tile.player, { tileId, industry: tile.industry, level: tile.level, income: spec.income });
}
