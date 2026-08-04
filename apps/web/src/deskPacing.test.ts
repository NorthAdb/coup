import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calloutHoldMs,
  cssSpeedFactor,
  DESK_PACE_STORAGE_KEY,
  DESK_SPEED,
  drawHoldMs,
  loadDeskPace,
  REDUCED_MOTION_SPEED,
  revealHoldMs,
  saveDeskPace,
  toggleDeskPace,
} from "./deskPacing.ts";

describe("desk pacing", () => {
  it("uses balanced and fast CSS speed multipliers", () => {
    assert.equal(cssSpeedFactor("balanced", false), DESK_SPEED.balanced);
    assert.equal(cssSpeedFactor("fast", false), DESK_SPEED.fast);
  });

  it("forces near-zero speed when reduced motion is preferred", () => {
    assert.equal(cssSpeedFactor("balanced", true), REDUCED_MOTION_SPEED);
    assert.equal(cssSpeedFactor("fast", true), REDUCED_MOTION_SPEED);
  });

  it("shortens reveal and draw holds in fast pace", () => {
    assert.ok(revealHoldMs("fast", false) < revealHoldMs("balanced", false));
    assert.ok(drawHoldMs("fast", false) < drawHoldMs("balanced", false));
  });

  it("skips reveal and draw holds under reduced motion", () => {
    assert.equal(revealHoldMs("balanced", true), 0);
    assert.equal(drawHoldMs("fast", true), 0);
  });

  it("keeps seat callouts readable (~4s balanced)", () => {
    assert.equal(calloutHoldMs("balanced", false), 4000);
    assert.ok(calloutHoldMs("fast", false) < 4000);
    assert.ok(calloutHoldMs("balanced", true) >= 1500);
  });

  it("toggles pace and persists preference", () => {
    assert.equal(toggleDeskPace("balanced"), "fast");
    assert.equal(toggleDeskPace("fast"), "balanced");

    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };

    saveDeskPace("fast", storage);
    assert.equal(store.get(DESK_PACE_STORAGE_KEY), "fast");
    assert.equal(loadDeskPace(storage), "fast");
    assert.equal(loadDeskPace({ getItem: () => "balanced" }), "balanced");
    assert.equal(loadDeskPace({ getItem: () => "nope" }), "balanced");
  });
});
