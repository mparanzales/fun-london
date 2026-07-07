// Shared, pure search-matching helpers, used by BOTH the client SearchOverlay
// (signed-in, in-memory over the full catalogue) and the server search action
// (signed-out, server-side card-level search). The matcher is identical; the
// haystacks are not — the signed-in path additionally matches the in-memory
// vibe/mood tags that the card-level signed-out path doesn't carry.

import type { Venue, Event } from "./types";

// One relevance-ranked search result. Venues and events share a single list so
// they interleave by how well they match, not by type.
export type SearchHit =
  | { kind: "venue"; data: Venue; score: number }
  | { kind: "event"; data: Event; score: number };

// Normalise text for search: lowercase, strip accents, DROP apostrophes (so
// "dont" matches "Don't"), turn & into "and", collapse all other punctuation to
// spaces. Without this, any venue with an apostrophe or accent (Don't Tell Dad,
// Ronnie Scott's, Café, Ladurée) is unfindable unless the user types the exact
// special character.
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accent marks
    .replace(/['’`]/g, "") // drop straight + curly apostrophes
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// 0 = name starts with query (best), 1 = name contains query,
// 2 = some other field contains query (weakest). Lower sorts first.
// `name` and `hay` must already be normalised; `q` is normalised by the caller.
export function scoreMatch(
  name: string,
  hay: string,
  q: string,
): number | null {
  if (name.startsWith(q)) return 0;
  if (name.includes(q)) return 1;
  if (hay.includes(q)) return 2;
  return null;
}

// Order two hits for a single relevance-interleaved list: match tier first (see
// scoreMatch), so a name match of EITHER type outranks a description match of
// either type. Within a tier, a light quality prior lets venues and events mix
// instead of clustering by type; name is the final, deterministic tiebreak so
// the same query always yields the same order. Pure — shared by client+server.
export function compareHits(a: SearchHit, b: SearchHit): number {
  return (
    a.score - b.score ||
    hitQuality(b) - hitQuality(a) ||
    a.data.name.localeCompare(b.data.name)
  );
}

// A 0..1 quality prior (higher = better) used ONLY to break score-tier ties.
// Venues use their rating; events carry no rating, so they take a neutral prior
// (~3.0/5) and interleave through the middle of the venue ratings rather than
// always leading or trailing.
function hitQuality(h: SearchHit): number {
  if (h.kind === "venue") {
    const r = h.data.rating;
    return Number.isFinite(r) ? Math.min(Math.max(r / 5, 0), 1) : 0.5;
  }
  return 0.6;
}
