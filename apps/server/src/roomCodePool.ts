/**
 * 跨游戏共享的房间码池：coup 与 brass 的房间码都从这里登记，
 * 两个 registry 分配新码时都参考同一占用集，避免 4 位码跨游戏冲突。
 * 代码本身仍由各 registry 通过 allocateRoomCode 生成。
 */

const claimed = new Set<string>();

export function claimRoomCode(code: string): void {
  claimed.add(code);
}

export function allClaimedCodes(): string[] {
  return [...claimed];
}
