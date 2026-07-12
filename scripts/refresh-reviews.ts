// Nightly ROTATING review refresh. Pulls Google reviews for the next
// FL_REVIEW_BATCH venues (oldest reviews_synced_at first, nulls first), so the
// whole ~2,100-venue catalogue refreshes roughly monthly. This keeps the
// expensive Atmosphere-SKU `reviews` field OFF the daily whole-catalogue loop
// (~$60/mo at ~70/night vs ~$1,800/mo if every venue daily).
//
// Reviews are stored VERBATIM — never synthesized, translated, summarized, or
// reordered (Google display policy + the project's provenance-honesty rule).
//
//   pnpm refresh-reviews:dry              # list the batch, no API calls, no writes
//   pnpm refresh-reviews                  # pull + store (SPENDS the reviews SKU)
//   FL_REVIEW_BATCH=70 pnpm refresh-reviews

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { mapGoogleReviews, fetchPlaceReviews } from "./google-reviews";

const DRY_RUN = process.argv.includes("--dry-run");
const BATCH = Number(process.env.FL_REVIEW_BATCH ?? "70");
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PLACES_KEY = process.env.GOOGLE_PLACES_API_KEY;

if (!SUPABASE_URL) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL in .env.local");
  process.exit(1);
}
if (!SERVICE_ROLE && !DRY_RUN) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
if (!PLACES_KEY && !DRY_RUN) {
  console.error("Missing GOOGLE_PLACES_API_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE ?? "anon", {
  auth: { persistSession: false },
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Review shape mapping + the reviews-only Details call live in
// scripts/google-reviews.ts, shared with the approve-time fetch in
// scripts/ingest-from-pending.ts so the two writers of venues.reviews
// cannot drift apart.

async function main(): Promise<void> {
  console.log(DRY_RUN ? "DRY RUN (no API calls, no writes)\n" : "");

  // The next rotating slice: oldest reviews_synced_at first (nulls = never
  // synced come first). At BATCH/night the catalogue cycles ~monthly. Paginate
  // because PostgREST caps a single select at 1000 rows — so a large one-time
  // seed (e.g. FL_REVIEW_BATCH=3000) isn't silently truncated. created_at is a
  // stable tiebreaker so pages don't overlap/skip among the null timestamps.
  const PAGE = 1000;
  const rows: { id: string; slug: string; google_place_id: string }[] = [];
  while (rows.length < BATCH) {
    const take = Math.min(PAGE, BATCH - rows.length);
    const { data, error } = await supabase
      .from("venues")
      .select("id, slug, google_place_id")
      .not("google_place_id", "is", null)
      .order("reviews_synced_at", { ascending: true, nullsFirst: true })
      .order("created_at", { ascending: true })
      .range(rows.length, rows.length + take - 1);
    if (error) throw new Error(`read venues failed: ${error.message}`);
    const batch = (data ?? []) as typeof rows;
    rows.push(...batch);
    if (batch.length < take) break;
  }
  console.log(
    `Refreshing reviews for ${rows.length} venue(s) (rotating ~monthly; batch ${BATCH})\n`,
  );

  // A shared Google Places daily-quota 429. Reviews run after the venue refresh,
  // so on a tight day the budget may already be gone — stop cleanly instead of
  // burning the batch (and instead of stamping reviews_synced_at, which would
  // skip these venues for a full cycle).
  const isQuotaError = (msg: string) =>
    /\b429\b|RESOURCE_EXHAUSTED|RATE_LIMIT_EXCEEDED/.test(msg);

  let done = 0;
  let empty = 0;
  let failed = 0;
  for (const v of rows) {
    if (DRY_RUN) {
      console.log(`  [dry] would refresh reviews for ${v.slug}`);
      continue;
    }
    try {
      const reviews = mapGoogleReviews(
        await fetchPlaceReviews(v.google_place_id, PLACES_KEY ?? ""),
      );
      const { error: upErr } = await supabase
        .from("venues")
        .update({ reviews, reviews_synced_at: new Date().toISOString() })
        .eq("id", v.id);
      if (upErr) {
        console.error(`  ✗ ${v.slug}: ${upErr.message}`);
        failed += 1;
        continue;
      }
      if (reviews.length === 0) empty += 1;
      console.log(`  ✓ ${v.slug} (${reviews.length} reviews)`);
      done += 1;
      await sleep(120); // gentle pacing
    } catch (e) {
      const msg = (e as Error).message;
      if (isQuotaError(msg)) {
        console.warn(
          "\n⏸ Daily Places quota reached — stopping reviews early; picks up next run.",
        );
        break;
      }
      console.error(`  ✗ ${v.slug}: ${msg}`);
      failed += 1;
      // Stamp the timestamp even on failure so a permanently-bad place_id
      // rotates to the BACK of the queue instead of squatting at the front and
      // re-spending a slot every night. A transient failure just delays this
      // venue's reviews by ~one cycle (it retries on the next rotation).
      await supabase
        .from("venues")
        .update({ reviews_synced_at: new Date().toISOString() })
        .eq("id", v.id);
    }
  }

  console.log(
    `\n${DRY_RUN ? "[dry] " : ""}reviews: ${done} synced (${empty} had none), ${failed} failed, of ${rows.length}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
