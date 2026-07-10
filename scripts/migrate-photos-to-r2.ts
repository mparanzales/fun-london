// ─────────────────────────────────────────────────────────────────────────
// One-time migration: move EVERY venue/event photo from Supabase Storage
// (bucket "venue-photos", 7 GB / 708% of the free tier) to Cloudflare R2
// (10 GB free + zero egress), re-encoding to WebP on the way, then rewrite
// every DB URL to the img.funldn.com custom domain.
//
//   pnpm migrate-photos:dry            # count + sample transforms, write nothing
//   pnpm migrate-photos --limit 500    # upload one bounded wave (resumable)
//   pnpm migrate-photos                # upload all remaining, then rewrite DB
//   pnpm migrate-photos --db-only      # skip upload, rewrite DB for uploaded objs
//
// SAFE TO RE-RUN + SAFE IN BOUNDED WAVES. Uploads are idempotent (same key
// overwritten) and checkpointed by object name in .r2-migration-progress.json.
// The DB rewrite only flips a row to img.funldn.com once that object is
// CONFIRMED in the checkpoint, so a partial/interrupted run never points a row
// at an object that doesn't exist yet (both hosts serve until a row flips).
//
// SEQUENCING: finish the upload, run the DB rewrite, then run `--verify` (HEADs
// every referenced R2 object) and only THEN empty the Supabase bucket. Also set
// the three R2_* secrets in GitHub Actions before emptying, or the daily crons
// keep writing Supabase-host URLs (venue-creation-paths-parity trap).
// ─────────────────────────────────────────────────────────────────────────

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  r2Configured,
  uploadPhotoToR2,
  R2_PUBLIC_BASE,
  stemOf,
} from "./r2-storage";

const DRY_RUN = process.argv.includes("--dry-run");
const DB_ONLY = process.argv.includes("--db-only");
const limitArg = process.argv.indexOf("--limit");
const WAVE_LIMIT =
  limitArg >= 0 ? Number(process.argv[limitArg + 1]) : Infinity;

const BUCKET = process.env.FL_PHOTO_BUCKET || "venue-photos";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROGRESS_FILE = ".r2-migration-progress.json";

if (!SUPABASE_URL) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
// Lists the bucket + reads venues/events — the anon key can do neither, so the
// service role is required even for a dry run.
if (!SERVICE_ROLE) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
if (!DRY_RUN && !DB_ONLY && !r2Configured())
  throw new Error(
    "R2 not configured. Set R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_ENDPOINT in .env.local",
  );
if (limitArg >= 0 && !(Number.isFinite(WAVE_LIMIT) && WAVE_LIMIT > 0))
  throw new Error("--limit needs a positive number, e.g. --limit 500");

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

