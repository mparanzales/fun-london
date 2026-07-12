// Prune definitively expired events from public.events, whatever their source.
//
// The deleted pop-up radar cron used to be the ONLY expired-event cleanup (and
// it only covered source='popup'), so past-dated Ticketmaster/Eventbrite rows
// could linger and render as live. This script is the source-agnostic
// replacement, run nightly from .github/workflows/maintenance.yml.
//
// An event is "definitively over" when, with a full day of grace:
//   - ends_at is set and ends_at < now() - 1 day, OR
//   - ends_at is null and starts_at < now() - 1 day
// Rows with neither date are left alone (we can't prove their run ended).
//
// EXCEPTIONS (never deleted, only listed in the output):
//   - curated_at set: that column marks Maria's hand-written copy, and
//     hand-written copy must never be silently destroyed; a human decides.
//   - cancelled_at set: that stamp is how Hide works, and ingest-events.ts
//     promises it is permanent. Deleting the row would let the next cron
//     tick re-insert the event WITHOUT the stamp, silently undoing the Hide.
//     Hidden rows are already invisible to readers; leave them be.
// Both guards live in the queries themselves (and the delete), not just in
// post-filtering, so a code shuffle can't silently drop them.
//
// Run:
//   pnpm prune-expired-events:dry   # print what would be deleted/skipped, no writes
//   pnpm prune-expired-events       # delete (service role required)
//   ... -- --cutoff=2026-08-01T00:00:00Z   # override the cutoff (testing only)
//
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const DRY_RUN = process.argv.includes("--dry-run");
const cutoffArg = process.argv.find((a) => a.startsWith("--cutoff="));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
  );
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE, {
  auth: { persistSession: false },
});

type EventRow = {
  id: string;
  name: string;
  source: string | null;
  starts_at: string | null;
  ends_at: string | null;
  curated_at: string | null;
  cancelled_at: string | null;
};

const EVENT_COLUMNS =
  "id, name, source, starts_at, ends_at, curated_at, cancelled_at";

const fmtDay = (iso: string | null): string =>
  iso ? iso.slice(0, 10) : "(no date)";

async function main() {
  // A full day of grace past the event's end, so a show that finished late
  // last night is never yanked the following morning.
  const cutoff = cutoffArg
    ? new Date(cutoffArg.split("=")[1]).toISOString()
    : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  console.log(
    `prune-expired-events · ${DRY_RUN ? "DRY-RUN (no delete)" : "DELETE"} · cutoff ${cutoff}\n`,
  );

  // Definitively over: the run's end (or its only known date) is more than a
  // day in the past. Rows with no dates at all never match either branch.
  const expiredFilter = `and(ends_at.not.is.null,ends_at.lt.${cutoff}),and(ends_at.is.null,starts_at.lt.${cutoff})`;

  // Deletable: expired AND unprotected. The curated/cancelled guards are part
  // of the query itself (and repeated on the delete below), by design.
  const { data: delData, error: delReadErr } = await supabase
    .from("events")
    .select(EVENT_COLUMNS)
    .or(expiredFilter)
    .is("curated_at", null)
    .is("cancelled_at", null)
    .order("ends_at", { ascending: true, nullsFirst: false });
  if (delReadErr) {
    console.error(`read failed: ${delReadErr.message}`);
    process.exit(1);
  }
  const deletable = (delData ?? []) as EventRow[];

  // Protected: expired but curated (hand-written) or cancelled (Hidden).
  // Fetched separately so the skip report can name them.
  const { data: skipData, error: skipReadErr } = await supabase
    .from("events")
    .select(EVENT_COLUMNS)
    .or(expiredFilter)
    .or("curated_at.not.is.null,cancelled_at.not.is.null")
    .order("ends_at", { ascending: true, nullsFirst: false });
  if (skipReadErr) {
    console.error(`read failed: ${skipReadErr.message}`);
    process.exit(1);
  }
  const skipped = (skipData ?? []) as EventRow[];
  const curated = skipped.filter((r) => r.curated_at !== null);
  const cancelled = skipped.filter(
    (r) => r.curated_at === null && r.cancelled_at !== null,
  );

  console.log(`${deletable.length + skipped.length} expired event(s) found`);

  if (curated.length > 0) {
    console.log(
      `\nSKIPPED (curated_at set, hand-written copy is never auto-deleted):`,
    );
    for (const r of curated) {
      console.log(
        `  • ${r.name} [${r.source ?? "?"}] ended ${fmtDay(r.ends_at ?? r.starts_at)} (curated ${fmtDay(r.curated_at)})`,
      );
    }
  }

  if (cancelled.length > 0) {
    console.log(
      `\nSKIPPED (cancelled_at set, deleting would let the next ingest undo the Hide):`,
    );
    for (const r of cancelled) {
      console.log(
        `  • ${r.name} [${r.source ?? "?"}] ended ${fmtDay(r.ends_at ?? r.starts_at)} (hidden ${fmtDay(r.cancelled_at)})`,
      );
    }
  }

  if (deletable.length === 0) {
    console.log(`\nNothing to delete.`);
  } else {
    console.log(`\n${DRY_RUN ? "WOULD DELETE" : "DELETING"}:`);
    for (const r of deletable) {
      console.log(
        `  • ${r.name} [${r.source ?? "?"}] ended ${fmtDay(r.ends_at ?? r.starts_at)}`,
      );
    }
    if (!DRY_RUN) {
      const ids = deletable.map((r) => r.id);
      // Guards repeated here on purpose: even a stale id list can never
      // take out a curated or Hidden row.
      const { error: delError } = await supabase
        .from("events")
        .delete()
        .in("id", ids)
        .is("curated_at", null)
        .is("cancelled_at", null);
      if (delError) {
        console.error(`\ndelete failed: ${delError.message}`);
        process.exit(1);
      }
    }
  }

  // SUMMARY block (the GitHub Actions step renders this for the maintainer).
  console.log("\n─────────── SUMMARY ───────────");
  console.log(
    `${DRY_RUN ? "Would delete" : "Deleted"}: ${deletable.length} expired event(s)`,
  );
  console.log(`Skipped (curated): ${curated.length}`);
  console.log(`Skipped (hidden/cancelled): ${cancelled.length}`);
  console.log(`\n${DRY_RUN ? "Dry run complete." : "Prune complete."}`);
}

main().catch((e) => {
  console.error("\nFATAL:", e);
  process.exit(1);
});
