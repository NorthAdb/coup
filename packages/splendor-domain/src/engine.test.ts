import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALL_DEV_CARDS,
  applyCommand,
  canAfford,
  createMatch,
  LEVEL1_CARDS,
  LEVEL2_CARDS,
  LEVEL3_CARDS,
  planAutoDecision,
  projectForSeat,
  type SplendorPlayer,
  type SplendorState,
} from "./index.js";

function twoPlayer(): SplendorState {
  return createMatch({ matchId: "m-test", seed: "seed-1", playerCount: 2 });
}

function buyableCard(state: SplendorState, playerIndex: number) {
  for (const level of [1, 2, 3] as const) {
    for (let slot = 0; slot < 4; slot += 1) {
      const card = state.table[level][slot];
      if (card && canAfford(state.players[playerIndex]!, card)) {
        return { level, slot, card };
      }
    }
  }
  return null;
}

describe("splendor setup", () => {
  it("creates deterministic initial state with official deck sizes", () => {
    const a = twoPlayer();
    const b = createMatch({ matchId: "m-test", seed: "seed-1", playerCount: 2 });
    assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));

    assert.equal(LEVEL1_CARDS.length, 40);
    assert.equal(LEVEL2_CARDS.length, 30);
    assert.equal(LEVEL3_CARDS.length, 20);
    assert.equal(ALL_DEV_CARDS.length, 90);
    // 每级 4 张明牌，其余入牌库。
    assert.equal(a.deckCounts[1], 36);
    assert.equal(a.deckCounts[2], 26);
    assert.equal(a.deckCounts[3], 16);
    // 2 人局：每色 4 枚筹码 + 5 枚黄金；贵族 3 张。
    assert.deepEqual(Object.values(a.pool), [4, 4, 4, 4, 4]);
    assert.equal(a.gold, 5);
    assert.equal(a.nobles.length, 3);
    // 4 人局：每色 7 枚，贵族 5 张。
    const four = createMatch({ matchId: "m4", seed: "s", playerCount: 4 });
    assert.deepEqual(Object.values(four.pool), [7, 7, 7, 7, 7]);
    assert.equal(four.nobles.length, 5);
  });

  it("deals 4 face-up cards per level", () => {
    const state = twoPlayer();
    for (const level of [1, 2, 3] as const) {
      assert.equal(state.table[level].length, 4);
      assert.ok(state.table[level].every((card) => card !== null));
    }
  });
});

