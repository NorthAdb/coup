import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allocateRoomCode,
  buildJoinUrl,
  isValidRoomCode,
  parseJoinSearch,
} from "./roomInvite.js";

describe("roomInvite", () => {
  it("allocates a 4-digit numeric room code not in the taken set", () => {
    const taken = new Set(["0000", "1234", "9999"]);
    const code = allocateRoomCode(taken, () => 0.5);
    assert.equal(code.length, 4);
    assert.match(code, /^\d{4}$/);
    assert.equal(taken.has(code), false);
  });

  it("builds a join URL with lan ipv4, port, and code", () => {
    assert.equal(
      buildJoinUrl({ host: "192.168.1.42", port: 8787, code: "4821" }),
      "http://192.168.1.42:8787/join?code=4821",
    );
  });

  it("accepts only 4-digit codes", () => {
    assert.equal(isValidRoomCode("4821"), true);
    assert.equal(isValidRoomCode("482"), false);
    assert.equal(isValidRoomCode("482a"), false);
  });

  it("parses join search for code and rejects code-only join intent without host", () => {
    assert.deepEqual(parseJoinSearch("?code=4821"), {
      code: "4821",
      ok: true,
    });
    assert.deepEqual(parseJoinSearch("?code=12"), {
      code: null,
      ok: false,
      reason: "invalid_room_code",
    });
  });
});
