// Fun London — candidate scout (Phase 5 Tier 2).
//
// SKELETON — publication adapters are stubs (return [] until each is
// wired in a follow-up session). The orchestrator's shape is complete:
//
//   1. Fetch recent mentions from all 6 publication adapters in
//      parallel (Time Out / Eater / Infatuation / Hot Dinners /
//      Square Mile / Harden's).
//   2. Normalise venue names (lowercase, trim, strip "restaurant",
//      "soho", common stop-words used in titles).
//   3. Group mentions by normalised name; any venue with mentions
//      from >= 2 distinct publications in the last 24 months is a
//      candidate.
//   4. Apply the four hard filters:
//        a) Independent — Google Places search for the name in
//           London. If >= 6 distinct location results → flag as
//           chain (chain_risk_score = 1.00) → reject.
//        b) Verifiable — already done by step 3 (>= 2 sources).
//        c) Currently open — Google Places businessStatus = OPERATIONAL.
//        d) Has booking method — Google Places `reservable: true`
//           OR detectable booking link on the venue's website.
//   5. Dedupe against public.venues (and pending_candidates) by
//      google_place_id and by normalised name. Set `matches_venue_slug`
//      on duplicates so they're hidden from /admin/candidates.
//   6. Insert into public.pending_candidates with status='pending'
//      and the full filter_results audit trail.
//
// Maria reviews at /admin/candidates and approves / rejects / snoozes
// / edits. Approved candidates flow into `pnpm ingest:from-pending`
// (separate script, follow-up).
//
// Run:
//   pnpm scout-candidates:dry   # log what would happen, no DB writes
//   pnpm scout-candidates       # writes

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type {
  PublicationAdapter,
  PublicationMention,
} from "./candidate-sources/_types";
import { timeoutAdapter } from "./candidate-sources/timeout";
import { eaterAdapter } from "./candidate-sources/eater";
import { infatuationAdapter } from "./candidate-sources/infatuation";
import { hotDinnersAdapter } from "./candidate-sources/hot-dinners";
import { squareMileAdapter } from "./candidate-sources/square-mile";
import { hardensAdapter } from "./candidate-sources/hardens";

const DRY_RUN = process.argv.includes("--dry-run");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL in env");
  process.exit(1);
}
if (!SUPABASE_SERVICE_ROLE_KEY && !DRY_RUN) {
  console.error(
    "Missing SUPABASE_SERVICE_ROLE_KEY in env (required for writes). " +
      "Run with --dry-run to skip writes.",
  );
  process.exit(1);
}

const supabase =
  SUPABASE_SERVICE_ROLE_KEY && SUPABASE_URL
    ? createSupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      })
    : null;

const ADAPTERS: PublicationAdapter[] = [
  timeoutAdapter,
  eaterAdapter,
  infatuationAdapter,
  hotDinnersAdapter,
  squareMileAdapter,
  hardensAdapter,
];

// ── Normalisation ───────────────────────────────────────────────────────
//
// Publication titles include editorial framing ("review", "soho", "test
// drive", etc.) that we strip to get a comparable key.

const STOP_WORDS = new Set([
  "review",
  "reviews",
  "first",
  "look",
  "test",
  "drive",
  "driving",
  "new",
  "the",
  "a",
  "an",
  "restaurant",
  "bar",
  "pub",
  "cafe",
  "london",
  "soho",
  "shoreditch",
  "bermondsey",
  "peckham",
  "hackney",
  "dalston",
  "borough",
  "mayfair",
  "clerkenwell",
  "farringdon",
]);

export function normaliseVenueName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[—–]/g, "-") // unify dashes
    .replace(/[^a-z0-9 \-]/g, " ") // drop punctuation
    .split(/[\s-]+/)
    .filter((w) => w && !STOP_WORDS.has(w))
    .join(" ")
    .trim();
}

// ── Chain heuristic (Google Places count) ───────────────────────────────
//
// STUB for Phase 2A — always returns 0 (clean). When wired:
//   - Hit Google Places textSearch with `<name> London`
//   - Count distinct location results (places.id, formattedAddress)
//   - If >= 6 distinct London locations → chain (score 1.00)
//   - Between 3-5 → borderline (score 0.50-0.80) → surface for Maria
//   - <= 2 → independent (score 0.00-0.20)

export async function chainRiskScore(_name: string): Promise<number> {
  // TODO(chain-heuristic): wire Google Places textSearch when Tier 2 ships
  // its first real adapter. Reuse the placesTextSearch helper pattern
  // from scripts/ingest-venues.ts.
  return 0;
}

