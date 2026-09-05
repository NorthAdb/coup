import type { DevCard, GemCount, Noble } from "../types.js";

/**
 * 官方基础版牌表：90 张发展卡（40/30/20）+ 10 张贵族，贵族各 3 分。
 * 发展卡经两个独立开源数据集交叉核对完全一致
 * （bouk/splendimax 与 seal256/splendor，两者列序互异但数据相同）。
 * 贵族官方构成为 5 张 4+4 + 5 张 3+3+3（无 3+3 型），取自 boardgamers/splendor
 * 并经 BGG/Fandom 资料核验。
 * cost 元组顺序统一为 [white, blue, green, red, black]。
 */

type CostTuple = [number, number, number, number, number];

function card(
  level: 1 | 2 | 3,
  index: number,
  color: DevCard["color"],
  points: number,
  [white, blue, green, red, black]: CostTuple,
): DevCard {
  const cost = { white, blue, green, red, black } as GemCount;
  return { id: `c${level}-${index}`, level, color, points, cost };
}

/** 一级发展卡 40 张。 */
export const LEVEL1_CARDS: DevCard[] = [
  card(1, 1, "black", 0, [1, 1, 1, 1, 0]),
  card(1, 2, "black", 0, [1, 2, 1, 1, 0]),
  card(1, 3, "black", 0, [2, 2, 0, 1, 0]),
  card(1, 4, "black", 0, [0, 0, 1, 3, 1]),
  card(1, 5, "black", 0, [0, 0, 2, 1, 0]),
  card(1, 6, "black", 0, [2, 0, 2, 0, 0]),
  card(1, 7, "black", 0, [0, 0, 3, 0, 0]),
  card(1, 8, "black", 1, [0, 4, 0, 0, 0]),
  card(1, 9, "blue", 0, [1, 0, 1, 1, 1]),
  card(1, 10, "blue", 0, [1, 0, 1, 2, 1]),
  card(1, 11, "blue", 0, [1, 0, 2, 2, 0]),
  card(1, 12, "blue", 0, [0, 1, 3, 1, 0]),
  card(1, 13, "blue", 0, [1, 0, 0, 0, 2]),
  card(1, 14, "blue", 0, [0, 0, 2, 0, 2]),
  card(1, 15, "blue", 0, [0, 0, 0, 0, 3]),
  card(1, 16, "blue", 1, [0, 0, 0, 4, 0]),
  card(1, 17, "white", 0, [0, 1, 1, 1, 1]),
  card(1, 18, "white", 0, [0, 1, 2, 1, 1]),
  card(1, 19, "white", 0, [0, 2, 2, 0, 1]),
  card(1, 20, "white", 0, [3, 1, 0, 0, 1]),
  card(1, 21, "white", 0, [0, 0, 0, 2, 1]),
  card(1, 22, "white", 0, [0, 2, 0, 0, 2]),
  card(1, 23, "white", 0, [0, 3, 0, 0, 0]),
  card(1, 24, "white", 1, [0, 0, 4, 0, 0]),
  card(1, 25, "green", 0, [1, 1, 0, 1, 1]),
  card(1, 26, "green", 0, [1, 1, 0, 1, 2]),
  card(1, 27, "green", 0, [0, 1, 0, 2, 2]),
  card(1, 28, "green", 0, [1, 3, 1, 0, 0]),
  card(1, 29, "green", 0, [2, 1, 0, 0, 0]),
  card(1, 30, "green", 0, [0, 2, 0, 2, 0]),
  card(1, 31, "green", 0, [0, 0, 0, 3, 0]),
  card(1, 32, "green", 1, [0, 0, 0, 0, 4]),
  card(1, 33, "red", 0, [1, 1, 1, 0, 1]),
  card(1, 34, "red", 0, [2, 1, 1, 0, 1]),
  card(1, 35, "red", 0, [2, 0, 1, 0, 2]),
  card(1, 36, "red", 0, [1, 0, 0, 1, 3]),
  card(1, 37, "red", 0, [0, 2, 1, 0, 0]),
  card(1, 38, "red", 0, [2, 0, 0, 2, 0]),
  card(1, 39, "red", 0, [3, 0, 0, 0, 0]),
  card(1, 40, "red", 1, [4, 0, 0, 0, 0]),
];

