import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultAgentDisplayName,
  parseMatchSetup,
} from "./matchSetup.js";

describe("match setup parse", () => {
  it("accepts 2–6 seats with local human first and stub agents after", () => {
    const result = parseMatchSetup({
      seats: [
        {
          seatId: "seat-1",
          controller: "local_human",
          displayName: "你",
        },
        {
          seatId: "seat-2",
          controller: "stub_agent",
          displayName: "灰狐",
          cli: "opencode",
          modelId: "opencode/placeholder",
        },
        {
          seatId: "seat-3",
          controller: "stub_agent",
          displayName: "白塔",
          cli: "claude",
          modelId: "claude/placeholder",
        },
      ],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.setup.seats.length, 3);
    assert.equal(result.setup.seats[0]?.controller, "local_human");
    assert.equal(result.setup.seats[1]?.displayName, "灰狐");
    assert.equal(result.setup.seats[2]?.cli, "claude");
  });

  it("rejects seat count outside 2–6", () => {
    const alone = parseMatchSetup({
      seats: [
        {
          seatId: "seat-1",
          controller: "local_human",
          displayName: "你",
        },
      ],
    });
    assert.equal(alone.ok, false);
    if (alone.ok) return;
    assert.equal(alone.reason, "seat_count_out_of_range");
  });

  it("rejects non-human first seat", () => {
    const result = parseMatchSetup({
      seats: [
        {
          seatId: "seat-1",
          controller: "stub_agent",
          displayName: "灰狐",
        },
        {
          seatId: "seat-2",
          controller: "local_human",
          displayName: "你",
        },
      ],
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "first_seat_must_be_local_human");
  });

  it("assigns stable agent display names by clockwise agent index", () => {
    assert.equal(defaultAgentDisplayName(0), "灰狐");
    assert.equal(defaultAgentDisplayName(1), "白塔");
    assert.equal(defaultAgentDisplayName(4), "赤砂");
  });
});
