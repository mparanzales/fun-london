// Eater London adapter — STUB.
//
// TODO(eater-adapter): Eater (Vox Media) publishes RSS at
//   https://london.eater.com/rss/index.xml
//
// Items are mostly "review" / "first look" / "newsletter" pieces. The
// venue is usually the page subject; parse the title.
//
// Useful filters:
//   - title contains "First Look", "Review", "Try", or "Opens" → strong
//     signal of a venue mention
//   - skip "best of" lists (title contains "Best", "Where to" — those are
//     aggregators, not single-venue write-ups)
//
// Eater London's HTML is also clean (Vox tech stack) so a fallback HTML
// scrape via cheerio-style selectors would work if the RSS schema
// changes.

import type { PublicationAdapter, PublicationMention } from "./_types";

export const eaterAdapter: PublicationAdapter = {
  publication: "Eater London",
  fetchRecentMentions: async (_opts?: {
    sinceMonths?: number;
    limit?: number;
  }): Promise<PublicationMention[]> => {
    return [];
  },
};
