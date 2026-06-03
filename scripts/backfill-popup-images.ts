// One-off / maintenance: replace stock pop-up images with the REAL promo
// image (og:image) from each pop-up's official page, mirrored to Supabase
// Storage (keyless, allowlisted). Re-runnable and idempotent.
//
//   pnpm backfill-popup-images:dry   # show what it would change
//   pnpm backfill-popup-images       # write

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { mirrorImageUrlToStorage, photoStorageEnabled } from "./photo-storage";
import { fetchOgImage } from "./og-image";

const DRY_RUN = process.argv.includes("--dry-run");
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!photoStorageEnabled()) {
  console.error("FL_PHOTO_BUCKET not set — nothing to mirror into.");
  process.exit(1);
}

const supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function main() {
  const { data, error } = await supabase
    .from("events")
    .select("id, name, source_id, source_url, img_url")
    .eq("source", "popup");
  if (error) {
    console.error(`read failed: ${error.message}`);
    process.exit(1);
  }
  const rows = data ?? [];
  console.log(
    `Pop-up image backfill · ${rows.length} pop-up(s) · ${DRY_RUN ? "DRY RUN" : "WRITE"}\n`,
  );

  let updated = 0;
  for (const r of rows) {
    const sourceUrl = r.source_url as string | null;
    if (!sourceUrl) {
      console.log(`  – ${r.name}: no official URL, keeping stock image`);
      continue;
    }
    const og = await fetchOgImage(sourceUrl);
    if (!og) {
      console.log(`  – ${r.name}: no og:image on ${sourceUrl}, keeping stock`);
      continue;
    }
    if (DRY_RUN) {
      console.log(`  ✅ [dry] ${r.name}: would mirror ${og}`);
      updated++;
      continue;
    }
    const mirrored = await mirrorImageUrlToStorage(
      og,
      r.source_id as string,
      supabase,
    );
    if (!mirrored) {
      console.log(`  ✗ ${r.name}: mirror failed, keeping stock`);
      continue;
    }
    const { error: upErr } = await supabase
      .from("events")
      .update({ img_url: mirrored })
      .eq("id", r.id);
    if (upErr) {
      console.error(`  ✗ ${r.name}: update failed ${upErr.message}`);
      continue;
    }
    console.log(`  ✅ ${r.name}: real promo image mirrored`);
    updated++;
  }

  console.log(`\n${DRY_RUN ? "Would update" : "Updated"}: ${updated}/${rows.length}`);
}

main().catch((e) => {
  console.error("\nFATAL:", e);
  process.exit(1);
});
