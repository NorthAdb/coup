import { randomUUID } from "node:crypto";
import type { BrassCommand, BrassState, LogEntry } from "@coup/brass-domain";
import {
  applyCommand,
  buildOptionsForCard,
  coalCandidates,
  createMatch,
  ironCandidates,
  loanPreview,
  networkOptions,
  projectForSeat,
} from "@coup/brass-domain";

/**
 * Brass 对局运行时：与 coup 的 matchRuntime 同构，但投影直接使用 brass-domain
 * 的 projectForSeat（隐藏他人手牌与牌库顺序），命令即 BrassCommand。
 */

export type ActiveBrassMatch = {
  state: BrassState;
  events: LogEntry[];
  /** 房主座位（seatId '1' → player 0）。 */
  humanSeatId: string;
  displayNames: Record<string, string>;
};

export type BrassMatchPersistence = {
  onCreated(match: ActiveBrassMatch, roomCode?: string): void;
  onCommitted(match: ActiveBrassMatch, newEvents: LogEntry[]): void;
};

export const BRASS_PROTOCOL_VERSION = 1;

export function seatIdToPlayer(seatId: string): number | null {
  const n = Number(seatId);
  if (!Number.isInteger(n) || n < 1 || n > 4) return null;
  return n - 1;
}

export function playerToSeatId(player: number): string {
  return String(player + 1);
}

export type BrassSeatView = {
  protocolVersion: 1;
  requestId: string;
  matchId: string;
  stateVersion: number;
  seatId: string;
  game: "brass";
  spectator: boolean;
  state: BrassState;
  hand: string[];
  othersHandCount: Record<number, number>;
  /** 当前欠决策座位的 seatId（供回合计时显示）。 */
  decidingSeatId: string | null;
  isYourTurn: boolean;
  displayName: string | null;
  displayNames: Record<string, string>;
};

export function toBrassSeatView(
  match: ActiveBrassMatch,
  seatId: string,
  requestId = `req-${match.state.stateVersion}-${seatId}`,
): BrassSeatView {
  const projection = projectForSeat(match.state, seatIdToPlayer(seatId) ?? 0);
  const player = seatIdToPlayer(seatId);
  const decidingPlayer = activeDecidingPlayerOf(match.state);
  return {
    protocolVersion: BRASS_PROTOCOL_VERSION,
    requestId,
    matchId: match.state.matchId,
    stateVersion: match.state.stateVersion,
    seatId,
    game: "brass",
    spectator: false,
    state: projection.state,
    hand: projection.hand,
    othersHandCount: projection.othersHandCount,
    decidingSeatId: decidingPlayer === null ? null : playerToSeatId(decidingPlayer),
    isYourTurn: decidingPlayer !== null && player === decidingPlayer,
    displayName: match.displayNames[seatId] ?? null,
    displayNames: match.displayNames,
  };
}

export function toBrassSpectatorView(
  match: ActiveBrassMatch,
  requestId = `spec-${match.state.stateVersion}`,
): BrassSeatView {
  const projection = projectForSeat(match.state, null);
  const decidingPlayer = activeDecidingPlayerOf(match.state);
  return {
    protocolVersion: BRASS_PROTOCOL_VERSION,
    requestId,
    matchId: match.state.matchId,
    stateVersion: match.state.stateVersion,
    seatId: "spectator",
    game: "brass",
    spectator: true,
    state: projection.state,
    hand: [],
    othersHandCount: projection.othersHandCount,
    decidingSeatId: decidingPlayer === null ? null : playerToSeatId(decidingPlayer),
    isYourTurn: false,
    displayName: null,
    displayNames: match.displayNames,
  };
}

/** 当前欠决策玩家（行动阶段=当前玩家；缺额拆板=缺额玩家）。 */
export function activeDecidingPlayerOf(state: BrassState): number | null {
  if (state.status === "finished") return null;
  if (state.phase === "await_shortfall_removal" && state.shortfall) return state.shortfall.player;
  return state.currentPlayer;
}

