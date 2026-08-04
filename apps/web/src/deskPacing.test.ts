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

  it("holds identity reveals ~5s on balanced and ~2.5s on fast", () => {
    assert.equal(revealHoldMs("balanced", false), 5000);
    assert.equal(revealHoldMs("fast", false), 2500);
    assert.ok(drawHoldMs("fast", false) < drawHoldMs("balanced", false));
  });

  it("keeps identity reveals readable under reduced motion", () => {
    assert.equal(revealHoldMs("balanced", true), 5000);
    assert.equal(revealHoldMs("fast", true), 2500);
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
