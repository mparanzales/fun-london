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
import type { VenueReview } from "@/lib/types";

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

// Google Places Details review shape (the fields we keep).
type GoogleReview = {
  rating?: number;
  text?: { text?: string };
  authorAttribution?: { displayName?: string; photoUri?: string };
  publishTime?: string;
  relativePublishTimeDescription?: string;
};

// Map Google's review objects to our stored shape — text kept VERBATIM, never
// edited. Drops reviews with no text (rating-only).
function mapReviews(g: GoogleReview[] | undefined): VenueReview[] {
  return (g ?? [])
    .map((r) => ({
      author: r.authorAttribution?.displayName ?? "Google user",
      rating: r.rating ?? 0,
      text: r.text?.text ?? "",
      relativeTime: r.relativePublishTimeDescription ?? "",
      publishTime: r.publishTime,
      authorPhotoUrl: r.authorAttribution?.photoUri,
    }))
    .filter((r) => r.text.trim().length > 0);
}

// Place Details for just the reviews field (server-side; key in the header).
async function placeReviews(placeId: string): Promise<GoogleReview[]> {
  const res = await fetch(
    `https://places.googleapis.com/v1/places/${placeId}`,
    {
      headers: {
        "X-Goog-Api-Key": PLACES_KEY ?? "",
        "X-Goog-FieldMask": "reviews",
      },
    },
  );
  if (!res.ok) throw new Error(`placeDetails HTTP ${res.status}`);
  const json = (await res.json()) as { reviews?: GoogleReview[] };
  return json.reviews ?? [];
}

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

  let done = 0;
  let empty = 0;
  let failed = 0;
  for (const v of rows) {
    if (DRY_RUN) {
      console.log(`  [dry] would refresh reviews for ${v.slug}`);
      continue;
    }
    try {
      const reviews = mapReviews(await placeReviews(v.google_place_id));
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
      console.error(`  ✗ ${v.slug}: ${(e as Error).message}`);
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
