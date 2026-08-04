/**
 * The three questions a night's replacement history has to answer.
 *
 * 🧨 EXTRACTED BECAUSE ALL THREE SHIPPED WRONG, TWICE, AND GREEN. They lived in
 * `plan-flow.tsx`, where this framework-free suite cannot reach them:
 *
 *   • the history was signed with the night's CURRENT stops, which move when a
 *     stop is replaced — so nothing written was ever readable again;
 *   • "can I undo?" was answered by comparing the night to its base, and after
 *     a refresh the stored night IS the base, so a full history rendered no
 *     button;
 *   • "how many stops has the user changed?" used the same comparison, so a
 *     restored night reported zero and "Try another combination" skipped the
 *     confirmation that exists to protect exactly that work.
 *
 * The store's own round-trip tests passed throughout, because they were handed
 * a signature rather than deriving one. Same lesson as lib/plan-cycle.ts: what
 * decides what the user gets does not belong inside a React handler.
 */

/** A stop, reduced to what these answers depend on. */
export type HistoryStop = { venue: { id: string } };

/** One arrangement in the history, tagged with the night it belongs to. */
export type HistoryEntry<K> = { key: K; stops: HistoryStop[] };

/** Only this night's entries. A stack can hold a previous night's while the
 *  screen changes underneath it. */
export function entriesFor<K, T extends { key: K }>(stack: T[], key: K): T[] {
  // Generic over the ENTRY, not just its key: callers hold richer entries
  // (stops plus the per-stop cycle) and narrowing them here would strip the
  // rest back off at every call site.
  return stack.filter((e) => e.key === key);
}

/**
 * The night as it STARTED, as far as the history can tell.
 *
 * Not the base: the active-plan store holds what is on screen, so after a
 * refresh a night's base is its replaced arrangement. The deepest history
 * entry is the arrangement before the first replacement.
 *
 * 🧨 "By construction" only holds while nothing moves that entry, and two
 * things do: undo POPS, and the caller caps the stack from the front. So the
 * caller pins the original separately and passes it as the fallback here —
 * this answers from the history when it has one and defers otherwise. Do not
 * re-derive the original from this alone.
 */
export function originalStops<K>(
  mine: HistoryEntry<K>[],
  baseStops: HistoryStop[],
): HistoryStop[] {
  return mine.length > 0 ? mine[0].stops : baseStops;
}

/** How many stops differ from the night's original arrangement. */
export function replacedCount(
  current: HistoryStop[],
  original: HistoryStop[],
): number {
  return current.filter((s, i) => s.venue.id !== original[i]?.venue.id).length;
}

/**
 * Is there an arrangement to go BACK to?
 *
 * The head must actually differ from what is on screen — cycling a stop all
 * the way round returns to the original while still pushing history, and
 * offering "Undo" on a night that looks untouched, then changing it, is worse
 * than not offering it.
 */
export function canUndo<K>(
  mine: HistoryEntry<K>[],
  current: HistoryStop[],
): boolean {
  if (mine.length === 0) return false;
  const head = mine[mine.length - 1].stops;
  return head.some((s, i) => s.venue.id !== current[i]?.venue.id);
}
