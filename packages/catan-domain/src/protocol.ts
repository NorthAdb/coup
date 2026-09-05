/**
 * 卡坦岛命令协议：把原子命令应用到权威态（联机服务端通路）。
 * 校验失败返回 ok:false（不抛错）；状态克隆由引擎各动作自行处理。
 */

import {
  bankTrade,
  buildCity,
  buildRoad,
  buildSettlement,
  buyDev,
  cancelTrade,
  endRobberMove,
  endTurn,
  moveRobber,
  playDev,
  proposeTrade,
  respondTrade,
  rollDice,
  steal,
} from "./engine.js";
import type {
  CatanApplyResult,
  CatanCommand,
  CatanGame,
  GameEvent,
  ResourceCount,
} from "./types.js";

/** 轮次绑定命令：player 必须是当前行动玩家。 */
const TURN_BOUND = new Set([
  "roll",
  "build_road",
  "build_settlement",
  "build_city",
  "buy_dev",
  "play_dev",
  "move_robber",
  "steal",
  "end_robber_move",
  "propose_trade",
  "cancel_trade",
  "bank_trade",
  "end_turn",
]);

function fullCount(partial: Partial<ResourceCount> | undefined): Partial<ResourceCount> {
  return partial ?? {};
}

export function applyCommand(g: CatanGame, command: CatanCommand): CatanApplyResult {
  if (!command || typeof command !== "object" || typeof (command as { type?: unknown }).type !== "string") {
    return { ok: false, code: "invalid_command" };
  }
  if (typeof command.player !== "number" || !Number.isInteger(command.player)) {
    return { ok: false, code: "invalid_command" };
  }
  if (g.status !== "in_progress") return { ok: false, code: "match_over" };

  // 座位归属：轮次绑定命令只认当前玩家；交易回应/撤回认提议双方。
  if (command.type === "respond_trade") {
    if (!g.pendingTrade || command.player !== g.pendingTrade.to) {
      return { ok: false, code: "not_trade_partner" };
    }
  } else if (command.type === "cancel_trade") {
    if (!g.pendingTrade || command.player !== g.pendingTrade.from) {
      return { ok: false, code: "not_trade_owner" };
    }
  } else if (TURN_BOUND.has(command.type)) {
    if (command.player !== g.turn) return { ok: false, code: "not_your_turn" };
  }

  let result: { ok: true; game: CatanGame; events: GameEvent[] } | { ok: false; code: string };
  switch (command.type) {
    case "roll":
      result = rollDice(g);
      break;
    case "build_road":
      result = buildRoad(g, command.player, command.edgeId, { free: command.free });
      break;
    case "build_settlement":
      result = buildSettlement(g, command.player, command.vertexId);
      break;
    case "build_city":
      result = buildCity(g, command.player, command.vertexId);
      break;
    case "buy_dev":
      result = buyDev(g, command.player);
      break;
    case "play_dev":
      result = playDev(g, command.player, command.card, { picks: command.picks, resource: command.resource });
      break;
    case "move_robber":
      result = moveRobber(g, command.player, command.tileId);
      break;
    case "steal":
      result = steal(g, command.player, command.victim);
      break;
    case "end_robber_move":
      result = endRobberMove(g);
      break;
    case "propose_trade":
      result = proposeTrade(g, command.player, fullCount(command.give), fullCount(command.want), command.to);
      break;
    case "respond_trade":
      result = respondTrade(g, command.accept);
      break;
    case "cancel_trade":
      result = cancelTrade(g);
      break;
    case "bank_trade":
      result = bankTrade(g, command.player, command.give, command.want);
      break;
    case "end_turn":
      result = endTurn(g);
      break;
    default:
      return { ok: false, code: "invalid_command" };
  }
  if (!result.ok) return result;
  return { ok: true, state: result.game, events: result.events };
}
