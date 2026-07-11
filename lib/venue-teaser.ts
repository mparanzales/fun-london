import "server-only";

// Server-only anon teaser fetch. This is the second reviewed service-role
// read on a public page (precedent: fetchAllVenueSearchRows) — the
// INVARIANT is that only the derived teaser string + max 3 tags leave this
// module; the full long_description / vibe_tags never enter an RSC payload.
// Exposure is therefore per-page HTML only (scrape-metered), with no bulk
// PostgREST path — see lib/anon-teaser.ts for the panel ruling.

import { requestMemo as cache } from "@/lib/request-memo";
import { createServiceClient } from "@/lib/supabase/admin";
import {
  deriveAnonTeaser,
  deriveAnonTags,
  type AnonTeaser,
} from "@/lib/anon-teaser";

export type AnonVenueTeaser = { teaser: AnonTeaser | null; tags: string[] };

const EMPTY: AnonVenueTeaser = { teaser: null, tags: [] };

// Wrapped in React cache() so generateMetadata + the page component share a
// single DB round-trip per request for the same slug (both call this on the
// anon path). Per-request memo only — no cross-request caching.
export const fetchAnonVenueTeaser = cache(
  async (slug: string): Promise<AnonVenueTeaser> => {
    const admin = createServiceClient();
    if (!admin) return EMPTY; // no service key configured → degrade to today's empty state
    const { data, error } = await admin
      .from("venues")
      .select("long_description, vibe_tags")
      .eq("slug", slug)
      .is("hidden_at", null)
      // Gate parity with every anon preview fetcher: a teaser must never
      // derive from a non-catalogue row (demo seeds have no place id),
      // independent of caller ordering.
      .not("google_place_id", "is", null)
      .maybeSingle();
    if (error || !data) return EMPTY;
    return {
      teaser: deriveAnonTeaser(data.long_description),
      tags: deriveAnonTags(data.vibe_tags),
    };
  },
);
