"use server";

// Signed-in feed pagination. The client calls loadFeedPage() as it scrolls; the
// server reads the session + the user's taste prefs, then returns ONE page of
// light cards (heavy tags never leave the server). Signed-out callers get an
// empty page — the anonymous feed is the separate metered preview.

import { getAuthUser } from "./auth";
import {
  fetchProfile,
  feedPage,
  type FeedFilter,
  type FeedSort,
} from "./queries";
import type { Venue } from "./types";

export async function loadFeedPage(args: {
  filter: FeedFilter;
  offset: number;
  limit: number;
  sort: FeedSort;
  lat?: number | null;
  lng?: number | null;
}): Promise<{ venues: Venue[]; hasMore: boolean }> {
  const user = await getAuthUser();
  if (!user) return { venues: [], hasMore: false };
  const profile = await fetchProfile(user.id);
  return feedPage({
    ...args,
    prefs: profile?.preferences ?? null,
    userId: user.id,
  });
}
