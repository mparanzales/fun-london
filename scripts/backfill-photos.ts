// One-time backfill: move EVERY venue photo that still carries the Google
// Places API key into Supabase Storage, and rewrite venues.img_url to the
// keyless public URL. Covers both hand-curated and robot-discovered venues
// (unlike re-running ingest, which only touches the seed list).
//
// Safe to re-run: it only touches rows whose img_url still points at
// places.googleapis.com, and Storage uploads are upsert.
//
//   pnpm backfill-photos:dry   # show what would change, write nothing
//   pnpm backfill-photos       # do it
//
// After this prints "0 remaining keyed URLs", ROTATE the Google key in
// Google Cloud (the old one is then dead even if it was scraped).

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { isBlockedUrlError, parseFetchTarget, safeFetch } from "./safe-fetch";

const DRY_RUN = process.argv.includes("--dry-run");

// The only host a keyed Google photo URL can legitimately name. img_url is
// catalogue data — written by the ingestion crons and by bulk CSV import — so
// it is attacker-influenced, and this script fetches it and puts the response
// body in a PUBLIC bucket. Anything but this host is refused outright.
const PHOTO_HOSTS = ["places.googleapis.com"] as const;
const BUCKET = process.env.FL_PHOTO_BUCKET || "venue-photos";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL in .env.local");
  process.exit(1);
}
if (!SERVICE_ROLE && !DRY_RUN) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE ?? "anon", {
  auth: { persistSession: false },
});

async function ensureBucket(): Promise<void> {
  if (DRY_RUN) return;
  const { error } = await supabase.storage.createBucket(BUCKET, {
    public: true,
  });
  if (error && !/already exists/i.test(error.message)) {
    throw new Error(`createBucket failed: ${error.message}`);
  }
  console.log(`bucket "${BUCKET}" ready (public)`);
}

async function main(): Promise<void> {
  console.log(DRY_RUN ? "DRY RUN (no writes)\n" : "");
  await ensureBucket();

  // Every venue still serving a key-bearing Google URL.
  //
  // This LIKE is a cheap narrowing hint, NOT the guard. "%…%" matches the
  // literal anywhere in the string, including a query parameter, so
  //   http://169.254.169.254/latest/meta-data/?x=places.googleapis.com
  // satisfies it while naming a completely different host. The authority is
  // checked in code below, per row, against the parsed URL. The filter is
  // deliberately left wide rather than tightened to a prefix: a poisoned row
  // should still be SELECTED so it gets reported as refused, instead of
  // quietly dropping out of the result set unseen.
  const { data, error } = await supabase
    .from("venues")
    .select("id,slug,img_url")
    .ilike("img_url", "%places.googleapis.com%");
  if (error) throw new Error(`read venues failed: ${error.message}`);

  const rows = (data ?? []) as { id: string; slug: string; img_url: string }[];
  console.log(`${rows.length} venue(s) with a keyed photo URL\n`);

  let done = 0;
  let failed = 0;
  let refused = 0;
  for (const v of rows) {
    try {
      if (DRY_RUN) {
        // Screen in the dry run too, so the refusal is visible BEFORE anyone
        // runs the real thing.
        const target = parseFetchTarget(v.img_url, {
          allowInitialHosts: PHOTO_HOSTS,
        });
        if (!target) {
          console.error(
            `  ⚠ ${v.slug}: REFUSED — img_url is not a ${PHOTO_HOSTS[0]} URL: ${v.img_url}`,
          );
          refused += 1;
          continue;
        }
        console.log(`  [dry] would mirror ${v.slug}`);
        continue;
      }
      const res = await safeFetch(
        v.img_url,
        {},
        { allowInitialHosts: PHOTO_HOSTS },
      );
      if (!res.ok) {
        console.error(`  ✗ ${v.slug}: fetch HTTP ${res.status}`);
        failed += 1;
        continue;
      }
      const contentType = res.headers.get("content-type") ?? "image/jpeg";
      const ext = contentType.includes("png") ? "png" : "jpg";
      const buffer = Buffer.from(await res.arrayBuffer());

      const path = `${v.slug}.${ext}`;
      const up = await supabase.storage
        .from(BUCKET)
        .upload(path, buffer, { contentType, upsert: true });
      if (up.error) {
        console.error(`  ✗ ${v.slug}: upload ${up.error.message}`);
        failed += 1;
        continue;
      }
      const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(path)
        .data.publicUrl;
      const upd = await supabase
        .from("venues")
        .update({ img_url: publicUrl })
        .eq("id", v.id);
      if (upd.error) {
        console.error(`  ✗ ${v.slug}: db update ${upd.error.message}`);
        failed += 1;
        continue;
      }
      console.log(`  ✓ ${v.slug}`);
      done += 1;
    } catch (e) {
      // A refusal is not a flaky network — it means a row in the catalogue
      // points somewhere it has no business pointing. Count and label it
      // separately so it cannot hide inside the failure tally.
      if (isBlockedUrlError(e)) {
        console.error(`  ⚠ ${v.slug}: REFUSED — ${e.message}`);
        refused += 1;
        continue;
      }
      console.error(`  ✗ ${v.slug}: ${(e as Error).message}`);
      failed += 1;
    }
  }

  console.log(
    `\n${DRY_RUN ? "[dry] " : ""}mirrored ${done}, failed ${failed}, refused ${refused}, of ${rows.length}`,
  );
  if (refused > 0) {
    console.error(
      `\n🚨 ${refused} row(s) carried an img_url that is not a ${PHOTO_HOSTS[0]} URL.\n` +
        `   Nothing was fetched from them. Inspect those rows before re-running:\n` +
        `   they were written by an ingestion cron or a CSV import, so a value\n` +
        `   pointing anywhere else means one of those paths accepted junk.`,
    );
  }
  if (!DRY_RUN) {
    const { count } = await supabase
      .from("venues")
      .select("id", { count: "exact", head: true })
      .ilike("img_url", "%places.googleapis.com%");
    console.log(`remaining keyed URLs: ${count ?? "?"}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
