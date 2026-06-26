// One-time backfill: populate venues.map_url (the "Plan your visit" static map)
// for venues that have lat/lng but no map yet. Mirrors a Google Static Map to
// keyless Supabase Storage. No Place Details call needed (uses stored lat/lng).
//
//   pnpm backfill-maps:dry             # show what would change, write nothing
//   pnpm backfill-maps                 # do it (SPENDS Maps Static quota)
//   BACKFILL_MAX=200 pnpm backfill-maps   # cap the run (cost guardrail)
//
// Run as a one-off / workflow_dispatch job, NOT inside the 10-minute daily
// maintenance cron. Requires FL_PHOTO_BUCKET set AND the Maps Static API
// enabled on the key (a SEPARATE SKU from Places — otherwise every fetch
// returns REQUEST_DENIED and nothing is written).

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { mirrorMapToStorage, photoStorageEnabled } from "./photo-storage";

const DRY_RUN = process.argv.includes("--dry-run");
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

async function main(): Promise<void> {
  console.log(DRY_RUN ? "DRY RUN (no writes)\n" : "");
  if (!DRY_RUN && !photoStorageEnabled()) {
    console.error(
      "FL_PHOTO_BUCKET unset — mirroring is disabled, so this would write nothing. Aborting.",
    );
    process.exit(1);
  }

  // Paginate — PostgREST caps a select at 1000 rows by default.
  const PAGE = 1000;
  const rows: {
    id: string;
    slug: string;
    lat: number | null;
    lng: number | null;
    map_url: string | null;
  }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("venues")
      .select("id, slug, lat, lng, map_url")
      .not("lat", "is", null)
      .not("lng", "is", null)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`read venues failed: ${error.message}`);
    const batch = (data ?? []) as typeof rows;
    rows.push(...batch.filter((v) => !v.map_url));
    if (batch.length < PAGE) break;
  }

  console.log(
    `${rows.length} venue(s) missing a map (cap ${MAX === Infinity ? "none" : MAX})\n`,
  );

  let done = 0;
  let failed = 0;
  let fetches = 0;
  for (const v of rows) {
    if (done >= MAX) {
      console.log(`\nhit BACKFILL_MAX=${MAX}; stopping.`);
      break;
    }
    if (v.lat == null || v.lng == null) continue;
    try {
      if (DRY_RUN) {
        console.log(`  [dry] would mirror a static map for ${v.slug}`);
        continue;
      }
      const mapUrl = await mirrorMapToStorage(v.slug, v.lat, v.lng, supabase);
      fetches += 1;
      if (!mapUrl) {
        console.error(
          `  ✗ ${v.slug}: map not mirrored (is the Maps Static API enabled on the key?)`,
        );
        failed += 1;
        continue;
      }
      const upd = await supabase
        .from("venues")
        .update({ map_url: mapUrl })
        .eq("id", v.id);
      if (upd.error) {
        console.error(`  ✗ ${v.slug}: db update ${upd.error.message}`);
        failed += 1;
        continue;
      }
      console.log(`  ✓ ${v.slug}`);
      done += 1;
      await sleep(80); // gentle pacing for the Static Maps / Storage endpoints
    } catch (e) {
      console.error(`  ✗ ${v.slug}: ${(e as Error).message}`);
      failed += 1;
    }
  }

  console.log(
    `\n${DRY_RUN ? "[dry] " : ""}maps: ${done} done, ${failed} failed, of ${rows.length}; ~${fetches} static-map fetches.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
