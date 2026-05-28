// Harden's adapter — STUB.
//
// TODO(hardens-adapter): Harden's publishes annual + monthly content.
// They DO have an RSS-ish endpoint but it's not heavily promoted:
//   https://www.hardens.com/blog/feed/
//
// The "Latest London restaurant news" listing also works as a scrape
// target:
//   https://www.hardens.com/latest-restaurant-news/london/
//
// Harden's uses Cloudflare anti-bot. We learned this during Phase 5
// Tier 1 link-rot scanning — hardens.com is on BOT_BLOCKED_HOSTS in
// scripts/refresh-venues.ts. Same browser-UA + retry-on-403 fallback
// pattern needed here.
//
// Their review pages have a stable URL pattern:
//   https://www.hardens.com/az/restaurants/london/<postcode>/<slug>.htm
// which makes deduping easy — the slug is usually a normalised venue
// name.

import type { PublicationAdapter, PublicationMention } from "./_types";

export const hardensAdapter: PublicationAdapter = {
  publication: "Harden's",
  fetchRecentMentions: async (_opts?: {
    sinceMonths?: number;
    limit?: number;
  }): Promise<PublicationMention[]> => {
    return [];
  },
};
