import type { BrassState, NodeId } from './types.js';
import { LINKS, linkEndpoints } from './data/board.js';

/**
 * 版图连通性。图的边=已放置的 Link（任何玩家）。
 * 时代由局面隐含：运河时代末 Link 全部移除，铁路时代只放铁路 Link。
 */

/** 已放置 Link 的邻接表（含 via 三端点）。 */
export function adjacency(state: BrassState): Map<NodeId, Set<NodeId>> {
  const adj = new Map<NodeId, Set<NodeId>>();
  const add = (a: NodeId, b: NodeId) => {
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  };
  for (const link of state.placedLinks) {
    const def = LINKS[link.linkIndex];
    if (!def) continue;
    const eps = linkEndpoints(def);
    for (let i = 0; i < eps.length; i++) {
      for (let j = i + 1; j < eps.length; j++) add(eps[i], eps[j]);
    }
  }
  return adj;
}

/** from 可达的全部节点（含 from）。 */
export function reachable(state: BrassState, from: NodeId): Set<NodeId> {
  const adj = adjacency(state);
  const seen = new Set<NodeId>([from]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const next of adj.get(cur) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

/** a、b 是否连通（任一玩家的 Link 链）。 */
export function isConnected(state: BrassState, a: NodeId, b: NodeId): boolean {
  return reachable(state, a).has(b);
}

/** from 到每个节点的 Link 跳数（不可达为 Infinity）。 */
export function distances(state: BrassState, from: NodeId): Map<NodeId, number> {
  const adj = adjacency(state);
  const dist = new Map<NodeId, number>([[from, 0]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    const d = dist.get(cur)!;
    for (const next of adj.get(cur) ?? []) {
      if (!dist.has(next)) {
        dist.set(next, d + 1);
        queue.push(next);
      }
    }
  }
  return dist;
}

/** node 是否属于 player 的 network：含其板块，或与其 Link 相邻。 */
export function isInNetwork(state: BrassState, player: number, node: NodeId): boolean {
  if (state.placedTiles.some((t) => t.player === player && t.location === node)) return true;
  for (const link of state.placedLinks) {
    if (link.player !== player) continue;
    const def = LINKS[link.linkIndex];
    if (def && linkEndpoints(def).includes(node)) return true;
  }
  return false;
}

/** player 在场上的板块/Link 总数（用于「开局无板块」例外）。 */
export function hasNothingOnBoard(state: BrassState, player: number): boolean {
  return !state.placedTiles.some((t) => t.player === player) && !state.placedLinks.some((l) => l.player === player);
}
