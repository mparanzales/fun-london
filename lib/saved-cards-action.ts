"use server";

// Public POST endpoint: card-level venues for the anon /saved grid. The anon
// heart list lives in localStorage (fl.saved.v1, slugs), which the server
// can't read — so the client sends its slugs here and gets card previews
// back. Column safety is enforced at the DB layer: fetchVenueCardsBySlugs
// runs as the `anon` Postgres role (createStaticAnonClient), where selecting
// any ungranted column fails loudly. Rate limit is cost control on a public
// endpoint, generous for humans (guardian gate C6, 2026-07-27).

import { headers } from "next/headers";
import { rateLimit } from "@/lib/rate-limit";
import { fetchVenueCardsBySlugs } from "@/lib/queries";
import type { Venue } from "@/lib/types";

const LIMIT = 30;
const WINDOW_MS = 60 * 60 * 1000;
const MAX_SLUGS = 50;
const SLUG_RE = /^[a-z0-9-]{1,80}$/;

export async function fetchSavedCards(
  slugs: unknown,
): Promise<{ ok: boolean; venues: Venue[] }> {
  try {
    if (!Array.isArray(slugs)) return { ok: false, venues: [] };
    const clean = [
      ...new Set(
        slugs.filter(
          (s): s is string => typeof s === "string" && SLUG_RE.test(s),
        ),
      ),
    ].slice(0, MAX_SLUGS);
    if (clean.length === 0) return { ok: true, venues: [] };

    const h = await headers();
    const ip =
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      h.get("x-real-ip") ||
      "local";
    const { createHash } = await import("node:crypto");
    const ipHash = createHash("sha256").update(ip).digest("hex").slice(0, 16);
    const allowed = await rateLimit(`savedcards:${ipHash}`, LIMIT, WINDOW_MS);
    if (!allowed) return { ok: false, venues: [] };

    return { ok: true, venues: await fetchVenueCardsBySlugs(clean) };
  } catch {
    return { ok: false, venues: [] };
  }
}
