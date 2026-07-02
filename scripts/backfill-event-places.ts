// Backfill events.{google_place_id, place_details, place_synced_at} by resolving
// each event's venue against Google Places. Distinct venues are resolved ONCE
// (cached), so N events at the Jazz Cafe cost one lookup.
//
//   pnpm tsx scripts/backfill-event-places.ts --dry-run   # print the plan, no writes
//   pnpm tsx scripts/backfill-event-places.ts             # write
//   ... --force                                           # re-resolve even if set
//
// Read-only in --dry-run: it never touches the DB, just prints what it WOULD set.
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import { resolveEventPlace, type EventPlace } from "./places-detail";

const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PLACES_KEY = process.env.GOOGLE_PLACES_API_KEY;

// Hard cap so a bad query can never fan out into thousands of Places calls.
const MAX_EVENTS = 500;

async function main() {
  if (!PLACES_KEY) throw new Error("Missing GOOGLE_PLACES_API_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY)
    throw new Error("Missing Supabase service credentials");
  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const q = (cols: string) =>
    db
      .from("events")
      .select(cols)
      .is("cancelled_at", null)
      .gte("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: true })
      .limit(MAX_EVENTS);
  // Prefer selecting google_place_id (for idempotency), but fall back if the
  // migration hasn't run yet — so the dry-run works BEFORE any prod change.
  type Row = {
    id: string;
    name: string;
    venue_name: string;
    area: string;
    google_place_id?: string | null;
  };
  let r = await q("id, name, venue_name, area, google_place_id");
  if (r.error && /google_place_id/.test(r.error.message)) {
    console.log(
      "(google_place_id column not present yet — pre-migration dry run)",
    );
    r = await q("id, name, venue_name, area");
  }
  if (r.error) throw new Error(`read events: ${r.error.message}`);
  const events = (r.data ?? []) as unknown as Row[];

  const todo = events.filter((e) => FORCE || !e.google_place_id);
  console.log(
    `${events?.length ?? 0} upcoming events; ${todo.length} to resolve` +
      (DRY_RUN ? "  [DRY RUN — no writes]" : ""),
  );

  // Resolve each distinct (venue_name, area) once.
  const cache = new Map<string, EventPlace | null>();
  let resolved = 0,
    missed = 0,
    wrote = 0;

  for (const e of todo) {
    const key = `${(e.venue_name ?? "").toLowerCase()}|${(e.area ?? "").toLowerCase()}`;
    if (!cache.has(key)) {
      cache.set(
        key,
        e.venue_name
          ? await resolveEventPlace(e.venue_name, e.area ?? "", PLACES_KEY)
          : null,
      );
    }
    const place = cache.get(key) ?? null;

    if (!place) {
      missed++;
      console.log(
        `  X  ${e.name}\n       @ ${e.venue_name} (${e.area}) -> no Place; event still renders with what we have`,
      );
      continue;
    }
    resolved++;
    console.log(
      `  OK ${e.name}\n       @ ${place.matchedName} — ${place.rating ?? "?"}★ (${place.ratingCount ?? 0}) · ${place.address ?? "?"}` +
        `\n       hours:${place.openingHours ? "y" : "n"} web:${place.website ? "y" : "n"} phone:${place.phone ? "y" : "n"} reviews:${place.reviews.length} blurb:${place.editorial ? "y" : "n"}`,
    );

    if (!DRY_RUN) {
      const { error: upErr } = await db
        .from("events")
        .update({
          google_place_id: place.placeId,
          place_details: place,
          place_synced_at: new Date().toISOString(),
        })
        .eq("id", e.id);
      if (upErr) console.log(`     ! write failed: ${upErr.message}`);
      else wrote++;
    }
  }

  console.log(
    `\nDone. resolved=${resolved} missed=${missed}` +
      (DRY_RUN ? " (dry run, 0 written)" : ` written=${wrote}`),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
