// Pure mapping from a provider's classification → Fun London's EventCategory.
// Kept out of ingest-events.ts (which runs main() on import) so it can be unit
// tested in isolation.

import type { EventCategory } from "@/lib/types";

// Dance/Electronic music genres that are really club nights, not "gigs".
const CLUB_GENRE = /dance|electronic|house|techno|drum|garage|trance|dubstep|dj/;

// Map Ticketmaster's segment + genre → Fun London's EventCategory, or null if
// it doesn't fit one of our buckets ("Music" | "Food" | "Art" | "Comedy" |
// "Club"). Returning null drops the event rather than mislabelling it — the
// old code defaulted everything unknown to "Music", which is exactly what made
// the feed look gig-only and buried club nights under the wrong chip.
//
// Order matters:
//   1. Comedy is a GENRE under "Arts & Theatre" (no top-level Comedy segment),
//      so check it first or stand-up gets mislabelled "Art".
//   2. Dance/Electronic music genres ARE club nights → "Club", not "Music".
//   3. Sports / Film / Miscellaneous segments are dropped (null) — we'd never
//      surface those, and labelling them "Music" was a lie.
export function tmCategory(
  segment: string | undefined,
  genre: string | undefined,
): EventCategory | null {
  const g = (genre ?? "").toLowerCase();
  if (g.includes("comedy")) return "Comedy";
  switch (segment) {
    case "Music":
      return CLUB_GENRE.test(g) ? "Club" : "Music";
    case "Arts & Theatre":
      return "Art";
    case "Comedy":
      return "Comedy";
    default:
      // Sports / Film / Miscellaneous / unclassified — not a Fun London
      // category. Drop rather than dump into Music.
      return null;
  }
}
