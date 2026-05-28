// Hot Dinners adapter — STUB.
//
// TODO(hot-dinners-adapter): Hot Dinners publishes RSS at
//   https://www.hot-dinners.com/rss/all.xml
// covering all sections (news, test drives, reviews, openings).
//
// The "Test Drive" series under /Gastroblog/Test-drive/ is the gold
// standard — each one is a single-venue write-up with the venue name
// in the URL slug and the title:
//   "Test Driving Brawn Soho"
//   URL slug: brawn-soho-restaurant-review
//
// Filter rule of thumb:
//   - Section path contains "Test-drive" OR "Restaurant-Reviews"
//   - Skip "/Latest-news/" (openings + press releases, lower curation
//     signal — useful as a SECONDARY confirmation but not as the
//     PRIMARY source)
//
// London-specific by design — no need to filter by city.

import type { PublicationAdapter, PublicationMention } from "./_types";

export const hotDinnersAdapter: PublicationAdapter = {
  publication: "Hot Dinners",
  fetchRecentMentions: async (_opts?: {
    sinceMonths?: number;
    limit?: number;
  }): Promise<PublicationMention[]> => {
    return [];
  },
};
