// Fun London — backfill canonical_tags on every venue.
//
// Translates each venue's raw vibe_tags into the canonical vocabulary
// (lib/tag-vocabulary.ts) and stores it in venues.canonical_tags, stamped with
// TAG_VERSION. This is the "make every venue speak the same language" step:
// the shared representation the recommender + search read. The ingest pipeline
// fills these going forward; this backfills everything already in the table.
//
// Re-runnable. By default it only touches rows that are out of date — either
// stamped with an older TAG_VERSION, or whose stored canonical_tags no longer
// match what the current vocabulary produces. So a routine run after the map
// changes is cheap and self-correcting. Pass --all to scan every row (needed
// when the import tag map changed without a TAG_VERSION bump and you want a full
// re-check rather than relying on the version stamp).
//
// Run:
//   pnpm backfill:tags:dry      # preview, no writes
//   pnpm backfill:tags          # write rows behind the current TAG_VERSION
//   pnpm backfill:tags --all     # re-check & write every row
//
// Required env (.env.local): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import {
  rawTagsToCanonical,
  fallbackCanonicalTags,
  TAG_VERSION,
} from "@/lib/tag-vocabulary";

const DRY_RUN = process.argv.includes("--dry-run");
const FORCE_ALL = process.argv.includes("--all");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL in .env.local");
  process.exit(1);
}
if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

type VenueRow = {
  id: string;
  slug: string;
  type: string;
  vibe_tags: string[] | null;
  mood_tags: string[] | null;
  canonical_tags: string[] | null;
  canonical_tags_version: number | null;
};

function sameTags(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function main() {
  console.log(
    `Backfill canonical_tags · TAG_VERSION=${TAG_VERSION} · ${
      DRY_RUN ? "DRY RUN" : "WRITING"
    }${FORCE_ALL ? " · --all" : ""}\n`,
  );

  const PAGE = 1000;
  let from = 0;
  let scanned = 0;
  let changed = 0;
  let unchanged = 0;
  const samples: string[] = [];

  for (;;) {
    // Without --all, only rows that haven't reached the current version. When
    // writing, updated rows leave this set, so we keep reading from offset 0;
    // for --all / dry-run there's no such churn, so we page forward.
    let q = supabase
      .from("venues")
      .select(
        "id, slug, type, vibe_tags, mood_tags, canonical_tags, canonical_tags_version",
      )
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (!FORCE_ALL) q = q.lt("canonical_tags_version", TAG_VERSION);

    const { data, error } = await q;
    if (error) {
      console.error("Fetch failed:", error.message);
      process.exit(1);
    }
    const rows = (data ?? []) as VenueRow[];
    if (rows.length === 0) break;

    for (const v of rows) {
      scanned++;
      let canonical = rawTagsToCanonical(v.vibe_tags ?? []);
      // Floor: a venue with no mappable tags still gets baseline tags from what
      // KIND of place it is, so nothing is invisible to the recommender.
      if (canonical.length === 0)
        canonical = fallbackCanonicalTags(v.type, v.mood_tags ?? []);
      const stale =
        (v.canonical_tags_version ?? 0) !== TAG_VERSION ||
        !sameTags(v.canonical_tags ?? [], canonical);

      if (!stale) {
        unchanged++;
        continue;
      }
      changed++;
      if (samples.length < 8) {
        const raw = v.vibe_tags ?? [];
        samples.push(
          `  ${v.slug}: [${raw.slice(0, 4).join(", ")}${
            raw.length > 4 ? ", ..." : ""
          }] -> [${canonical.join(", ") || "(none)"}]`,
        );
      }
      if (!DRY_RUN) {
        const { error: upErr } = await supabase
          .from("venues")
          .update({
            canonical_tags: canonical,
            canonical_tags_version: TAG_VERSION,
          })
          .eq("id", v.id);
        if (upErr) {
          console.error(`  x ${v.slug}: ${upErr.message}`);
          process.exit(1);
        }
      }
    }

    if (rows.length < PAGE) break;
    if (FORCE_ALL || DRY_RUN) from += PAGE;
  }

  if (samples.length > 0) {
    console.log("Examples:");
    for (const s of samples) console.log(s);
    console.log("");
  }
  console.log("--------------- SUMMARY ---------------");
  console.log(`Scanned:        ${scanned}`);
  console.log(`${DRY_RUN ? "Would update:  " : "Updated:       "} ${changed}`);
  console.log(`Already current: ${unchanged}`);
  console.log(`\n${DRY_RUN ? "Dry run complete." : "Done."}`);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
