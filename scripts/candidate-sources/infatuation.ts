// The Infatuation London adapter — STUB.
//
// TODO(infatuation-adapter): The Infatuation does NOT publish a public
// RSS feed. Two options:
//   1. Scrape the /london/reviews/ listing page (https://www.theinfatuation.com/london/reviews)
//      — paginated, returns ~20 reviews per page with title + venue + date.
//   2. Use their internal JSON endpoint if reachable:
//      https://www.theinfatuation.com/api/london/reviews?page=1
//      (check the network tab on the listing page; may require headers.)
//
// Their voice is similar to Fun London's editorial style so titles like
//   "Brawn Soho Has Been A Long Time Coming"
// can be parsed by removing common framing ("Has Been...", "Review:", etc.)
// to get the venue name.
//
// Lightly Cloudflare-fronted in our experience (Phase 5 Tier 1 link-rot
// scan). May need a browser User-Agent header for the fetch to succeed.

import type { PublicationAdapter, PublicationMention } from "./_types";

export const infatuationAdapter: PublicationAdapter = {
  publication: "The Infatuation",
  fetchRecentMentions: async (_opts?: {
    sinceMonths?: number;
    limit?: number;
  }): Promise<PublicationMention[]> => {
    return [];
  },
};