describe("splendor actions", () => {
  it("takes three different gems, bumps version and advances turn", () => {
    const state = twoPlayer();
    const gems = ["white", "blue", "green"] as const;
    const result = applyCommand(state, {
      type: "take_gems", player: 0, expectedVersion: state.stateVersion, gems: [...gems],
    });
    assert.ok(result.ok);
    assert.equal(result.state.stateVersion, 2);
    assert.equal(result.state.currentPlayer, 1);
    assert.equal(result.state.phase, "action");
    for (const color of gems) {
      assert.equal(result.state.players[0]!.gems[color], 1);
      assert.equal(result.state.pool[color], 3);
    }
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0]!.kind, "gems_taken");
  });

  it("rejects invalid gem takes", () => {
    const state = twoPlayer();
    // 3 个同色不合法。
    const dup = applyCommand(state, {
      type: "take_gems", player: 0, expectedVersion: 1, gems: ["white", "white", "white"],
    });
    assert.equal(dup.ok, false);
    // 2 同色但池中不足 4（2 人局每色恰 4 枚，先抽走 1 枚构造不足）。
    const drained = structuredClone(state);
    drained.pool.white = 3;
    const two = applyCommand(drained, {
      type: "take_gems", player: 0, expectedVersion: 1, gems: ["white", "white"],
    });
    assert.equal(two.ok, false);
    assert.equal((two as { reason: string }).reason, "two_same_requires_four");
    // 版本号不匹配。
    const stale = applyCommand(state, {
      type: "take_gems", player: 0, expectedVersion: 99, gems: ["white", "blue", "green"],
    });
    assert.equal((stale as { reason: string }).reason, "version_mismatch");
    // 不是你的回合。
    const wrong = applyCommand(state, {
      type: "take_gems", player: 1, expectedVersion: 1, gems: ["white", "blue", "green"],
    });
    assert.equal((wrong as { reason: string }).reason, "not_your_turn");
  });

  it("takes two same gems when pool has four", () => {
    const state = createMatch({ matchId: "m", seed: "seed-2", playerCount: 4 });
    const result = applyCommand(state, {
      type: "take_gems", player: 0, expectedVersion: 1, gems: ["black", "black"],
    });
    assert.ok(result.ok);
    assert.equal(result.state.players[0]!.gems.black, 2);
    assert.equal(result.state.pool.black, 5);
  });

  it("reserves a table card, takes gold and refills the slot", () => {
    const state = twoPlayer();
    const card = state.table[2][0]!;
    const goldBefore = state.gold;
    const result = applyCommand(state, {
      type: "reserve_table", player: 0, expectedVersion: 1, level: 2, slot: 0,
    });
    assert.ok(result.ok);
    const next = result.state;
    assert.deepEqual(next.players[0]!.reserved[0], card);
    assert.equal(next.players[0]!.gold, 1);
    assert.equal(next.gold, goldBefore - 1);
    // 明牌立即由同级牌库顶补位。
    assert.ok(next.table[2][0]);
    assert.notEqual(next.table[2][0]!.id, card.id);
    assert.equal(next.deckCounts[2], 25);
  });

  it("reserves blind from deck and caps reserved hand at three", () => {
    let s = twoPlayer();
    // 交替行动：0 盲留 → 1 拿宝石，共三轮。
    for (let i = 0; i < 3; i += 1) {
      const reserve = applyCommand(s, {
        type: "reserve_deck", player: 0, expectedVersion: s.stateVersion, level: 1,
      });
      assert.ok(reserve.ok);
      s = reserve.state;
      const take = applyCommand(s, {
        type: "take_gems", player: 1, expectedVersion: s.stateVersion,
        gems: ["white", "blue", "green"],
      });
      assert.ok(take.ok);
      s = take.state;
    }
    assert.equal(s.players[0]!.reserved.length, 3);
    assert.equal(s.deckCounts[1], 33);
    const fourth = applyCommand(s, {
      type: "reserve_deck", player: 0, expectedVersion: s.stateVersion, level: 1,
    });
    assert.equal(fourth.ok, false);
    assert.equal((fourth as { reason: string }).reason, "reserved_limit");
  });

  it("purchases with bonus discounts and gold covering shortfall", () => {
    const state = twoPlayer();
    // 人工构造：玩家几乎买得起，差 1 枚由黄金补。
    const target = state.table[1][0]!;
    const player = state.players[0] as SplendorPlayer;
    const cost = target.cost;
    for (const color of Object.keys(cost) as Array<keyof typeof cost>) {
      player.gems[color] = Math.max(0, cost[color] - 1);
    }
    player.gold = 1;
    const missing = (Object.keys(cost) as Array<keyof typeof cost>)
      .filter((color) => cost[color] > 0).length;
    if (missing > 1) {
      // 多色各差 1：加满黄金。
      player.gold = missing;
    }
    const result = applyCommand(state, {
      type: "purchase_table", player: 0, expectedVersion: 1, level: 1, slot: 0,
    });
    assert.ok(result.ok, JSON.stringify(result));
    const next = result.state;
    assert.equal(next.players[0]!.cards[target.color], 1);
    assert.equal(next.players[0]!.purchasedCount, 1);
    assert.equal(next.players[0]!.points, target.points);
    assert.ok(next.table[1][0]);
    assert.notEqual(next.table[1][0]!.id, target.id);
    const spent = result.events.find((e) => e.kind === "purchased");
    assert.ok(spent && spent.kind === "purchased");
  });

  it("rejects unaffordable purchases", () => {
    const state = twoPlayer();
    const result = applyCommand(state, {
      type: "purchase_table", player: 0, expectedVersion: 1, level: 1, slot: 0,
    });
    assert.equal(result.ok, false);
    assert.equal((result as { reason: string }).reason, "insufficient_payment");
  });

  it("purchases from reserved hand", () => {
    let state = twoPlayer();
    const reserved = applyCommand(state, {
      type: "reserve_table", player: 0, expectedVersion: 1, level: 1, slot: 0,
    });
    assert.ok(reserved.ok);
    state = reserved.state;
    // 轮到 1 号走过场，再回 0 号购买。
    const pass = applyCommand(state, {
      type: "take_gems", player: 1, expectedVersion: state.stateVersion,
      gems: ["blue", "green", "red"],
    });
    assert.ok(pass.ok);
    state = pass.state;
    const card = state.players[0]!.reserved[0]!;
    const player = state.players[0]!;
    const cost = card.cost;
    for (const color of Object.keys(cost) as Array<keyof typeof cost>) {
      player.gems[color] = cost[color];
    }
    const bought = applyCommand(state, {
      type: "purchase_reserved", player: 0, expectedVersion: state.stateVersion, cardId: card.id,
    });
    assert.ok(bought.ok, JSON.stringify(bought));
    assert.equal(bought.state.players[0]!.reserved.length, 0);
    assert.equal(bought.state.players[0]!.cards[card.color], 1);
    assert.equal(bought.events.filter((e) => e.kind === "purchased").length, 1);
  });
});