/** 二级发展卡 30 张。 */
export const LEVEL2_CARDS: DevCard[] = [
  card(2, 1, "black", 1, [3, 2, 2, 0, 0]),
  card(2, 2, "black", 1, [3, 0, 3, 0, 2]),
  card(2, 3, "black", 2, [0, 1, 4, 2, 0]),
  card(2, 4, "black", 2, [0, 0, 5, 3, 0]),
  card(2, 5, "black", 2, [5, 0, 0, 0, 0]),
  card(2, 6, "black", 3, [0, 0, 0, 0, 6]),
  card(2, 7, "blue", 1, [0, 2, 2, 3, 0]),
  card(2, 8, "blue", 1, [0, 2, 3, 0, 3]),
  card(2, 9, "blue", 2, [5, 3, 0, 0, 0]),
  card(2, 10, "blue", 2, [2, 0, 0, 1, 4]),
  card(2, 11, "blue", 2, [0, 5, 0, 0, 0]),
  card(2, 12, "blue", 3, [0, 6, 0, 0, 0]),
  card(2, 13, "white", 1, [0, 0, 3, 2, 2]),
  card(2, 14, "white", 1, [2, 3, 0, 3, 0]),
  card(2, 15, "white", 2, [0, 0, 1, 4, 2]),
  card(2, 16, "white", 2, [0, 0, 0, 5, 3]),
  card(2, 17, "white", 2, [0, 0, 0, 5, 0]),
  card(2, 18, "white", 3, [6, 0, 0, 0, 0]),
  card(2, 19, "green", 1, [3, 0, 2, 3, 0]),
  card(2, 20, "green", 1, [2, 3, 0, 0, 2]),
  card(2, 21, "green", 2, [4, 2, 0, 0, 1]),
  card(2, 22, "green", 2, [0, 5, 3, 0, 0]),
  card(2, 23, "green", 2, [0, 0, 5, 0, 0]),
  card(2, 24, "green", 3, [0, 0, 6, 0, 0]),
  card(2, 25, "red", 1, [2, 0, 0, 2, 3]),
  card(2, 26, "red", 1, [0, 3, 0, 2, 3]),
  card(2, 27, "red", 2, [1, 4, 2, 0, 0]),
  card(2, 28, "red", 2, [3, 0, 0, 0, 5]),
  card(2, 29, "red", 2, [0, 0, 0, 0, 5]),
  card(2, 30, "red", 3, [0, 0, 0, 6, 0]),
];

/** 三级发展卡 20 张。 */
export const LEVEL3_CARDS: DevCard[] = [
  card(3, 1, "black", 3, [3, 3, 5, 3, 0]),
  card(3, 2, "black", 4, [0, 0, 0, 7, 0]),
  card(3, 3, "black", 4, [0, 0, 3, 6, 3]),
  card(3, 4, "black", 5, [0, 0, 0, 7, 3]),
  card(3, 5, "blue", 3, [3, 0, 3, 3, 5]),
  card(3, 6, "blue", 4, [7, 0, 0, 0, 0]),
  card(3, 7, "blue", 4, [6, 3, 0, 0, 3]),
  card(3, 8, "blue", 5, [7, 3, 0, 0, 0]),
  card(3, 9, "white", 3, [0, 3, 3, 5, 3]),
  card(3, 10, "white", 4, [0, 0, 0, 0, 7]),
  card(3, 11, "white", 4, [3, 0, 0, 3, 6]),
  card(3, 12, "white", 5, [3, 0, 0, 0, 7]),
  card(3, 13, "green", 3, [5, 3, 0, 3, 3]),
  card(3, 14, "green", 4, [0, 7, 0, 0, 0]),
  card(3, 15, "green", 4, [3, 6, 3, 0, 0]),
  card(3, 16, "green", 5, [0, 7, 3, 0, 0]),
  card(3, 17, "red", 3, [3, 5, 3, 0, 3]),
  card(3, 18, "red", 4, [0, 0, 7, 0, 0]),
  card(3, 19, "red", 4, [0, 3, 6, 3, 0]),
  card(3, 20, "red", 5, [0, 0, 7, 3, 0]),
];

export const ALL_DEV_CARDS: DevCard[] = [...LEVEL1_CARDS, ...LEVEL2_CARDS, ...LEVEL3_CARDS];

/** 全部 10 张贵族（官方：5 张 4+4 + 5 张 3+3+3，各 3 分）。 */
export const ALL_NOBLES: Noble[] = [
  { id: "noble-1", name: "Mary Stuart", requirements: { white: 0, blue: 0, green: 4, red: 4, black: 0 }, points: 3 },
  { id: "noble-2", name: "Charles V", requirements: { white: 0, blue: 4, green: 4, red: 0, black: 0 }, points: 3 },
  { id: "noble-3", name: "Machiavelli", requirements: { white: 4, blue: 4, green: 0, red: 0, black: 0 }, points: 3 },
  { id: "noble-4", name: "Isabella of Castile", requirements: { white: 4, blue: 0, green: 0, red: 0, black: 4 }, points: 3 },
  { id: "noble-5", name: "Suleiman the Magnificent", requirements: { white: 0, blue: 0, green: 0, red: 4, black: 4 }, points: 3 },
  { id: "noble-6", name: "Catherine de' Medici", requirements: { white: 0, blue: 3, green: 3, red: 3, black: 0 }, points: 3 },
  { id: "noble-7", name: "Anne of Brittany", requirements: { white: 3, blue: 0, green: 3, red: 3, black: 0 }, points: 3 },
  { id: "noble-8", name: "Henry VIII", requirements: { white: 3, blue: 3, green: 0, red: 0, black: 3 }, points: 3 },
  { id: "noble-9", name: "Elisabeth of Austria", requirements: { white: 0, blue: 0, green: 3, red: 3, black: 3 }, points: 3 },
  { id: "noble-10", name: "Francis I of France", requirements: { white: 3, blue: 3, green: 3, red: 0, black: 0 }, points: 3 },
];