// Transform a Supabase venue-photos object URL to its img.funldn.com detail
// URL. Non-Supabase URLs (Google / Ticketmaster / already-migrated) pass
// through unchanged, so this is safe over every row. When `uploaded` is given,
// a URL is only flipped once its object is confirmed in R2 — a partial wave
// leaves un-uploaded rows on Supabase (both hosts serve, no broken image).
const OBJECT_PREFIX = `/storage/v1/object/public/${BUCKET}/`;
export function rewriteUrl(
  url: string | null | undefined,
  uploaded?: Set<string> | null,
): string | null {
  if (!url || !url.includes(OBJECT_PREFIX)) return url ?? null;
  const rest = url.slice(url.indexOf(OBJECT_PREFIX) + OBJECT_PREFIX.length);
  let key: string;
  try {
    // Drop any ?query / #fragment before deriving the object key.
    key = decodeURIComponent(rest.replace(/[?#].*$/, ""));
  } catch {
    return url; // malformed %-escape: leave the row untouched
  }
  if (uploaded && !uploaded.has(key)) return url;
  return `${R2_PUBLIC_BASE}/${stemOf(key)}.webp`;
}

function loadProgress(): Set<string> {
  if (!existsSync(PROGRESS_FILE)) return new Set();
  try {
    return new Set(JSON.parse(readFileSync(PROGRESS_FILE, "utf8")) as string[]);
  } catch {
    return new Set();
  }
}
function saveProgress(done: Set<string>): void {
  writeFileSync(PROGRESS_FILE, JSON.stringify([...done]));
}

// List every object in the (flat) bucket, paginating past the per-call cap.
async function listAllObjects(): Promise<string[]> {
  const names: string[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list("", {
        limit: PAGE,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
    if (error) throw new Error(`storage.list: ${error.message}`);
    const raw = data ?? [];
    // Skip folder-placeholder rows (no id); break on the RAW page size so a
    // placeholder in a full page can't silently truncate the listing.
    names.push(...raw.filter((o) => o.name && o.id).map((o) => o.name));
    if (raw.length < PAGE) break;
  }
  return names;
}

// Returns the set of object names confirmed uploaded to R2 (the checkpoint).
async function uploadPhase(): Promise<Set<string>> {
  const all = await listAllObjects();
  const done = loadProgress();
  const todo = all.filter((n) => !done.has(n));
  console.log(
    `bucket "${BUCKET}": ${all.length} objects, ${done.size} already migrated, ${todo.length} remaining` +
      (Number.isFinite(WAVE_LIMIT) ? ` (this wave: up to ${WAVE_LIMIT})` : ""),
  );

  if (DRY_RUN) {
    console.log("\nDRY RUN — sample transforms:");
    for (const name of todo.slice(0, 8)) {
      const oldUrl = `${SUPABASE_URL}${OBJECT_PREFIX}${name}`;
      console.log(`  ${name}\n    -> ${rewriteUrl(oldUrl)}`);
    }
    return done;
  }

  let ok = 0,
    failed = 0,
    bytesIn = 0,
    bytesOut = 0;
  const wave = todo.slice(0, WAVE_LIMIT);
  for (const name of wave) {
    try {
      const { data, error } = await supabase.storage.from(BUCKET).download(name);
      if (error || !data) throw new Error(error?.message ?? "no data");
      const input = Buffer.from(await data.arrayBuffer());
      const { detailBytes, cardBytes } = await uploadPhotoToR2(name, input);
      bytesIn += input.length;
      bytesOut += detailBytes + (cardBytes ?? 0);
      done.add(name);
      ok += 1;
      if (ok % 100 === 0) {
        saveProgress(done);
        console.log(`  … ${ok}/${wave.length} uploaded`);
      }
    } catch (e) {
      failed += 1;
      console.error(`  ✗ ${name}: ${(e as Error).message}`);
    }
  }
  saveProgress(done);
  console.log(
    `\nuploaded ${ok}, failed ${failed} of ${wave.length}; ` +
      `${(bytesIn / 1e6).toFixed(0)} MB in -> ${(bytesOut / 1e6).toFixed(0)} MB out (WebP)` +
      `\ntotal migrated so far: ${done.size}/${all.length}`,
  );
  if (done.size < all.length)
    console.log(
      `⏳ ${all.length - done.size} left — re-run to continue (resumes from checkpoint).`,
    );
  return done;
}

// Rewrite venues.img_url + photo_urls[] + map_url and events.img_url from the
// Supabase host to img.funldn.com. `uploaded` gates each URL (null = dry-run
// full preview). Deterministic + idempotent; ordered pagination so no row is
// skipped or double-visited.
async function dbRewritePhase(uploaded: Set<string> | null): Promise<void> {
  console.log("\n── DB URL rewrite ──");

  type VRow = {
    id: string;
    img_url: string | null;
    photo_urls: string[] | null;
    map_url: string | null;
  };
  const venues: VRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("venues")
      .select("id,img_url,photo_urls,map_url")
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`read venues: ${error.message}`);
    if (!data?.length) break;
    venues.push(...(data as VRow[]));
    if (data.length < 1000) break;
  }
  let vChanged = 0;
  for (const v of venues) {
    const nextImg = rewriteUrl(v.img_url, uploaded);
    const nextPhotos =
      v.photo_urls?.map((u) => rewriteUrl(u, uploaded) ?? u) ?? null;
    const nextMap = rewriteUrl(v.map_url, uploaded);
    const changed =
      nextImg !== v.img_url ||
      nextMap !== v.map_url ||
      JSON.stringify(nextPhotos) !== JSON.stringify(v.photo_urls);
    if (!changed) continue;
    vChanged += 1;
    if (DRY_RUN) continue;
    const { error } = await supabase
      .from("venues")
      .update({ img_url: nextImg, photo_urls: nextPhotos, map_url: nextMap })
      .eq("id", v.id);
    if (error) console.error(`  ✗ venue ${v.id}: ${error.message}`);
  }

  // Events (popup posters mirrored into the same bucket) — paginated.
  type ERow = { id: string; img_url: string | null };
  const events: ERow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("events")
      .select("id,img_url")
      .ilike("img_url", `%${OBJECT_PREFIX}%`)
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`read events: ${error.message}`);
    if (!data?.length) break;
    events.push(...(data as ERow[]));
    if (data.length < 1000) break;
  }
  let eChanged = 0;
  for (const e of events) {
    const next = rewriteUrl(e.img_url, uploaded);
    if (next === e.img_url) continue;
    eChanged += 1;
    if (DRY_RUN) continue;
    const { error } = await supabase
      .from("events")
      .update({ img_url: next })
      .eq("id", e.id);
    if (error) console.error(`  ✗ event ${e.id}: ${error.message}`);
  }

  console.log(
    `${DRY_RUN ? "[dry] would rewrite" : "rewrote"} ${vChanged} venue rows + ${eChanged} event rows`,
  );

  if (!DRY_RUN) {
    // Convergence: rows still pointing at the Supabase host across ALL surfaces.
    const stillOnSupabase = venues.filter(
      (v) =>
        v.img_url?.includes(OBJECT_PREFIX) ||
        v.map_url?.includes(OBJECT_PREFIX) ||
        v.photo_urls?.some((u) => u.includes(OBJECT_PREFIX)),
    ).length;
    console.log(
      `convergence — venue rows still referencing Supabase storage: ${stillOnSupabase} ` +
        `(expected > 0 until every object is uploaded)`,
    );
  }
}

// Optional post-migration safety pass: HEAD every img.funldn.com URL the DB now
// references and report any that 404 — run this and see 0 misses BEFORE emptying
// the Supabase bucket.
async function verifyPhase(): Promise<void> {
  console.log("\n── VERIFY (HEAD every referenced R2 URL) ──");
  const urls = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("venues")
      .select("img_url,photo_urls,map_url")
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`read venues: ${error.message}`);
    if (!data?.length) break;
    for (const v of data as {
      img_url: string | null;
      photo_urls: string[] | null;
      map_url: string | null;
    }[]) {
      for (const u of [v.img_url, v.map_url, ...(v.photo_urls ?? [])])
        if (u && u.startsWith(R2_PUBLIC_BASE)) urls.add(u);
    }
    if (data.length < 1000) break;
  }
  console.log(`checking ${urls.size} distinct R2 URLs…`);
  let miss = 0,
    n = 0;
  for (const u of urls) {
    try {
      const res = await fetch(u, { method: "HEAD" });
      if (!res.ok) {
        miss += 1;
        console.error(`  ✗ ${res.status} ${u}`);
      }
    } catch (e) {
      miss += 1;
      console.error(`  ✗ ${(e as Error).message} ${u}`);
    }
    if (++n % 500 === 0) console.log(`  … ${n}/${urls.size}`);
  }
  console.log(
    miss === 0
      ? `✅ all ${urls.size} R2 URLs resolve — safe to empty the Supabase bucket.`
      : `🚫 ${miss} URL(s) 404 — do NOT empty the Supabase bucket yet.`,
  );
}

async function main(): Promise<void> {
  if (process.argv.includes("--verify")) {
    await verifyPhase();
    return;
  }
  const uploaded = DB_ONLY ? loadProgress() : await uploadPhase();
  // Dry-run previews the full end-state (no gate); real runs gate on the
  // checkpoint so a partial wave never points a row at a missing object.
  await dbRewritePhase(DRY_RUN ? null : uploaded);
  console.log("\ndone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