// ── Grouping ────────────────────────────────────────────────────────────

type Candidate = {
  normalisedKey: string;
  displayName: string;
  mentions: PublicationMention[];
  distinctPublications: Set<string>;
};

function groupMentions(all: PublicationMention[]): Candidate[] {
  const map = new Map<string, Candidate>();
  for (const m of all) {
    const key = normaliseVenueName(m.venueName);
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, {
        normalisedKey: key,
        displayName: m.venueName.trim(),
        mentions: [],
        distinctPublications: new Set(),
      });
    }
    const c = map.get(key)!;
    c.mentions.push(m);
    c.distinctPublications.add(m.publication);
  }
  return Array.from(map.values()).filter(
    (c) => c.distinctPublications.size >= 2,
  );
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log(
    `Fun London — candidate scout · ${ADAPTERS.length} publication(s) · ${DRY_RUN ? "DRY RUN" : "WRITING"}\n`,
  );

  // Fetch all publications in parallel. If any one fails, others continue.
  const settled = await Promise.allSettled(
    ADAPTERS.map(async (a) => {
      const start = Date.now();
      try {
        const mentions = await a.fetchRecentMentions({ sinceMonths: 24 });
        console.log(
          `  ✓ ${a.publication}: ${mentions.length} mentions (${Date.now() - start}ms)`,
        );
        return { adapter: a, mentions };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ ${a.publication}: ${msg}`);
        return { adapter: a, mentions: [] as PublicationMention[] };
      }
    }),
  );

  const allMentions: PublicationMention[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") allMentions.push(...r.value.mentions);
  }

  console.log(`\nFetched ${allMentions.length} total mentions.`);

  // Cross-reference and group.
  const candidates = groupMentions(allMentions);
  console.log(
    `${candidates.length} venue(s) mentioned in >= 2 publications.\n`,
  );

  if (candidates.length === 0) {
    console.log(
      "No multi-source candidates. (Expected — all publication adapters " +
        "return [] until they're wired in follow-up sessions.)",
    );
    return;
  }

  let inserted = 0;
  let skippedDup = 0;
  let skippedChain = 0;

  for (const c of candidates) {
    // Filter 1: chain heuristic
    const chainScore = await chainRiskScore(c.displayName);
    if (chainScore >= 0.9) {
      console.log(`  ✗ chain-suspect: ${c.displayName} (score ${chainScore})`);
      skippedChain++;
      continue;
    }

    // TODO(filter 3 + 4): Google Places businessStatus + reservable check.
    // Defer to follow-up so this skeleton doesn't pretend to be complete.

    // Dedupe vs public.venues
    if (supabase) {
      const { data: existing } = await supabase
        .from("venues")
        .select("slug")
        .ilike("name", c.displayName)
        .maybeSingle();
      if (existing) {
        console.log(
          `  · dedupe: "${c.displayName}" already exists as ${existing.slug}`,
        );
        skippedDup++;
        continue;
      }
    }

    if (DRY_RUN) {
      console.log(
        `  [dry-run] would insert candidate: ${c.displayName} ` +
          `(${c.distinctPublications.size} sources)`,
      );
      inserted++;
      continue;
    }

    if (!supabase) continue;

    const { error } = await supabase.from("pending_candidates").upsert(
      {
        name: c.displayName,
        sources: c.mentions.map((m) => ({
          publication: m.publication,
          url: m.url,
          title: m.title,
          date: m.date,
        })),
        sources_count: c.distinctPublications.size,
        filter_results: {
          verifiable: {
            result: "pass",
            sources_count: c.distinctPublications.size,
          },
          chain: { result: "pass", score: chainScore },
        },
        chain_risk_score: chainScore,
        status: "pending",
      },
      { onConflict: "name" },
    );
    if (error) {
      console.error(`  ✗ insert failed for ${c.displayName}: ${error.message}`);
    } else {
      console.log(`  ✓ inserted candidate: ${c.displayName}`);
      inserted++;
    }
  }

  console.log("\n─────────── SUMMARY ───────────");
  console.log(`Mentions fetched:       ${allMentions.length}`);
  console.log(`Multi-source candidates: ${candidates.length}`);
  console.log(`Inserted to queue:      ${inserted}`);
  console.log(`Skipped (duplicates):   ${skippedDup}`);
  console.log(`Skipped (chain-suspect): ${skippedChain}`);
  console.log(`\n${DRY_RUN ? "Dry run complete." : "Scout complete."}`);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
