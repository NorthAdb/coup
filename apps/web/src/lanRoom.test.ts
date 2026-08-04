import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseManualJoin } from "./lanRoom.ts";

describe("parseManualJoin", () => {
  it("accepts a full join link", () => {
    const parsed = parseManualJoin({
      joinLink: "http://192.168.1.42:8787/join?code=4821",
      address: "",
      code: "",
    });
    assert.deepEqual(parsed, {
      ok: true,
      origin: "http://192.168.1.42:8787",
      code: "4821",
    });
  });

  it("rejects code-only join", () => {
    const parsed = parseManualJoin({
      joinLink: "",
      address: "",
      code: "4821",
    });
    assert.equal(parsed.ok, false);
  });

  it("accepts address plus room code", () => {
    const parsed = parseManualJoin({
      joinLink: "",
      address: "192.168.1.42:8787",
      code: "4821",
    });
    assert.deepEqual(parsed, {
      ok: true,
      origin: "http://192.168.1.42:8787",
      code: "4821",
    });
  });
});
