// Group react/veto threshold for Plan Together.
//
// A stop swaps only when STRICTLY MORE than half the group has vetoed it — a
// real majority, so no single person can override the group (the explicit
// product choice over "any one veto swaps it"). For a pair that means both must
// veto; for 3 it's 2; for 4 it's 3. A lone member (group of 1) passes on their
// own veto.

export function vetoMajority(vetoes: number, groupSize: number): boolean {
  return groupSize > 0 && vetoes > groupSize / 2;
}

// Drop reactions from members who have left the room. Reactions drive an
// automatic majority swap measured against the LIVE group, so a departed
// member's stale veto must not count (else a leave alone could cross the
// threshold, or the tally could show more votes than people). Returns the SAME
// reference when nothing was pruned, so React can skip a needless re-render.
export function pruneReactions<T>(
  reactions: Record<number, Record<string, T>>,
  liveIds: Set<string>,
): Record<number, Record<string, T>> {
  let changed = false;
  const out: Record<number, Record<string, T>> = {};
  for (const [stepIdx, byMember] of Object.entries(reactions)) {
    const kept: Record<string, T> = {};
    for (const [id, value] of Object.entries(byMember)) {
      if (liveIds.has(id)) kept[id] = value;
      else changed = true;
    }
    if (Object.keys(kept).length > 0) out[Number(stepIdx)] = kept;
  }
  return changed ? out : reactions;
}
