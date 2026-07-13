import "server-only";

// Server-only anon teaser fetch for events — mirrors lib/venue-teaser.ts.
// INVARIANT: only the derived, capped teaser string leaves this module; the
// full event `description` (a moat column — not in EVENT_CARD_COLUMNS) never
// enters an RSC payload. Exposure is per-page HTML only (scrape-metered),
// no bulk PostgREST path.

import { requestMemo as cache } from "@/lib/request-memo";
import { createServiceClient } from "@/lib/supabase/admin";
import { deriveAnonEventTeaser, type AnonTeaser } from "@/lib/anon-teaser";

export type AnonEventTeaser = { teaser: AnonTeaser | null };

const EMPTY: AnonEventTeaser = { teaser: null };

// cache(): generateMetadata (if it ever uses it) + the page component share
// one DB round-trip per request for the same id. Per-request memo only.
export const fetchAnonEventTeaser = cache(
  async (id: string): Promise<AnonEventTeaser> => {
    const admin = createServiceClient();
    if (!admin) return EMPTY; // no service key → degrade to today's empty state
    const { data, error } = await admin
      .from("events")
      .select("description")
      .eq("id", id)
      // Row-level gate parity with fetchEventPreviewById: never derive a
      // teaser from a cancelled event.
      .is("cancelled_at", null)
      .maybeSingle();
    if (error || !data) return EMPTY;
    return { teaser: deriveAnonEventTeaser(data.description) };
  },
);
