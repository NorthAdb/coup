/** How many cards the exchanging seat must keep (always return exactly two). */
export function keepCountNeeded(handSize: number): number {
  return Math.max(0, handSize - 2);
}

/** Derive the two court-return ids from the cards the player chose to keep. */
export function returnCardIdsFromKeep(
  handCardIds: readonly string[],
  keepCardIds: readonly string[],
): [string, string] {
  const keep = new Set(keepCardIds);
  const returned = handCardIds.filter((id) => !keep.has(id));
  if (returned.length !== 2) {
    throw new Error("exchange must return exactly two cards");
  }
  return [returned[0]!, returned[1]!];
}

/** Toggle a keep selection, capping at keepNeeded (drop oldest when full). */
export function toggleKeepSelection(
  current: readonly string[],
  cardId: string,
  keepNeeded: number,
): string[] {
  if (current.includes(cardId)) {
    return current.filter((id) => id !== cardId);
  }
  if (keepNeeded <= 0) return [...current];
  if (current.length < keepNeeded) {
    return [...current, cardId];
  }
  return [...current.slice(1), cardId];
}

/** Confirmation-bar copy for kept character labels. */
export function exchangeKeepSummary(keptLabels: readonly string[]): string {
  if (keptLabels.length === 0) return "选择要保留的影响力";
  if (keptLabels.length === 1) return `保留 ${keptLabels[0]}`;
  return `保留 ${keptLabels[0]} 与 ${keptLabels[1]}`;
}
