/**
 * Which venue "Change" offers next, and what that does to the stop's history.
 *
 * 🧨 EXTRACTED SO IT CAN BE TESTED. This decision lived inside `onSwap` in
 * plan-flow.tsx, where the framework-free suite cannot reach it — and that is
 * exactly how a guard shipped that made the whole feature inert across eight
 * commits with 578 tests green. Anything that decides what the user gets
 * belongs out here where it can be broken on purpose.
 *
 * `visited` records the ids already SHOWN for this stop, in order — not a
 * position in the list. A position is meaningless: the list is rebuilt on
 * every tap (options are recomputed against the night's current stops) and the
 * original is prepended only while the stop is actually replaced, so length
 * and offset shift underneath a stored index. Measured with four candidates
 * {A original, B, C, D}, an index produced A,B,C,D,A,C,D,A — B was never
 * offered again, so the top-ranked alternative was unreachable however long
 * the user tapped.
 */
export type CyclePick<T> = { picked: T; visited: string[] };

export function nextInCycle<T extends { id: string }>(
  /** Options for this stop, best first, rebuilt fresh for the current night. */
  list: T[],
  /** Ids already offered for this stop, oldest first. */
  visited: string[],
  /** +1 = next (tap / left swipe), -1 = previous (right swipe). */
  dir: 1 | -1,
): CyclePick<T> | null {
  if (list.length === 0) return null;
  const unseen = list.filter((v) => !visited.includes(v.id));
  // Everything has been shown: start the rotation again rather than stalling.
  const exhausted = unseen.length === 0;
  const pool = exhausted ? list : unseen;
  const picked = dir === 1 ? pool[0] : pool[pool.length - 1];
  if (!picked) return null;
  return {
    picked,
    visited: exhausted ? [picked.id] : [...visited, picked.id],
  };
}
