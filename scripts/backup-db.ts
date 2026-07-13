// ─────────────────────────────────────────────────────────────────────────
// Weekly logical DB backup to a PRIVATE Cloudflare R2 bucket.
//
// WHY: once the venue photos moved to R2, the ONLY remaining reason to pay for
// Supabase Pro is its daily backups. The database is tiny (~30 MB) and most of
// it (venues, embeddings, pending_candidates, partner_prospects) regenerates
// from the pipelines. The irreplaceable data is a few hundred KB of user rows
// (profiles, saved_venues, bookings, feedback, plans, user_events). A weekly
// logical export to a private R2 bucket makes cancelling Pro safe, at zero
// extra cost (R2 free tier is 10 GB).
//
// This is a full service-role export: it reads EVERY column of EVERY listed
// table (select("*") is correct here, and the only place it is), gzips one
// JSON archive, and uploads it to a bucket that is NOT world-readable.
//
// One honest limitation: this exports the `public` schema only. `auth.users`
// (the login accounts) lives in the `auth` schema and is not reachable via
// PostgREST, so it is NOT captured. At current scale (a handful of users) that
// is acceptable; see docs/RESTORE.md for the pg_dump route to a full backup.
//
// Env (GitHub Actions secrets + local .env.local):
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT,
//   R2_BACKUP_BUCKET  (a PRIVATE bucket, NEVER the public photos bucket)
//
// Usage:
//   pnpm backup-db:dry              # build + print the manifest, no upload
//   pnpm backup-db                  # upload + prune old archives
//   pnpm backup-db -- --keep-weeks=8
// ─────────────────────────────────────────────────────────────────────────

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { gzipSync } from "node:zlib";
import { createClient } from "@supabase/supabase-js";
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

const DRY_RUN = process.argv.includes("--dry-run");
const keepArg = process.argv.find((a) => a.startsWith("--keep-weeks="));
const KEEP_WEEKS = keepArg ? Number(keepArg.split("=")[1]) : 12;
if (!Number.isFinite(KEEP_WEEKS) || KEEP_WEEKS <= 0) {
  console.error("--keep-weeks must be a positive number");
  process.exit(1);
}

