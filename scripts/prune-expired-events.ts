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
// EXCEPTION: rows with curated_at set are NEVER deleted, only listed in the
// output. That column marks Maria's hand-written copy, and hand-written copy
// must never be silently destroyed; a human decides what happens to those.
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
};

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
  const { data, error } = await supabase
    .from("events")
    .select("id, name, source, starts_at, ends_at, curated_at")
    .or(
      `and(ends_at.not.is.null,ends_at.lt.${cutoff}),and(ends_at.is.null,starts_at.lt.${cutoff})`,
    )
    .order("ends_at", { ascending: true, nullsFirst: false });
  if (error) {
    console.error(`read failed: ${error.message}`);
    process.exit(1);
  }
  const rows = (data ?? []) as EventRow[];

  const curated = rows.filter((r) => r.curated_at !== null);
  const deletable = rows.filter((r) => r.curated_at === null);

  console.log(`${rows.length} expired event(s) found`);

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
      const { error: delError } = await supabase
        .from("events")
        .delete()
        .in("id", ids);
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
  console.log(`\n${DRY_RUN ? "Dry run complete." : "Prune complete."}`);
}

main().catch((e) => {
  console.error("\nFATAL:", e);
  process.exit(1);
});