describe("splendor turn end", () => {
  it("forces discard when tokens exceed ten", () => {
    let state = twoPlayer();
    const player = state.players[0]!;
    // 直接构造超限：11 枚筹码。
    player.gems.white = 6;
    player.gems.blue = 5;
    // 先走一步合法行动（拿 3 散），收束时超限 → await_discard。
    // 为保证超限，先取走 3 枚：6+5+3=14 → 弃 4。
    const result = applyCommand(state, {
      type: "take_gems", player: 0, expectedVersion: 1, gems: ["green", "red", "black"],
    });
    assert.ok(result.ok);
    const next = result.state;
    assert.equal(next.phase, "await_discard");
    assert.equal(next.discardExcess, 0);
    assert.equal(next.currentPlayer, 0);

    const discard = applyCommand(next, {
      type: "discard_gems", player: 0, expectedVersion: next.stateVersion,
      gems: { white: 4, blue: 0, green: 0, red: 0, black: 0 },
    });
    assert.ok(discard.ok, JSON.stringify(discard));
    assert.equal(discard.state.phase, "action");
    assert.equal(discard.state.currentPlayer, 1);
    assert.equal(discard.state.players[0]!.gems.white, 2);
    assert.equal(discard.state.discardExcess, null);
  });

  it("rejects wrong discard amounts", () => {
    let state = twoPlayer();
    const player = state.players[0]!;
    player.gems.white = 6;
    player.gems.blue = 5;
    const result = applyCommand(state, {
      type: "take_gems", player: 0, expectedVersion: 1, gems: ["green", "red", "black"],
    });
    assert.ok(result.ok);
    state = result.state;
    const bad = applyCommand(state, {
      type: "discard_gems", player: 0, expectedVersion: state.stateVersion,
      gems: { white: 2, blue: 0, green: 0, red: 0, black: 0 },
    });
    assert.equal(bad.ok, false);
    assert.equal((bad as { reason: string }).reason, "invalid_discard");
  });
});

describe("splendor nobles", () => {
  function stateWithBonuses(bonuses: Partial<Record<"white" | "blue" | "green" | "red" | "black", number>>, nobleReq: Array<Partial<Record<"white" | "blue" | "green" | "red" | "black", number>>>): SplendorState {
    const state = twoPlayer();
    const player = state.players[0]!;
    for (const [color, n] of Object.entries(bonuses)) {
      player.cards[color as keyof typeof player.cards] = n ?? 0;
      player.purchasedCount += n ?? 0;
    }
    state.nobles = nobleReq.map((req, i) => ({
      id: `noble-x${i}`,
      name: `N${i}`,
      requirements: { white: 0, blue: 0, green: 0, red: 0, black: 0, ...req },
      points: 3,
    }));
    return state;
  }

  it("auto-grants when exactly one noble qualifies at end of turn", () => {
    const state = stateWithBonuses({ white: 3, black: 3 }, [{ white: 3, black: 3 }]);
    const result = applyCommand(state, {
      type: "take_gems", player: 0, expectedVersion: 1, gems: ["white", "blue", "green"],
    });
    assert.ok(result.ok);
    const next = result.state;
    assert.deepEqual(next.players[0]!.nobles, ["noble-x0"]);
    assert.equal(next.players[0]!.points, 3);
    assert.equal(next.nobles.length, 0);
    assert.equal(next.currentPlayer, 1);
    const nobleEvents = result.events.filter((e) => e.kind === "noble_visits");
    assert.equal(nobleEvents.length, 1);
  });

  it("asks for a choice when multiple nobles qualify", () => {
    const state = stateWithBonuses(
      { white: 3, black: 3, green: 3 },
      [{ white: 3, black: 3 }, { green: 3, black: 3, white: 3 }],
    );
    const result = applyCommand(state, {
      type: "take_gems", player: 0, expectedVersion: 1, gems: ["white", "blue", "red"],
    });
    assert.ok(result.ok);
    const next = result.state;
    assert.equal(next.phase, "await_noble");
    assert.equal(next.nobleChoice?.player, 0);
    assert.equal(next.nobleChoice?.candidates.length, 2);
    assert.equal(next.currentPlayer, 0);

    const chosen = applyCommand(next, {
      type: "choose_noble", player: 0, expectedVersion: next.stateVersion, nobleId: "noble-x1",
    });
    assert.ok(chosen.ok);
    assert.deepEqual(chosen.state.players[0]!.nobles, ["noble-x1"]);
    assert.equal(chosen.state.currentPlayer, 1);
    assert.equal(chosen.state.phase, "action");
  });
});