export function startBrassMatch(options: {
  matchId: string;
  seed: string;
  playerCount: 2 | 3 | 4;
  displayNames: Record<string, string>;
  /** AI 座位（player 下标）；空缺视为全人类。 */
  botPlayers?: number[];
  persistence?: BrassMatchPersistence;
  roomCode?: string;
}): ActiveBrassMatch {
  const created = createMatch({
    matchId: options.matchId,
    seed: options.seed,
    playerCount: options.playerCount,
  });
  if (options.botPlayers && options.botPlayers.length > 0) {
    created.botPlayers = [...options.botPlayers];
  }
  const match: ActiveBrassMatch = {
    state: created,
    events: [],
    humanSeatId: "1",
    displayNames: options.displayNames,
  };
  options.persistence?.onCreated(match, options.roomCode);
  return match;
}

export type BrassDecisionPayload = {
  protocolVersion: number;
  requestId: string;
  stateVersion: number;
  command: BrassCommand;
};

export function submitBrassDecision(
  match: ActiveBrassMatch,
  payload: BrassDecisionPayload,
  options: { persistence?: BrassMatchPersistence; actingSeatId?: string } = {},
): { ok: true; match: ActiveBrassMatch } | { ok: false; reason: string } {
  if (payload.protocolVersion !== BRASS_PROTOCOL_VERSION) {
    return { ok: false, reason: "unsupported_protocol" };
  }
  if (!payload.requestId) {
    return { ok: false, reason: "missing_request_id" };
  }
  if (payload.stateVersion !== match.state.stateVersion) {
    return { ok: false, reason: "version_mismatch" };
  }
  const actingSeatId = options.actingSeatId ?? match.humanSeatId;
  const player = seatIdToPlayer(actingSeatId);
  if (player === null) {
    return { ok: false, reason: "not_human_seat" };
  }
  const command = payload.command;
  if (!command || typeof command !== "object") {
    return { ok: false, reason: "invalid_command" };
  }
  // 座位身份强制：不能替别人提交。
  if (command.player !== player) {
    return { ok: false, reason: "not_your_turn" };
  }
  const result = applyCommand(match.state, command);
  if (!result.ok) {
    return result;
  }
  const next: ActiveBrassMatch = {
    ...match,
    state: result.state,
    events: [...match.events, ...result.events],
  };
  const newEvents = next.events.slice(match.events.length);
  options.persistence?.onCommitted(next, newEvents);
  return { ok: true, match: next };
}

export function newBrassMatchId(): string {
  return `brass-${randomUUID()}`;
}

/* ------------------------------------------------------------------ */
/* 机器人启发式（AI 队友）                                             */
/* ------------------------------------------------------------------ */

/**
 * Brass 机器人：行动阶段按 建造 → 铺路 → 贷款 → 跳过 的优先级出牌，
 * 资源来源用「就近私矿/工场优先、市场兜底」贪心凑齐（与大厅陪玩 bot 同思路，
 * 但直接在服务端权威态上运行）。缺额拆板等特殊阶段交给 planAutoDecision 兜底。
 */
export function planBrassBot(
  state: BrassState,
  seatId: string,
): { payload: BrassDecisionPayload; kind: string } | null {
  const player = seatIdToPlayer(seatId);
  if (player === null) return null;
  if (state.status !== "in_progress") return null;
  const expectedVersion = state.stateVersion;
  const command = planBrassBotCommand(state, player, expectedVersion);
  if (!command) return null;
  return {
    payload: {
      protocolVersion: BRASS_PROTOCOL_VERSION,
      requestId: `bot-${expectedVersion}-${seatId}`,
      stateVersion: expectedVersion,
      command,
    },
    kind: command.type,
  };
}

