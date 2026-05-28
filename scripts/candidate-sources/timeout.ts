// Time Out London adapter — STUB.
//
// TODO(timeout-adapter): Time Out exposes RSS feeds per section. The
// London restaurants index is at:
//   https://www.timeout.com/london/restaurants/feed
// Each <item> has <title>, <link>, <pubDate>, <description>. The
// venue name is usually the title minus the editorial framing, e.g.
//   "Brawn, Bethnal Green — restaurant review"
//   → "Brawn"
//
// Bars feed: https://www.timeout.com/london/bars-and-pubs/feed
// Music venues feed: https://www.timeout.com/london/music/feed
//
// Implementation sketch:
//   1. fetch() the RSS XML
//   2. parse with a tiny XML reader (no dependency — regex on <item>...</item>)
//   3. for each item, extract title + link + pubDate
//   4. clean the title to extract venue name + neighbourhood
//   5. filter by sinceMonths
//   6. return PublicationMention[]
//
// Time Out is the easiest of the 6 to wire because they publish proper
// RSS. Wire this first.

import type { PublicationAdapter, PublicationMention } from "./_types";

export const timeoutAdapter: PublicationAdapter = {
  publication: "Time Out",
  fetchRecentMentions: async (_opts?: {
    sinceMonths?: number;
    limit?: number;
  }): Promise<PublicationMention[]> => {
    return [];
  },
};
