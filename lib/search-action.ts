"use server";

import { headers } from "next/headers";
import {
  fetchAllVenueCards,
  fetchAllEventCards,
  fetchAllVenueSearchRows,
} from "@/lib/queries";
import { normalize, scoreMatch } from "@/lib/search-match";
import { rateLimit } from "@/lib/rate-limit";
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
  // Venue match index from the RICH server-side rows (tags + description +
  // address + reviews, read via the service-role client) so signed-out search
  // matches deep content while returning ONLY card-level venues. If the
  // service-role key is absent (or the rich read fails), fall back to card-only
  // matching so search still works, just shallower.
  const [richRows, events] = await Promise.all([
    fetchAllVenueSearchRows().catch(() => null),
    fetchAllEventCards(),
  ]);
  const venueRows =
    richRows ??
    (await fetchAllVenueCards()).map((venue) => ({ venue, haystack: "" }));
  cache = {
    at: Date.now(),
    venues: venueRows.map(({ venue, haystack }) => ({
      item: venue,
      name: normalize(venue.name),
      hay: normalize(
        [venue.neighbourhood, venue.type, venue.vibe, haystack].join(" "),
      ),
    })),
    events: events.map((e) => ({
      item: e,
      name: normalize(e.name),
      hay: normalize([e.venueName, e.area, e.category].join(" ")),
    })),
  };
  return cache;
}

// Per-IP rate limit for the public search actions — blunts bulk catalogue
// harvesting through the search endpoint (#25). Because signed-out search now
// MATCHES over gated detail content (returning only card-level results), the
// endpoint is a content-inference oracle, so this guard is required. In-process
// + per-instance, so it's a speed bump, not a global guarantee — a Redis/Upstash
// backend is the production upgrade. 40 queries/minute is generous for a human
// (debounced typing) but throttles a scraper walking prefixes.
const SEARCH_RATE_LIMIT = 40;
const SEARCH_RATE_WINDOW_MS = 60 * 1000;

function searchAllowed(): boolean {
  const h = headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "local";
  return rateLimit(`search:${ip}`, SEARCH_RATE_LIMIT, SEARCH_RATE_WINDOW_MS).ok;
}

// Rank an indexed list against a normalised query: name-prefix beats
// name-substring beats haystack-substring (see scoreMatch), best first, capped.
function rankIndexed<T>(rows: Indexed<T>[], q: string, limit: number): T[] {
  return rows
    .map((r) => ({ r, s: scoreMatch(r.name, r.hay, q) }))
    .filter((x) => x.s !== null)
    .sort((a, b) => (a.s as number) - (b.s as number))
    .slice(0, limit)
    .map((x) => x.r.item);
}

// Server-side catalogue search for SIGNED-OUT visitors. Returns ONLY card-level
// matches, so the full catalogue never reaches the browser, while search works
// across all ~2,000 venues. Matches over name + neighbourhood + type + vibe AND
// the gated detail content — vibe/mood tags, description, address, reviews —
// which is read server-side via the service-role index (the anon DB role can't
// see those columns) and used for matching only; the text itself is never
// returned. Rate-limited per IP, since rich matching makes this an oracle.
export async function searchCatalog(
  query: string,
): Promise<{ venues: Venue[]; events: Event[] }> {
  const q = normalize(query);
  if (q.length < 2) return { venues: [], events: [] };
  if (!searchAllowed()) return { venues: [], events: [] };
  const idx = await getIndex();
  return {
    venues: rankIndexed(idx.venues, q, 24),
    events: rankIndexed(idx.events, q, 10),
  };
}

// Events-only variant for the signed-out What's-on tab, so an anon visitor can
// search across ALL events — not just their metered preview slice. Venue
// results are intentionally empty (the events tab is event-scoped). Same
// server-side, card-level guarantees as searchCatalog.
export async function searchEvents(
  query: string,
): Promise<{ venues: Venue[]; events: Event[] }> {
  const q = normalize(query);
  if (q.length < 2) return { venues: [], events: [] };
  if (!searchAllowed()) return { venues: [], events: [] };
  const idx = await getIndex();
  return { venues: [], events: rankIndexed(idx.events, q, 24) };
}
