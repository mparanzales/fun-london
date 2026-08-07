// Fun London — repair type / daypart / moods / tags on ALREADY-PUBLISHED venues.
//
// WHY (2026-08-07). Before lib/google-place-types.ts existed, publishing
// guessed `type` from keywords in the candidate name and defaulted anything
// unrecognised to Restaurant / Evening / ["dinner"]. 45% of one wave was
// wrong, and the mistyped rows entered the night planner's DINNER POOL:
// Osterley Bookshop, Burlington Arcade and The London Dungeon were all live as
// evening restaurants. This script re-derives those fields from Google's own
// category for rows already in the catalogue.
//
// 💸 COST: one Place Details call per venue with the mask
// `id,primaryType,types,regularOpeningHours` — Pro tier (5,000 free/month).
// A ~150-venue repair is free. It deliberately does NOT request photos,
// reviews, rating or website, which would push the call to Enterprise.
//
// WHAT IT WRITES: type, time_of_day, mood_tags, canonical_tags (+version),
// vibe_tags and `vibe` ONLY when those are empty or still the "London
// favourite" fallback — a hand-curated venue is never overwritten.
//
// 🧨 NOT-A-VENUE ROWS: when Google's categories are not publishable at all (a
// shop, a shopping centre), the row is HIDDEN (hidden_at), not deleted, and
// listed in the report. Hiding is reversible and takes it out of every feed,
// search and plan immediately; deletion would break saved_venues. Deciding
// whether it should come back is Maria's, not this script's.
//
// Run:
//   pnpm reclassify:dry     # report only, still makes the Google calls
//   pnpm reclassify         # write
//   pnpm reclassify -- --limit=20
//   pnpm reclassify -- --slugs=a,b,c
//
// Required environment (.env.local):
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_PLACES_API_KEY

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  classifyFromGoogle,
  refineTimeOfDay,
  displayTagsFor,
  humanTypeLabel,
} from "@/lib/google-place-types";
import {
  rawTagsToCanonical,
  fallbackCanonicalTags,
  TAG_VERSION,
} from "@/lib/tag-vocabulary";

const DRY_RUN = process.argv.includes("--dry-run");
const arg = (name: string): string | null => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
};
const LIMIT = (() => {
  const v = arg("limit");
  if (v === null) return 200;
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`Invalid --limit="${v}"`);
    process.exit(1);
  }
  return n;
})();
const SLUGS = (arg("slugs") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const KEY = process.env.GOOGLE_PLACES_API_KEY;
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY || !URL_ || !SERVICE) {
  console.error(
    "Missing GOOGLE_PLACES_API_KEY / NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
  );
  process.exit(1);
}

const supabase: SupabaseClient = createClient(URL_, SERVICE, {
  auth: { persistSession: false },
});

// The generic hero line the old fallback wrote. Rows still carrying it have
// never been hand-written, so replacing it destroys nothing.
const FALLBACK_VIBE = "London favourite";

type Row = {
  id: string;
  slug: string;
  name: string;
  type: string;
  time_of_day: string;
  vibe: string | null;
  vibe_tags: string[] | null;
  mood_tags: string[] | null;
  google_place_id: string;
  hidden_at: string | null;
};

