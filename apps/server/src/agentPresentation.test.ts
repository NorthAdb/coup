import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  announcementEventForSeat,
  presentationHoldMs,
} from "./agentPresentation.js";

describe("announcementEventForSeat", () => {
  it("picks the latest public decision for that seat", () => {
    const event = announcementEventForSeat(
      [
        {
          type: "action_declared",
          seatId: "seat-1",
          actionType: "tax",
        },
        {
          type: "response_passed",
          seatId: "seat-2",
          responseType: "challenge",
        },
        {
          type: "challenge_declared",
          seatId: "seat-3",
          againstSeatId: "seat-1",
        },
      ],
      "seat-2",
    );
    assert.equal(event?.type, "response_passed");
  });
});

describe("presentationHoldMs", () => {
  it("holds challenge and pass-challenge about 3 seconds", () => {
    assert.equal(
      presentationHoldMs({
        type: "challenge_declared",
        seatId: "seat-2",
        againstSeatId: "seat-1",
      }),
      3000,
    );
    assert.equal(
      presentationHoldMs({
        type: "response_passed",
        seatId: "seat-2",
        responseType: "challenge",
      }),
      3000,
    );
  });
});
