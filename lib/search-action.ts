"use server";

import { fetchAllVenueCards, fetchAllEventCards } from "@/lib/queries";
import { normalize, scoreMatch } from "@/lib/search-match";
import type { Venue, Event } from "@/lib/types";

// In-process TTL cache: the card catalogue is public, slow-changing data, so a
// signed-out search shouldn't refetch ~2,000 rows on every keystroke. Resets
// naturally when a serverless instance goes cold.
type Indexed<T> = { item: T; name: string; hay: string };
let cache: {
  at: number;
  venues: Indexed<Venue>[];
  events: Indexed<Event>[];
} | null = null;
const TTL_MS = 10 * 60 * 1000;

async function getIndex() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache;
  const [venues, events] = await Promise.all([
    fetchAllVenueCards(),
    fetchAllEventCards(),
  ]);
  cache = {
    at: Date.now(),
    venues: venues.map((v) => ({
      item: v,
      name: normalize(v.name),
      hay: normalize([v.neighbourhood, v.type, v.vibe].join(" ")),
    })),
    events: events.map((e) => ({
      item: e,
      name: normalize(e.name),
      hay: normalize([e.venueName, e.area, e.category].join(" ")),
    })),
  };
  return cache;
}

// Server-side catalogue search for SIGNED-OUT visitors. Returns ONLY card-level
// matches, so the full catalogue never reaches the browser, while search still
// works across all ~2,000 venues. Matches over name + neighbourhood + type +
// vibe (the card-level fields); the signed-in path also matches vibe/mood tags
// it holds in memory, so signed-out results are a touch narrower by design.
export async function searchCatalog(
  query: string,
): Promise<{ venues: Venue[]; events: Event[] }> {
  const q = normalize(query);
  if (q.length < 2) return { venues: [], events: [] };
  const idx = await getIndex();

  function rank<T>(rows: Indexed<T>[], limit: number): T[] {
    return rows
      .map((r) => ({ r, s: scoreMatch(r.name, r.hay, q) }))
      .filter((x) => x.s !== null)
      .sort((a, b) => (a.s as number) - (b.s as number))
      .slice(0, limit)
      .map((x) => x.r.item);
  }

  return { venues: rank(idx.venues, 24), events: rank(idx.events, 10) };
}