async function placeCategories(placeId: string): Promise<{
  primaryType?: string;
  types?: string[];
  regularOpeningHours?: { periods?: unknown[] };
} | null> {
  const res = await fetch(
    `https://places.googleapis.com/v1/places/${placeId}`,
    {
      headers: {
        "X-Goog-Api-Key": KEY!,
        // Categories + hours ONLY. Adding rating/website/photos here would move
        // the whole call from Pro to Enterprise tier (1,000 free vs 5,000).
        "X-Goog-FieldMask": "id,primaryType,types,regularOpeningHours",
      },
    },
  );
  if (!res.ok) {
    throw new Error(
      `Place details ${res.status} ${(await res.text()).slice(0, 160)}`,
    );
  }
  return (await res.json()) as {
    primaryType?: string;
    types?: string[];
    regularOpeningHours?: { periods?: unknown[] };
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isQuota = (e: unknown) =>
  /\b429\b|RESOURCE_EXHAUSTED|RATE_LIMIT_EXCEEDED/.test(
    e instanceof Error ? e.message : String(e),
  );

async function main() {
  console.log(
    `Fun London · reclassify venues · ${DRY_RUN ? "DRY RUN" : "WRITING"}\n`,
  );

  // Target the rows the old guesser touched: everything it auto-published
  // (curation_tier "discovered") that still wears the fallback hero line, plus
  // everything published since the bulk waves began. Curated venues are never
  // in scope.
  let q = supabase
    .from("venues")
    .select(
      "id, slug, name, type, time_of_day, vibe, vibe_tags, mood_tags, google_place_id, hidden_at",
    )
    .not("google_place_id", "is", null)
    .eq("curation_tier", "discovered")
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  if (SLUGS.length > 0) q = q.in("slug", SLUGS);
  else q = q.or(`vibe.eq.${FALLBACK_VIBE},created_at.gte.2026-08-04`);

  const { data, error } = await q;
  if (error) throw new Error(`venues read failed: ${error.message}`);
  const rows = (data ?? []) as Row[];
  console.log(`${rows.length} venue(s) in scope\n`);

  const changed: string[] = [];
  const hidden: string[] = [];
  const unchanged: string[] = [];
  const failed: { slug: string; error: string }[] = [];
  let processed = 0;
  let quotaStopped = false;

  for (const v of rows) {
    processed++;
    try {
      const g = await placeCategories(v.google_place_id);
      const res = classifyFromGoogle(g?.primaryType, g?.types);

      if (!res.ok) {
        // Not a going-out venue at all. Hide rather than delete.
        console.log(`  ✗ ${v.slug}: ${res.reason} → hide`);
        hidden.push(`${v.slug} (${res.reason})`);
        if (!DRY_RUN && !v.hidden_at) {
          const { error: e } = await supabase
            .from("venues")
            .update({ hidden_at: new Date().toISOString() })
            .eq("id", v.id);
          if (e) throw new Error(`hide failed: ${e.message}`);
        }
        await sleep(150);
        continue;
      }

      const cls = res.classification;
      const timeOfDay = refineTimeOfDay(
        cls.timeOfDay,
        g?.regularOpeningHours?.periods as never,
      );
      const tags = displayTagsFor(g?.primaryType, g?.types);

      const patch: Record<string, unknown> = {};
      if (v.type !== cls.type) patch.type = cls.type;
      if (v.time_of_day !== timeOfDay) patch.time_of_day = timeOfDay;
      const moods = cls.moods as string[];
      if ((v.mood_tags ?? []).join("|") !== moods.join("|"))
        patch.mood_tags = moods;

      // Display fields: only fill what is empty or still the fallback, so a
      // hand-written venue is never overwritten by a restated Google category.
      const hasTags = (v.vibe_tags?.length ?? 0) > 0;
      if (!hasTags && tags.length > 0) patch.vibe_tags = tags;
      if (!v.vibe || v.vibe === FALLBACK_VIBE) {
        patch.vibe = humanTypeLabel(cls.matchedGoogleType);
      }

      // Canonical tags follow whatever the tags/type/moods ended up as.
      const finalTags = (patch.vibe_tags as string[]) ?? v.vibe_tags ?? [];
      const canonical =
        rawTagsToCanonical(finalTags).length > 0
          ? rawTagsToCanonical(finalTags)
          : fallbackCanonicalTags(cls.type, moods);
      patch.canonical_tags = canonical;
      patch.canonical_tags_version = TAG_VERSION;

      // canonical_* alone is not a user-visible change; only report rows whose
      // type/daypart/moods/copy actually moved.
      const meaningful = Object.keys(patch).filter(
        (k) => k !== "canonical_tags" && k !== "canonical_tags_version",
      );
      if (meaningful.length === 0) {
        unchanged.push(v.slug);
      } else {
        console.log(
          `  ✓ ${v.slug}: ${v.type}/${v.time_of_day} → ${cls.type}/${timeOfDay}` +
            (patch.vibe_tags ? ` · tags ${tags.join(", ")}` : "") +
            ` (Google: ${cls.matchedGoogleType})`,
        );
        changed.push(v.slug);
      }

      if (!DRY_RUN) {
        const { error: e } = await supabase
          .from("venues")
          .update(patch)
          .eq("id", v.id);
        if (e) throw new Error(`update failed: ${e.message}`);
      }
      await sleep(150);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isQuota(err)) {
        console.log(
          `\n⏸ Google quota/rate limit at "${v.slug}" — stopping; re-run tomorrow to finish the rest.`,
        );
        quotaStopped = true;
        break;
      }
      console.error(`  ✗ ${v.slug}: ${msg}`);
      failed.push({ slug: v.slug, error: msg });
    }
  }

  console.log("\n─────────── SUMMARY ───────────");
  console.log(`Processed:      ${processed}/${rows.length}`);
  if (quotaStopped)
    console.log(`⏸ STOPPED EARLY (quota) — ${rows.length - processed} left`);
  console.log(`Reclassified:   ${changed.length}`);
  console.log(`Hidden:         ${hidden.length}`);
  console.log(`Already right:  ${unchanged.length}`);
  console.log(`Failed:         ${failed.length}`);
  if (hidden.length > 0) {
    console.log("\nHidden (not going-out venues) — reversible, your call:");
    hidden.forEach((h) => console.log(`  · ${h}`));
  }
  if (failed.length > 0) {
    console.log("\nFailed:");
    failed.forEach((f) => console.log(`  ✗ ${f.slug}: ${f.error}`));
  }
  if (DRY_RUN) console.log("\n[dry-run] nothing written.");
}

main().catch((err) => {
  console.error(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
