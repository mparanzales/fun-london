// One-time backfill: populate venues.photo_urls (the hero gallery) for venues
// that have a google_place_id but no gallery yet. Re-pulls Place Details to get
// the full photos[] array (the original backfill-photos only re-hosted the
// single hero), mirrors up to GALLERY_MAX to keyless Supabase Storage, and
// writes photo_urls (with photo_urls[0] == img_url).
//
//   pnpm backfill-gallery:dry            # show what would change, write nothing
//   pnpm backfill-gallery                # do it (SPENDS Google Photo-media quota)
//   BACKFILL_MAX=200 pnpm backfill-gallery   # cap the run (cost guardrail)
//
// Run as a one-off / workflow_dispatch job, NOT inside the 10-minute daily
// maintenance cron (it exceeds the timeout at catalogue scale). Requires Google
// Places billing LIVE + FL_PHOTO_BUCKET set, or it mirrors nothing.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import {
  resolveVenuePhotos,
  GALLERY_MAX,
  photoStorageEnabled,
} from "./photo-storage";

const DRY_RUN = process.argv.includes("--dry-run");
// Hard ceiling on how many venues to process in one run — a cost guardrail for
// the fragile Google budget. Unset = no cap.
const MAX = Number(process.env.BACKFILL_MAX ?? "0") || Infinity;
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

// Minimal Place Details call for just the photos array (server-side; the key
// never leaves this process).
async function placePhotos(placeId: string): Promise<{ name?: string }[]> {
  const res = await fetch(
    `https://places.googleapis.com/v1/places/${placeId}`,
    {
      headers: {
        "X-Goog-Api-Key": PLACES_KEY ?? "",
        "X-Goog-FieldMask": "photos",
      },
    },
  );
  if (!res.ok) throw new Error(`placeDetails HTTP ${res.status}`);
  const json = (await res.json()) as { photos?: { name?: string }[] };
  return json.photos ?? [];
}

async function main(): Promise<void> {
  console.log(DRY_RUN ? "DRY RUN (no writes)\n" : "");
  if (!DRY_RUN && !photoStorageEnabled()) {
    console.error(
      "FL_PHOTO_BUCKET unset — mirroring is disabled, so this would write nothing. Aborting.",
    );
    process.exit(1);
  }

  const { data, error } = await supabase
    .from("venues")
    .select("id, slug, google_place_id, photo_urls")
    .not("google_place_id", "is", null)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`read venues failed: ${error.message}`);

  const rows = (
    (data ?? []) as {
      id: string;
      slug: string;
      google_place_id: string;
      photo_urls: string[] | null;
    }[]
  ).filter((v) => !v.photo_urls || v.photo_urls.length === 0);

  console.log(
    `${rows.length} venue(s) missing a gallery (cap ${MAX === Infinity ? "none" : MAX})\n`,
  );

  let done = 0;
  let failed = 0;
  let mediaFetches = 0;
  for (const v of rows) {
    if (done >= MAX) {
      console.log(`\nhit BACKFILL_MAX=${MAX}; stopping.`);
      break;
    }
    try {
      if (DRY_RUN) {
        console.log(
          `  [dry] would re-pull details + mirror up to ${GALLERY_MAX} photos for ${v.slug}`,
        );
        continue;
      }
      const photos = await placePhotos(v.google_place_id);
      const urls = await resolveVenuePhotos(photos, v.slug, supabase);
      mediaFetches += Math.min(photos.length, GALLERY_MAX);
      if (urls.length === 0) {
        console.error(`  ✗ ${v.slug}: no photos mirrored`);
        failed += 1;
        continue;
      }
      // photo_urls[0] mirrors to the same `${slug}.ext` path as img_url, so
      // keeping img_url == photo_urls[0] is consistent and never orphans.
      const upd = await supabase
        .from("venues")
        .update({ photo_urls: urls, img_url: urls[0] })
        .eq("id", v.id);
      if (upd.error) {
        console.error(`  ✗ ${v.slug}: db update ${upd.error.message}`);
        failed += 1;
        continue;
      }
      console.log(`  ✓ ${v.slug} (${urls.length} photos)`);
      done += 1;
      await sleep(120); // gentle pacing for the Places/Storage endpoints
    } catch (e) {
      console.error(`  ✗ ${v.slug}: ${(e as Error).message}`);
      failed += 1;
    }
  }

  console.log(
    `\n${DRY_RUN ? "[dry] " : ""}galleries: ${done} done, ${failed} failed, of ${rows.length}; ~${mediaFetches} photo-media fetches.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
