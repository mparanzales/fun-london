# Restoring the database from a backup

The `backup-db` workflow (`.github/workflows/backup-db.yml`) writes a weekly
gzipped JSON archive of every public table to a **private** Cloudflare R2 bucket
(`R2_BACKUP_BUCKET`). This is the £0 replacement for Supabase Pro's daily
backups. Here is how to bring the data back.

## What the archive contains

`db-backup-YYYY-MM-DD.json.gz` decompresses to:

```json
{
  "manifest": { "generated_at", "total_rows", "tables": [{ "name", "rows" }] },
  "data": { "profiles": [...], "venues": [...], ... }
}
```

Tables captured (see `scripts/backup-db.ts` for the authoritative list):
`profiles`, `saved_venues`, `bookings`, `feedback`, `plans`, `user_events`,
`venues`, `venue_embeddings`, `pending_candidates`, `partner_prospects`,
`events`.

## The one limitation (read before relying on this)

The export is **`public` schema only**. `auth.users` (the actual login
accounts) lives in the `auth` schema and is not reachable through PostgREST, so
it is **not** in the archive. `profiles.id` references `auth.users.id`; if the
auth accounts are gone, those rows have to be re-linked to new sign-ups.

At current scale (a handful of users) this is acceptable, and everything else is
either irreplaceable-but-tiny (the user tables) or regenerable from the
pipelines (venues, embeddings, candidates, prospects). If you ever want a
**full** backup that includes auth, run `pg_dump` against the direct Postgres
connection instead: add a `SUPABASE_DB_URL` secret (Supabase dashboard ->
Database -> Connection string, the pooler URL with password) and
`pg_dump "$SUPABASE_DB_URL" | gzip` in place of this script. That is the only
change needed; the R2 upload stays the same.

## Restore steps

1. **Recreate the schema.** On a fresh or reset project, apply
   `supabase/schema.sql` (Supabase dashboard SQL editor, or `psql < schema.sql`).
   Confirm the tables above exist and are empty.

   > On a genuinely fresh/reset project `auth.users` is also empty. `profiles`,
   > `saved_venues`, `bookings`, `plans`, and `user_events` all FK to
   > `auth.users`, so you must restore or recreate the auth accounts FIRST (the
   > `pg_dump` route below, or have users sign up again and match by email)
   > before the tiered upserts in step 3, or those upserts will fail the foreign
   > key. When only table data was lost and auth is intact, skip straight to
   > step 3.

2. **Download the archive** from the private R2 bucket (Cloudflare dashboard ->
   R2 -> `R2_BACKUP_BUCKET` -> the dated object), and decompress:
   `gunzip db-backup-YYYY-MM-DD.json.gz`.

3. **Upsert the rows back, in FK order.** Parent tables before children, so
   foreign keys resolve:
   1. `profiles`, `venues`, `events`
   2. `venue_embeddings`, `pending_candidates`, `partner_prospects`
   3. `saved_venues`, `bookings`, `plans`, `user_events`

   For each table, upsert its `data[table]` array with the service-role client
   (`onConflict` on the primary key). A short one-off script mirrors
   `backup-db.ts` in reverse:

   ```ts
   // scripts/restore-db.ts (write when needed; kept out of the repo until then)
   for (const table of ORDER) {
     const rows = archive.data[table];
     if (rows?.length) {
       await supabase.from(table).upsert(rows); // batches of ~500 if large
     }
   }
   ```

4. **Re-link auth if needed.** If the auth accounts were lost, have users sign
   up again; match new `auth.users.id` to the restored `profiles` by email, or
   accept fresh profiles. (Not needed when only table data was lost and auth is
   intact.)

5. **Verify.** Row counts per table should match the archive's manifest;
   signed-out `/explore` renders; a signed-in save round-trips.

## Testing the backup without a restore

`pnpm backup-db:dry` builds the archive against prod and prints the manifest
(table row counts + gzipped size) without uploading. Run it any time to confirm
the job still captures everything after a schema change.
