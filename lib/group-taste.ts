// Stage 5 — group taste, computed on the client from what peers broadcast.
//
// Each device fetches its OWN taste map (venueId → relevance) from a
// session-gated server action and broadcasts it over the room's Realtime
// channel. No endpoint ever hands out another user's taste, and no raw taste
// vector or user id leaves its owner's session — so there's no cross-user
// probing surface. Every device averages the maps it has collected into one
// group direction, which steers the walkable plan (as the engine's `taste`).

export type TasteMap = Record<string, number>;

/**
 * Average N members' taste maps into the group's. Per venue, the mean over ALL
 * contributing members, treating an absent entry as 0 — taste maps are
 * compacted for the wire (near-zero scores dropped, see
 * lib/taste-feed.compactTasteScores), so a missing key means "no opinion",
 * not "don't count me". Dividing by the per-venue scorer count instead would
 * inflate a venue one member loves and everyone else is neutral on. An empty
 * set — or a set where nobody had any signal (all-empty maps) — returns null
 * so the plan stays rating-led rather than falsely claiming to be "tuned".
 */
export function averageTasteMaps(
  maps: (TasteMap | null | undefined)[],
): TasteMap | null {
  const present = maps.filter((m): m is TasteMap => Boolean(m));
  if (present.length === 0) return null;
  const sum: Record<string, number> = {};
  for (const m of present) {
    for (const id in m) {
      sum[id] = (sum[id] ?? 0) + m[id];
    }
  }
  const out: TasteMap = {};
  for (const id in sum) out[id] = sum[id] / present.length;
  return Object.keys(out).length > 0 ? out : null;
}
