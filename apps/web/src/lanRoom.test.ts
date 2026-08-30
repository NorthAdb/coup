import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canStartLobby,
  lobbyStartBlockHint,
  matchCurrentPath,
  seatKindLabel,
} from "./lanRoom.ts";
import type { LobbySeat } from "./lanRoom.ts";

function seats(overrides: Array<Partial<LobbySeat> & { seatId: string }>) {
  return overrides.map((seat) => ({
    seatId: seat.seatId,
    kind: seat.kind ?? ("open" as const),
    displayName: seat.displayName ?? null,
    rematchStatus: seat.rematchStatus ?? null,
  }));
}

describe("lobbyStartBlockHint", () => {
  it("blocks start while open seats remain", () => {
    const hint = lobbyStartBlockHint(
      seats([
        { seatId: "1", kind: "local_human" },
        { seatId: "2", kind: "remote_human" },
        { seatId: "3", kind: "open" },
      ]),
    );
    assert.equal(hint, "还有 1 个空位：等朋友加入，或点座位上的「关闭」腾出局。");
  });

  it("blocks start when only the host is seated", () => {
    const hint = lobbyStartBlockHint(
      seats([
        { seatId: "1", kind: "local_human" },
        { seatId: "2", kind: "closed" },
      ]),
    );
    assert.equal(hint, "至少还需 1 名玩家入座才能开局。");
  });

  it("allows start with two humans and no open seats", () => {
    const hint = lobbyStartBlockHint(
      seats([
        { seatId: "1", kind: "local_human" },
        { seatId: "2", kind: "remote_human" },
        { seatId: "3", kind: "closed" },
      ]),
    );
    assert.equal(hint, null);
    assert.equal(
      canStartLobby([
        { seatId: "1", kind: "local_human", displayName: null },
        { seatId: "2", kind: "remote_human", displayName: null },
      ]),
      true,
    );
  });

  it("rematch gate reports awaiting and open seats separately", () => {
    const awaiting = seats([
      { seatId: "1", kind: "local_human" },
      { seatId: "2", kind: "remote_human", rematchStatus: "awaiting" },
      { seatId: "3", kind: "closed" },
    ]);
    assert.equal(
      lobbyStartBlockHint(awaiting, "rematch"),
      "还有 1 个座位等待确认加入",
    );

    const left = seats([
      { seatId: "1", kind: "local_human" },
      { seatId: "2", kind: "open", rematchStatus: "left" },
    ]);
    assert.equal(
      lobbyStartBlockHint(left, "rematch"),
      "座位 2 已开放，等待新人占座或由你关闭",
    );

    const ready = seats([
      { seatId: "1", kind: "local_human" },
      { seatId: "2", kind: "remote_human", rematchStatus: "confirmed" },
    ]);
    assert.equal(lobbyStartBlockHint(ready, "rematch"), null);
    assert.equal(canStartLobby(ready, "rematch"), true);
  });
});

describe("seatKindLabel", () => {
  it("labels every lobby seat kind", () => {
    assert.equal(seatKindLabel("local_human"), "房主");
    assert.equal(seatKindLabel("remote_human"), "已入座");
    assert.equal(seatKindLabel("open"), "空位 · 可加入");
    assert.equal(seatKindLabel("closed"), "已关闭");
  });
});

describe("matchCurrentPath", () => {
  it("scopes match reads and decisions to the current room", () => {
    assert.equal(matchCurrentPath("1234"), "/api/rooms/1234/matches/current");
    assert.equal(
      matchCurrentPath("1234", true),
      "/api/rooms/1234/matches/current/decision",
    );
  });

  it("appends since / spectate query params", () => {
    assert.equal(
      matchCurrentPath("1234", false, { since: 7 }),
      "/api/rooms/1234/matches/current?since=7",
    );
    assert.equal(
      matchCurrentPath("1234", false, { spectate: true }),
      "/api/rooms/1234/matches/current?spectate=1",
    );
    assert.equal(
      matchCurrentPath("1234", false, { since: 3, spectate: true }),
      "/api/rooms/1234/matches/current?since=3&spectate=1",
    );
  });

  it("rejects missing room codes before a match request can be sent", () => {
    assert.throws(() => matchCurrentPath(""), /room code is required/);
  });
});
