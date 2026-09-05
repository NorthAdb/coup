/**
 * 收入轨（0–99 格，等级 −10..30）。
 * 格 0–10 = 等级 −10..0（每级 1 格）；11–30 = +1..+10（每级 2 格）；
 * 31–60 = +11..+20（每级 3 格）；61–96 = +21..+29（每级 4 格）；97–99 = +30。
 */

export const INCOME_MIN_LEVEL = -10;
export const INCOME_MAX_LEVEL = 30;
export const INCOME_START_SPACE = 10;

export function incomeLevelAt(space: number): number {
  if (space < 0 || space > 99) throw new RangeError(`income space out of range: ${space}`);
  if (space <= 10) return space - 10;
  if (space <= 30) return 1 + Math.floor((space - 11) / 2);
  if (space <= 60) return 11 + Math.floor((space - 31) / 3);
  if (space <= 96) return 21 + Math.floor((space - 61) / 4);
  return 30;
}

/** 某收入等级占据的最高格（贷款落到新等级最高格）。 */
export function highestSpaceOfLevel(level: number): number {
  if (level < INCOME_MIN_LEVEL || level > INCOME_MAX_LEVEL) throw new RangeError(`income level out of range: ${level}`);
  if (level <= 0) return level + 10;
  if (level <= 10) return 10 + 2 * level;
  if (level <= 20) return 30 + 3 * (level - 10);
  if (level <= 29) return 60 + 4 * (level - 20);
  return 99;
}

/** 前进 n 格，封顶收入等级 30。 */
export function advanceIncome(space: number, n: number): number {
  const next = Math.min(99, space + Math.max(0, n));
  return next;
}