describe("splendor end game", () => {
  it("completes the final round and declares winner with tiebreak", () => {
    const state = twoPlayer();
    // 0 号 16 分、2 张卡；1 号 10 分 → 0 号行动后终局轮收束（1 号已在本轮行动过）。
    // 轮转：0 行动 → finalRound=true → 下一个是 1（≠触发者）继续 → 1 行动 → 下一个是 0（=触发者）→ 终局。
    state.players[0]!.points = 16;
    state.players[0]!.purchasedCount = 2;
    state.players[1]!.points = 10;
    state.players[1]!.purchasedCount = 4;

    const p0 = applyCommand(state, {
      type: "take_gems", player: 0, expectedVersion: 1, gems: ["white", "blue", "green"],
    });
    assert.ok(p0.ok);
    assert.equal(p0.state.finalRound, true);
    assert.equal(p0.state.endTriggerPlayer, 0);
    assert.equal(p0.state.status, "in_progress");

    const p1 = applyCommand(p0.state, {
      type: "take_gems", player: 1, expectedVersion: p0.state.stateVersion, gems: ["white", "blue", "green"],
    });
    assert.ok(p1.ok);
    assert.equal(p1.state.status, "finished");
    assert.deepEqual(p1.state.winners, [0]);
    const finish = p1.events.find((e) => e.kind === "match_finished");
    assert.ok(finish && finish.kind === "match_finished");
    assert.equal(finish.standings[0]!.player, 0);
  });

  it("breaks ties by fewest purchased cards", () => {
    const state = twoPlayer();
    state.players[0]!.points = 15;
    state.players[0]!.purchasedCount = 5;
    state.players[1]!.points = 15;
    state.players[1]!.purchasedCount = 3;

    const p0 = applyCommand(state, {
      type: "take_gems", player: 0, expectedVersion: 1, gems: ["white", "blue", "green"],
    });
    assert.ok(p0.ok);
    const p1 = applyCommand(p0.state, {
      type: "take_gems", player: 1, expectedVersion: p0.state.stateVersion, gems: ["white", "blue", "green"],
    });
    assert.ok(p1.ok);
    assert.equal(p1.state.status, "finished");
    assert.deepEqual(p1.state.winners, [1]);
  });
});

describe("splendor auto plan", () => {
  it("plans discard first, then gems, then reserve", () => {
    const state = twoPlayer();
    // 正常回合：拿 3 散。
    const normal = planAutoDecision(state, 0, state.stateVersion);
    assert.ok(normal && normal.type === "take_gems");
    assert.equal(normal.gems.length, 3);

    // 没有宝石可拿 → 买得起就买，否则预留明牌。
    const drained = structuredClone(state);
    drained.pool = { white: 0, blue: 0, green: 0, red: 0, black: 0 };
    const plan = planAutoDecision(drained, 0, drained.stateVersion);
    assert.ok(plan);
    assert.ok(["purchase_table", "reserve_table"].includes(plan.type));

    // 弃筹码优先。
    const discarding = structuredClone(state);
    discarding.phase = "await_discard";
    discarding.discardExcess = 0;
    discarding.players[0]!.gems.white = 8;
    discarding.players[0]!.gems.blue = 4;
    const discardPlan = planAutoDecision(discarding, 0, discarding.stateVersion);
    assert.ok(discardPlan && discardPlan.type === "discard_gems");
    const sum = Object.values(discardPlan.gems).reduce((a, b) => a + b, 0);
    assert.equal(sum, 2);
  });
});

describe("splendor projection", () => {
  it("hides other players' reserved cards but keeps counts", () => {
    let state = twoPlayer();
    const reserve = applyCommand(state, {
      type: "reserve_table", player: 0, expectedVersion: 1, level: 3, slot: 0,
    });
    assert.ok(reserve.ok);
    state = reserve.state;

    const own = projectForSeat(state, 0);
    assert.equal(own.yourReserved!.length, 1);
    assert.equal("reserved" in own.state.players[1]!, false);
    assert.deepEqual(own.reservedCounts, [1, 0]);

    const other = projectForSeat(state, 1);
    assert.equal(other.yourReserved!.length, 0);

    const spectator = projectForSeat(state, null);
    assert.equal(spectator.yourReserved, null);
    assert.deepEqual(spectator.reservedCounts, [1, 0]);
    // 投影不泄露牌库。
    assert.equal((spectator.state as unknown as { decks?: unknown }).decks, undefined);
  });
});
