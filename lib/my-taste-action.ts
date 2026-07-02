"use server";

// Stage 5 — a member's OWN taste, for Plan Together.
//
// The result screen is a Client Component, but taste needs the service-role
// embeddings (server only). This action returns ONLY the caller's own taste map
// (venueId → relevance), derived from the SESSION — it takes no user ids, so
// there is no way to ask for anyone else's taste. Each device fetches its own
// map here and broadcasts it over the room channel; every device averages the
// maps it collects (lib/group-taste.ts) into the group taste. Signed-out → null.

import { getAuthUser } from "./auth";
import { tasteScoresForUser } from "./taste-feed";
import type { TasteMap } from "./group-taste";

export async function loadMyTaste(): Promise<TasteMap | null> {
  const user = await getAuthUser();
  if (!user) return null;
  return tasteScoresForUser(user.id);
}
