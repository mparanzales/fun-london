// Square Mile adapter — STUB.
//
// TODO(square-mile-adapter): Square Mile publishes RSS at
//   https://squaremile.com/feed
// covering all sections. The food section URL pattern is:
//   https://squaremile.com/food-drink/<slug>
//
// Their voice skews upmarket / industry-insider — useful as a
// cross-check on Time Out + Eater for high-end restaurant coverage.
// Misses some neighbourhood / casual spots, which is fine — those
// will surface via Hot Dinners or Infatuation.
//
// Filter: skip "Best of London" / "Top 10" listicles; keep
// individual venue features only.

import type { PublicationAdapter, PublicationMention } from "./_types";

export const squareMileAdapter: PublicationAdapter = {
  publication: "Square Mile",
  fetchRecentMentions: async (_opts?: {
    sinceMonths?: number;
    limit?: number;
  }): Promise<PublicationMention[]> => {
    return [];
  },
};