function planBrassBotCommand(
  state: BrassState,
  player: number,
  expectedVersion: number,
): BrassCommand | null {
  // 缺额拆板（可能轮到任何玩家）由超时代打计划处理。
  if (state.phase === "await_shortfall_removal") return null;
  if (state.currentPlayer !== player || state.actionsLeft <= 0) return null;

  const hand = state.players[player]!.hand;
  const playable = hand.filter(
    (cardId) => cardId !== "wild-location" && cardId !== "wild-industry",
  );
  const candidates = playable.length > 0 ? playable : hand;

  // 1) 建造：第一张能落位的卡。
  for (const cardId of candidates) {
    const info = buildOptionsForCard(state, player, cardId);
    for (const spot of info.spots) {
      const coalSources =
        spot.costCoal > 0 ? greedyCoal(state, [spot.location], spot.costCoal) : [];
      const ironSources = spot.costIron > 0 ? greedyIron(state, spot.costIron) : [];
      if (coalSources.length !== spot.costCoal || ironSources.length !== spot.costIron) {
        continue;
      }
      return {
        type: "build",
        player,
        cardId,
        expectedVersion,
        industry: spot.industry,
        location: spot.location,
        slotIndex: spot.emptySlots[0] ?? 0,
        overbuildTileId:
          spot.emptySlots.length === 0 && spot.overbuildTileIds.length > 0
            ? spot.overbuildTileIds[0]
            : undefined,
        coalSources,
        ironSources,
      };
    }
  }

  // 2) 铺路（铁路时代每条轨 1 煤，从两端/中途节点就近取）。
  const self = state.players[player]!;
  const net = networkOptions(state, player);
  const link = net.options.find((opt) => self.money >= opt.cost);
  if (link) {
    const endpoints = link.via ? [link.from, link.to, link.via] : [link.from, link.to];
    return {
      type: "network",
      player,
      cardId: candidates[0] ?? hand[0] ?? "",
      expectedVersion,
      links: [
        {
          linkIndex: link.linkIndex,
          coalSources:
            state.era === "rail" ? greedyCoal(state, endpoints, 1) : [],
        },
      ],
    };
  }

  // 3) 贷款。
  const loan = loanPreview(state, player);
  if (loan.allowed) {
    return { type: "loan", player, cardId: candidates[0] ?? hand[0] ?? "", expectedVersion };
  }

  // 4) 跳过（弃手牌第一张）。
  if (hand.length > 0) {
    return { type: "pass", player, cardId: hand[0]!, expectedVersion };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 资源来源贪心（与大厅陪玩 bot 同思路：就近私有矿/工场优先，市场兜底） */
/* ------------------------------------------------------------------ */

function greedyCoal(
  state: BrassState,
  atNodes: string[],
  n: number,
): Array<{ kind: "mine"; tileId: string } | { kind: "market" }> {
  const cands = coalCandidates(state, atNodes);
  const mines = cands
    .filter((c): c is Extract<typeof c, { kind: "mine" }> => c.kind === "mine")
    .sort((a, b) => a.distance - b.distance);
  const market = cands.find((c) => c.kind === "market");
  const sources: Array<{ kind: "mine"; tileId: string } | { kind: "market" }> = [];
  const avail = new Map<string, number>();
  for (let i = 0; i < n; i += 1) {
    let ok = false;
    for (const m of mines) {
      const left = avail.get(m.tileId) ?? m.available;
      if (left > 0) {
        avail.set(m.tileId, left - 1);
        sources.push({ kind: "mine", tileId: m.tileId });
        ok = true;
        break;
      }
    }
    if (!ok && market) {
      sources.push({ kind: "market" });
      ok = true;
    }
    if (!ok) return [];
  }
  return sources;
}

function greedyIron(
  state: BrassState,
  n: number,
): Array<{ kind: "works"; tileId: string } | { kind: "market" }> {
  const cands = ironCandidates(state);
  const works = cands.filter((c): c is Extract<typeof c, { kind: "works" }> => c.kind === "works");
  const market = cands.find((c) => c.kind === "market");
  const sources: Array<{ kind: "works"; tileId: string } | { kind: "market" }> = [];
  const avail = new Map<string, number>();
  for (let i = 0; i < n; i += 1) {
    let ok = false;
    for (const w of works) {
      const left = avail.get(w.tileId) ?? w.available;
      if (left > 0) {
        avail.set(w.tileId, left - 1);
        sources.push({ kind: "works", tileId: w.tileId });
        ok = true;
        break;
      }
    }
    if (!ok && market) {
      sources.push({ kind: "market" });
      ok = true;
    }
    if (!ok) return [];
  }
  return sources;
}
