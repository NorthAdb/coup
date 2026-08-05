import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCreateRoomUrl, copyText, parseManualJoin } from "./lanRoom.ts";

describe("copyText", () => {
  it("uses the browser clipboard when it is available", async () => {
    const previous = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    let copied = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          copied = value;
        },
      },
    });

    try {
      assert.equal(await copyText("http://example.test/join?code=1234"), true);
      assert.equal(copied, "http://example.test/join?code=1234");
    } finally {
      if (previous) {
        Object.defineProperty(navigator, "clipboard", previous);
      } else {
        Reflect.deleteProperty(navigator, "clipboard");
      }
    }
  });
});

describe("buildCreateRoomUrl", () => {
  it("carries the create intent across origins", () => {
    assert.equal(
      buildCreateRoomUrl("http://192.168.1.42:8787"),
      "http://192.168.1.42:8787/?createRoom=1",
    );
  });
});

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
