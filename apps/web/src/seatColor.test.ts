import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  seatTintClass,
  seatTintClassForId,
  SEAT_TINT_COUNT,
} from "./seatColor.ts";

describe("seatTintClass", () => {
  it("assigns a stable class by seat order for up to six seats", () => {
    assert.equal(seatTintClass(0), "seat-tint-0");
    assert.equal(seatTintClass(1), "seat-tint-1");
    assert.equal(seatTintClass(5), "seat-tint-5");
    assert.equal(SEAT_TINT_COUNT, 6);
  });

  it("wraps beyond the palette without changing earlier seats", () => {
    assert.equal(seatTintClass(6), "seat-tint-0");
    assert.equal(seatTintClass(-1), "seat-tint-5");
  });
});

describe("seatTintClassForId", () => {
  it("looks up tint by seat id in table order", () => {
    const seats = [
      { seatId: "seat-a" },
      { seatId: "seat-b" },
      { seatId: "seat-c" },
    ];
    assert.equal(seatTintClassForId(seats, "seat-b"), "seat-tint-1");
    assert.equal(seatTintClassForId(seats, "missing"), "seat-tint-0");
  });
});
