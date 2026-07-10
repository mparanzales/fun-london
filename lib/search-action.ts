"use server";

import { headers } from "next/headers";
import {
  fetchAllVenueCards,
  fetchAllEventCards,
  fetchAllVenueSearchRows,
} from "@/lib/queries";
import { normalize, scoreMatch, compareHits } from "@/lib/search-match";
import type { SearchHit } from "@/lib/search-match";
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
// endpoint is a content-inference oracle, so this guard is required. Backed by a
// shared Upstash Redis counter when configured (enforced across all serverless
// instances), falling back to a per-instance in-memory counter otherwise. 40
// queries/minute is generous for a human (debounced typing) but throttles a
// scraper walking prefixes.
const SEARCH_RATE_LIMIT = 40;
const SEARCH_RATE_WINDOW_MS = 60 * 1000;

async function searchAllowed(): Promise<boolean> {
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "local";
  const allowed = await rateLimit(
    `search:${ip}`,
    SEARCH_RATE_LIMIT,
    SEARCH_RATE_WINDOW_MS,
  );
  if (!allowed) {
    // Make the defense OBSERVABLE: a throttled scraper walking the search
    // oracle used to look identical to nobody searching (empty results, no
    // log, no metric). One warn per trip is greppable in the Vercel function
    // logs. The IP is hashed: we want "same actor, many trips" correlation,
    // never a raw address in logs.
    const { createHash } = await import("node:crypto");
    const ipHash = createHash("sha256").update(ip).digest("hex").slice(0, 12);
    console.warn(`[rate-limit] search trip ipHash=${ipHash}`);
  }
  return allowed;
}

// Rank venues AND events against a normalised query into ONE relevance-ordered
// list, so the two types interleave by how well they match rather than being
// grouped by kind (see compareHits). Best first, capped to `limit` total.
function rankMerged(
  venues: Indexed<Venue>[],
  events: Indexed<Event>[],
  q: string,
  limit: number,
): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const r of venues) {
    const s = scoreMatch(r.name, r.hay, q);
    if (s !== null) hits.push({ kind: "venue", data: r.item, score: s });
  }
  for (const r of events) {
    const s = scoreMatch(r.name, r.hay, q);
    if (s !== null) hits.push({ kind: "event", data: r.item, score: s });
  }
  hits.sort(compareHits);
  return hits.slice(0, limit);
}

// App-wide catalogue search, used by every search box (Explore + What's on).
// Returns ONE relevance-ranked list of venues AND events interleaved, so a
// single query searches everything and the best matches lead regardless of
// type. Returns ONLY card-level rows, so the full catalogue never reaches the
// browser, while search works across all ~2,000 venues + all events. Matches
// over name + neighbourhood + type + vibe AND the gated detail content — vibe/
// mood tags, description, address, reviews — read server-side via the
// service-role index (the anon DB role can't see those columns) and used for
// matching only; the text itself is never returned. Rate-limited per IP, since
// rich matching makes this an oracle.
export async function searchCatalog(query: string): Promise<SearchHit[]> {
  const q = normalize(query);
  if (q.length < 2) return [];
  if (!(await searchAllowed())) return [];
  const idx = await getIndex();
  return rankMerged(idx.venues, idx.events, q, 30);
}
