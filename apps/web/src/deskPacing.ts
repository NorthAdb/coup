export type DeskPace = "balanced" | "fast";

export const DESK_PACE_STORAGE_KEY = "coup.deskPace";

/** CSS `--speed` multipliers (prototype: balanced 1, fast 0.45). */
export const DESK_SPEED: Record<DeskPace, number> = {
  balanced: 1,
  fast: 0.45,
};

/** Near-zero multiplier when the user prefers reduced motion. */
export const REDUCED_MOTION_SPEED = 0.01;

export function cssSpeedFactor(
  pace: DeskPace,
  prefersReducedMotion: boolean,
): number {
  if (prefersReducedMotion) {
    return REDUCED_MOTION_SPEED;
  }
  return DESK_SPEED[pace];
}

/** Hold time for the challenge reveal overlay (ms). */
export function revealHoldMs(
  pace: DeskPace,
  prefersReducedMotion: boolean,
): number {
  if (prefersReducedMotion) {
    return 0;
  }
  return pace === "fast" ? 420 : 820;
}

/** Hold time for the post-prove shuffle/draw beat (ms). */
export function drawHoldMs(
  pace: DeskPace,
  prefersReducedMotion: boolean,
): number {
  if (prefersReducedMotion) {
    return 0;
  }
  return pace === "fast" ? 330 : 760;
}

/** Hold time for seat callouts (ms). Always readable; reduced motion keeps text. */
export function calloutHoldMs(
  pace: DeskPace,
  prefersReducedMotion: boolean,
): number {
  if (prefersReducedMotion) {
    return 2500;
  }
  return pace === "fast" ? 2200 : 4000;
}

export function loadDeskPace(
  storage: Pick<Storage, "getItem"> | null = null,
): DeskPace {
  try {
    const raw = (storage ?? globalThis.localStorage)?.getItem(
      DESK_PACE_STORAGE_KEY,
    );
    return raw === "fast" ? "fast" : "balanced";
  } catch {
    return "balanced";
  }
}

export function saveDeskPace(
  pace: DeskPace,
  storage: Pick<Storage, "setItem"> | null = null,
): void {
  try {
    (storage ?? globalThis.localStorage)?.setItem(DESK_PACE_STORAGE_KEY, pace);
  } catch {
    // ignore quota / private mode
  }
}

export function toggleDeskPace(pace: DeskPace): DeskPace {
  return pace === "balanced" ? "fast" : "balanced";
}
