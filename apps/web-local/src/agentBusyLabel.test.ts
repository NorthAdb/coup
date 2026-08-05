import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { agentBusyParts } from "./agentBusyLabel.ts";

describe("agentBusyParts", () => {
  it("names every pending seat while thinking", () => {
    assert.deepEqual(
      agentBusyParts("thinking", [
        { seatId: "seat-2", displayName: "灰狐" },
        { seatId: "seat-3", displayName: "白塔" },
      ]),
      [
        { type: "seat", seatId: "seat-2", text: "灰狐" },
        { type: "text", text: "、" },
        { type: "seat", seatId: "seat-3", text: "白塔" },
        { type: "text", text: " 思考中…" },
      ],
    );
  });

  it("falls back to Agent when seat is unknown", () => {
    assert.deepEqual(agentBusyParts("thinking", []), [
      { type: "text", text: "Agent 思考中…" },
    ]);
  });
});
