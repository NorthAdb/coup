import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  exchangeKeepSummary,
  keepCountNeeded,
  returnCardIdsFromKeep,
  toggleKeepSelection,
} from "./exchangeKeep.js";

describe("keepCountNeeded", () => {
  it("keeps two from a four-card exchange hand", () => {
    assert.equal(keepCountNeeded(4), 2);
  });

  it("keeps one from a three-card hand when one influence remains", () => {
    assert.equal(keepCountNeeded(3), 1);
  });
});

describe("returnCardIdsFromKeep", () => {
  it("maps kept cards to the two returned court ids", () => {
    const hand = ["a", "b", "c", "d"];
    const returned = returnCardIdsFromKeep(hand, ["b", "d"]);
    assert.deepEqual(returned, ["a", "c"]);
  });
});

describe("toggleKeepSelection", () => {
  it("selects up to the keep quota then replaces the oldest", () => {
    let selected = toggleKeepSelection([], "a", 2);
    assert.deepEqual(selected, ["a"]);
    selected = toggleKeepSelection(selected, "b", 2);
    assert.deepEqual(selected, ["a", "b"]);
    selected = toggleKeepSelection(selected, "c", 2);
    assert.deepEqual(selected, ["b", "c"]);
    selected = toggleKeepSelection(selected, "b", 2);
    assert.deepEqual(selected, ["c"]);
  });
});

describe("exchangeKeepSummary", () => {
  it("names the kept characters for the confirmation bar", () => {
    assert.equal(
      exchangeKeepSummary(["刺客", "队长"]),
      "保留 刺客 与 队长",
    );
    assert.equal(exchangeKeepSummary(["大使"]), "保留 大使");
  });
});