// The runner passes BACKUP_DATE so the archive key is deterministic; local
// runs fall back to today (UTC).
const BACKUP_DATE =
  process.env.BACKUP_DATE?.trim() || new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(BACKUP_DATE)) {
  console.error(`BACKUP_DATE must be YYYY-MM-DD, got "${BACKUP_DATE}"`);
  process.exit(1);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

// The public photos bucket is world-readable via img.funldn.com. A backup here
// would be an enumerable PII leak, so refuse to ever write to it.
const PUBLIC_PHOTO_BUCKET = (process.env.R2_BUCKET || "fun-london-photos").trim();
const BACKUP_BUCKET = process.env.R2_BACKUP_BUCKET?.trim();
if (!DRY_RUN) {
  if (!BACKUP_BUCKET) {
    console.error(
      "R2_BACKUP_BUCKET is not set. Refusing to run without a private backup " +
        "bucket (never reuse the public photos bucket).",
    );
    process.exit(1);
  }
  if (BACKUP_BUCKET === PUBLIC_PHOTO_BUCKET) {
    console.error(
      `R2_BACKUP_BUCKET ("${BACKUP_BUCKET}") is the public photos bucket. ` +
        "Backups must go to a SEPARATE private bucket.",
    );
    process.exit(1);
  }
}

// The tables to back up. ADD NEW APP TABLES HERE when the schema grows, or they
// will be silently absent from backups. `orderBy` is the stable key (or keys,
// for a composite PK) used to paginate past PostgREST's 1000-row cap WITHOUT
// skipping or duplicating rows. It must be a unique, not-null ordering; leaving
// it null is only safe for a table that can never exceed one page. Ephemeral
// `_backup_*` tables are intentionally omitted.
const TABLES: { name: string; orderBy: string | string[] | null }[] = [
  // User data (irreplaceable; the reason this job exists)
  { name: "profiles", orderBy: "id" },
  // Composite PK (user_id, venue_id): order by both so paging is stable once
  // this join table crosses 1000 rows.
  { name: "saved_venues", orderBy: ["user_id", "venue_id"] },
  { name: "bookings", orderBy: "id" },
  { name: "feedback", orderBy: "id" },
  { name: "plans", orderBy: "id" },
  { name: "user_events", orderBy: "id" },
  // Catalogue (regenerable from pipelines, but cheap to include)
  { name: "venues", orderBy: "id" },
  { name: "venue_embeddings", orderBy: "venue_id" },
  { name: "pending_candidates", orderBy: "id" },
  { name: "partner_prospects", orderBy: "id" },
  { name: "events", orderBy: "id" },
];

const PAGE = 1000;

const supabase = createClient(SUPABASE_URL, SERVICE, {
  auth: { persistSession: false },
});

// Fetch every row of one table, paginating by a stable key so pages do not
// overlap or skip. select("*") is deliberate: a backup needs every column, and
// this is a service-role script with no anonymous surface.
async function dumpTable(
  name: string,
  orderBy: string | string[] | null,
): Promise<Record<string, unknown>[]> {
  const keys = orderBy == null ? [] : Array.isArray(orderBy) ? orderBy : [orderBy];
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from(name)
      .select("*")
      .range(from, from + PAGE - 1);
    for (const k of keys) q = q.order(k, { ascending: true });
    const { data, error } = await q;
    if (error) throw new Error(`${name}: ${error.message}`);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return rows;
}

// Delete archives whose date in the key is older than KEEP_WEEKS weeks.
async function pruneOld(r2: S3Client): Promise<string[]> {
  const cutoff = new Date(BACKUP_DATE);
  cutoff.setUTCDate(cutoff.getUTCDate() - KEEP_WEEKS * 7);
  const deleted: string[] = [];
  let ContinuationToken: string | undefined;
  do {
    const list = await r2.send(
      new ListObjectsV2Command({
        Bucket: BACKUP_BUCKET!,
        Prefix: "db-backup-",
        ContinuationToken,
      }),
    );
    for (const obj of list.Contents ?? []) {
      const m = obj.Key?.match(/^db-backup-(\d{4}-\d{2}-\d{2})\.json\.gz$/);
      if (!m) continue;
      if (new Date(m[1]) < cutoff) {
        await r2.send(
          new DeleteObjectCommand({ Bucket: BACKUP_BUCKET!, Key: obj.Key! }),
        );
        deleted.push(obj.Key!);
      }
    }
    ContinuationToken = list.IsTruncated
      ? list.NextContinuationToken
      : undefined;
  } while (ContinuationToken);
  return deleted;
}

async function main() {
  console.log(
    `Fun London DB backup · ${BACKUP_DATE} · ${DRY_RUN ? "DRY RUN" : "WRITING"}\n`,
  );

  const data: Record<string, Record<string, unknown>[]> = {};
  const counts: { name: string; rows: number }[] = [];
  for (const t of TABLES) {
    const rows = await dumpTable(t.name, t.orderBy);
    data[t.name] = rows;
    counts.push({ name: t.name, rows: rows.length });
    console.log(`  ${t.name.padEnd(20)} ${rows.length} rows`);
  }
  const totalRows = counts.reduce((s, c) => s + c.rows, 0);

  const archive = {
    manifest: {
      generated_at: BACKUP_DATE,
      keep_weeks: KEEP_WEEKS,
      schema_note:
        "public schema only; auth.users NOT included (see docs/RESTORE.md)",
      total_rows: totalRows,
      tables: counts,
    },
    data,
  };

  const gz = gzipSync(Buffer.from(JSON.stringify(archive)));
  const sizeMb = (gz.length / 1024 / 1024).toFixed(2);
  const key = `db-backup-${BACKUP_DATE}.json.gz`;

  let deleted: string[] = [];
  if (!DRY_RUN) {
    for (const k of ["R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]) {
      if (!process.env[k]?.trim()) {
        console.error(`Missing ${k} (required to upload the backup to R2)`);
        process.exit(1);
      }
    }
    const r2 = new S3Client({
      region: "auto",
      endpoint: process.env.R2_ENDPOINT!.trim(),
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!.trim(),
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!.trim(),
      },
    });
    await r2.send(
      new PutObjectCommand({
        Bucket: BACKUP_BUCKET!,
        Key: key,
        Body: gz,
        ContentType: "application/gzip",
      }),
    );
    deleted = await pruneOld(r2);
  }

  console.log(`\n─── SUMMARY ───`);
  console.log(`date        ${BACKUP_DATE}`);
  console.log(`tables      ${counts.length}`);
  console.log(`total rows  ${totalRows}`);
  console.log(`archive     ${key}  (${sizeMb} MB gzipped)`);
  if (DRY_RUN) {
    console.log(`upload      SKIPPED (dry run)`);
  } else {
    console.log(`upload      OK to private bucket "${BACKUP_BUCKET}"`);
    console.log(
      `pruned      ${deleted.length} archive(s) older than ${KEEP_WEEKS} weeks` +
        (deleted.length ? `: ${deleted.join(", ")}` : ""),
    );
  }
}

main().catch((err) => {
  console.error(`\n✗ backup failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
