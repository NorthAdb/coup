/**
 * 煤/铁市场。格位按价格升序排列（index 0 = £1）。
 * 不变量：方块总是占据「最贵端」的连续 n 格（index capacity-n .. capacity-1）。
 * 买：从最便宜有块格起（第 i 块 = index capacity-count+i）；市场空时兜底价。
 * 卖（仅建成当次行动）：填最贵的空格（第 i 块 = index capacity-1-count-i）；市场满则卖不进。
 * 买煤需连通任一商人位；买铁无需连通。
 */

export const COAL_MARKET_PRICES = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7] as const;
export const COAL_MARKET_CAPACITY = COAL_MARKET_PRICES.length; // 14
export const COAL_MARKET_INITIAL = 13;
export const COAL_FLOOR_PRICE = 8;

export const IRON_MARKET_PRICES = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5] as const;
export const IRON_MARKET_CAPACITY = IRON_MARKET_PRICES.length; // 10
export const IRON_MARKET_INITIAL = 8;
export const IRON_FLOOR_PRICE = 6;

/** 买 n 块的总价（市场现有 count 块；不足部分按兜底价）。 */
export function buyCost(prices: readonly number[], capacity: number, count: number, n: number, floorPrice: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) {
    const remaining = count - i;
    total += remaining > 0 ? prices[capacity - remaining] : floorPrice;
  }
  return total;
}

/** 卖 n 块的收入（填最贵空格；市场满的部分卖不进，不计价）。 */
export function sellRevenue(prices: readonly number[], capacity: number, count: number, n: number): number {
  const movable = Math.max(0, Math.min(n, capacity - count));
  let total = 0;
  for (let i = 0; i < movable; i++) {
    total += prices[capacity - 1 - count - i];
  }
  return total;
}

/** 卖出后实际进入市场的块数。 */
export function sellableCount(capacity: number, count: number, n: number): number {
  return Math.max(0, Math.min(n, capacity - count));
}

/** 单块买入价（第 i 块，0 起）。 */
export function buyPriceAt(prices: readonly number[], capacity: number, count: number, i: number, floorPrice: number): number {
  const remaining = count - i;
  return remaining > 0 ? prices[capacity - remaining] : floorPrice;
}
