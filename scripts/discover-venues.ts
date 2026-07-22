// Fun London, Tier 2: autonomous venue discovery (all-Google, METERED,
// human-gated). Places is NOT free — see .github/workflows/discover-venues.yml
// for the cost breakdown that set this cadence.
//
// Runs unattended (GitHub Actions, WEEKLY). For each run it loops until it
// has QUEUED up to TARGET compliant new candidates, or it exhausts the search
// grid. Pipeline per candidate:
//
//   1. DISCOVER - Google Places search across a rotating London grid.
//   2. PRE-FILTER (cheap) - operational · rating >= 4.4 · >= 400 reviews ·
//      has website · food/drink type · not already in venues or the queue.
//   3. CHAIN CHECK - Google Places: count locations of the name in London;
//      >= CHAIN_LOCATIONS distinct => chain => reject (the maintainer's rule:
//      judge by number of locations, NOT a name denylist).
//   4. QUEUE - insert into public.pending_candidates (status "pending") with
//      the factual Places data plus a claim-free templated draft. A human
//      approves at /admin/candidates; approved rows are published by
//      scripts/ingest-from-pending.ts. Nothing is auto-published and no
//      generative model is involved anywhere (the old Gemini "trusted press
//      coverage" gate hallucinated sources and is gone for good). The numeric
//      gates plus human approval ARE the quality bar.
//
// Run:
//   pnpm discover-venues:dry            # no DB writes
//   pnpm discover-venues                # queue candidates for approval
//   pnpm discover-venues -- --limit=2   # cap target (for testing)

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Mood, VenueType } from "@/lib/types";
import { areaFromPostcode } from "@/lib/postcode-areas";

const DRY_RUN = process.argv.includes("--dry-run");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
// Default target per run is small (3) on purpose: it keeps the review queue
// trickling instead of dumping a wall of candidates on the reviewer at once.
// Note the cron is WEEKLY (was 6x/day until the Places bill made that
// untenable), so MAX_SCAN_PER_RUN is the real cost lever, not TARGET.
// Override with --limit=N for a manual catch-up run.
const TARGET = limitArg ? Number(limitArg.split("=")[1]) : 3;

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

for (const [k, v] of Object.entries({
  GOOGLE_PLACES_API_KEY,
  NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
})) {
  if (!v) {
    console.error(`Missing ${k} in env`);
    process.exit(1);
  }
}
if (!SUPABASE_SERVICE_ROLE_KEY && !DRY_RUN) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY (required for writes).");
  process.exit(1);
}

const supabase =
  SUPABASE_SERVICE_ROLE_KEY && SUPABASE_URL
    ? createSupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      })
    : null;

// ── Tunables ─────────────────────────────────────────────────────────────

const MIN_RATING = 4.4;
const MIN_REVIEWS = 400;
const CHAIN_LOCATIONS = 4; // >= this many London outlets of the BRAND = chain
const MAX_SCAN_PER_RUN = 60; // bound API usage: stop after examining this many
const MIN_REVIEWS_DAY = 150; // galleries/markets draw fewer reviews than food

const NEIGHBOURHOODS = [
  "Soho",
  "Shoreditch",
  "Hackney",
  "Dalston",
  "Peckham",
  "Bermondsey",
  "Clerkenwell",
  "Islington",
  "Borough",
  "Marylebone",
  "Fitzrovia",
  "Brixton",
  "Stoke Newington",
  "Spitalfields",
  "London Fields",
  "Camberwell",
  // West / North / South-west broadening (2026-06-04): the grid was
  // east/south-east heavy, so the catalogue clustered there. These open up
  // the rest of the map. The 4-hourly cron rotates through them over time.
  "Camden",
  "Kentish Town",
  "Notting Hill",
  "Chelsea",
  "Chiswick",
  "Shepherd's Bush",
  "Clapham",
  "Battersea",
  "Highbury",
  "Crouch End",
];

type Category = {
  keyword: string;
  type: VenueType;
  moods: Mood[];
  timeOfDay: "Day" | "Evening" | "Night";
  // Day-spots (Culture / Market / Outdoors): not reservable, often no website,
  // not franchise chains. Relaxes the food/drink-tuned gates below.
  dayType?: boolean;
};

const CATEGORIES: Category[] = [
  {
    keyword: "independent restaurant",
    type: "Restaurant",
    moods: ["dinner"],
    timeOfDay: "Evening",
  },
  {
    keyword: "natural wine bar",
    type: "Wine Bar",
    moods: ["drinks"],
    timeOfDay: "Evening",
  },
  {
    keyword: "cocktail bar",
    type: "Bar",
    moods: ["drinks"],
    timeOfDay: "Night",
  },
  {
    keyword: "speciality coffee shop",
    type: "Cafe",
    moods: [],
    timeOfDay: "Day",
  },
  { keyword: "gastropub", type: "Pub", moods: ["drinks"], timeOfDay: "Night" },
  // Day-spots: fill the Morning/Afternoon mood decks (Culture/Market/Outdoors,
  // which the catalog currently has zero of).
  {
    keyword: "independent art gallery",
    type: "Culture",
    moods: ["culture"],
    timeOfDay: "Day",
    dayType: true,
  },
  {
    keyword: "food market",
    type: "Market",
    moods: ["activity"],
    timeOfDay: "Day",
    dayType: true,
  },
  {
    keyword: "park",
    type: "Outdoors",
    moods: ["activity"],
    timeOfDay: "Day",
    dayType: true,
  },
];

const ALLOWED_TYPES = new Set([
  "restaurant",
  "bar",
  "cafe",
  "coffee_shop",
  "pub",
  "wine_bar",
  "fine_dining_restaurant",
  "bakery",
  "brunch_restaurant",
  // Day-spots (used leniently, see typesOk).
  "art_gallery",
  "museum",
  "tourist_attraction",
  "market",
  "park",
  "national_park",
  "garden",
]);
const REJECT_TYPES = new Set([
  "fast_food_restaurant",
  "meal_takeaway",
  "lodging",
  "supermarket",
  "grocery_store",
  "shopping_mall",
  "night_club",
  "liquor_store",
  // Non-venues that leaked in tagged "Restaurant"/"Cafe" — e.g. a nail salon
  // Google ALSO tags "cafe". Reject wins over allow (see typesOk), so a place
  // carrying any of these is dropped even if it also has a food/drink type, and
  // day-spots (which accept anything not rejected) are gated too. Unknown type
  // strings are inert — they simply never match — so this list is safe to widen.
  // Personal care:
  "beauty_salon",
  "hair_salon",
  "hair_care",
  "nail_salon",
  "barber_shop",
  "spa",
  "massage",
  "tanning_studio",
  "skin_care_clinic",
  // Medical / health:
  "dentist",
  "doctor",
  "hospital",
  "pharmacy",
  "drugstore",
  "physiotherapist",
  "chiropractor",
  "veterinary_care",
  "wellness_center",
  // Fitness:
  "gym",
  "fitness_center",
  "yoga_studio",
  // Retail / services / other non-venues:
  "convenience_store",
  "hardware_store",
  "furniture_store",
  "home_goods_store",
  "laundry",
  "gas_station",
  "car_repair",
  "car_dealer",
  "car_wash",
  "bank",
  "atm",
  "real_estate_agency",
  "insurance_agency",
  "lawyer",
  "accounting",
  "storage",
  "post_office",
]);

// ── Google Places ────────────────────────────────────────────────────────

const PLACES_BASE = "https://places.googleapis.com/v1/places";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Place = {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  rating?: number;
  userRatingCount?: number;
  websiteUri?: string;
  types?: string[];
  businessStatus?: string;
};

async function searchPlaces(query: string, fields: string): Promise<Place[]> {
  const res = await fetch(`${PLACES_BASE}:searchText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY!,
      "X-Goog-FieldMask": fields,
    },
    body: JSON.stringify({ textQuery: query, maxResultCount: 20 }),
  });
  if (!res.ok) throw new Error(`Places search ${res.status} for "${query}"`);
  const json = (await res.json()) as { places?: Place[] };
  return json.places ?? [];
}

// Only the fields the numeric gates and the queue row need. Photos, phone,
// opening hours, coordinates etc. are fetched later by ingest-from-pending
// (Place Details) once a human has approved the candidate.
const DISCOVERY_FIELDS = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.rating",
  "places.userRatingCount",
  "places.websiteUri",
  "places.types",
  "places.businessStatus",
].join(",");

// Normalise a place name to lowercase alphanumerics (single-spaced).
function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// The BRAND part of a venue name: strip any branch/location suffix that
// follows a separator ("Be At One - Farringdon" → "be at one", "Dishoom |
// Shoreditch" → "dishoom", "Forza Wine (Peckham)" → "forza wine"). Searching
// the brand (not the branch-specific name) is what makes the chain count
// honest: the old code searched the full "…- Farringdon London" string, which
// only returned that single outlet, so big chains read as 1-location indies.
function brandKey(name: string): string {
  const base = name.split(/\s[-–—|@:]\s|\s\(/)[0];
  return normName(base);
}

// Count London outlets that share a venue's brand → chain heuristic. Searches
// the brand and counts results whose name starts with that brand, so all of a
// chain's branches collapse together. Capped at the API's 20-result page, which
// is plenty above the CHAIN_LOCATIONS threshold.
async function londonLocationCount(name: string): Promise<number> {
  try {
    const brand = brandKey(name);
    // Can't determine the brand → can't prove it's an independent. Fail CLOSED:
    // treat as a chain so an unverifiable name is rejected, not admitted.
    if (!brand) return Infinity;
    const places = await searchPlaces(
      `${brand} London`,
      "places.id,places.displayName",
    );
    const matches = places.filter((p) =>
      normName(p.displayName?.text ?? "").startsWith(brand),
    );
    return matches.length;
  } catch {
    // On any Places error (429/503/network), we CANNOT confirm this is an
    // independent. Returning a low count would let a chain slip into the review
    // queue looking like an indie on a transient blip. Fail CLOSED: return
    // Infinity so the venue is skipped this run and retried on the next cron.
    return Infinity;
  }
}

// ── Draft copy (templated, claim-free) ───────────────────────────────────

type Editorial = {
  vibe: string;
  long_description: string;
  critical_flags: { label: string; body: string }[];
};

// Draft copy WITHOUT any model call, templated from the data we already have
// (type and postcode-derived area). It is stored on the pending candidate as
// vibe_draft / long_description_draft, purely as raw material for the human
// reviewer; ingest-from-pending builds the published row from its own Places
// lookup and the reviewer can rewrite the copy after ingestion.
//
// Honest, grounded copy only. We have NOT read this venue or verified any
// editorial coverage, so the draft claims nothing it can't back: just the
// type and the area, plus a practical heads-up. (The old template asserted
// "cross-checked across N trusted sources" for every robot-found venue, which
// was fabricated. See the provenance audit.)
// A natural-English noun for each venue type ("Outdoors" → "green space", not
// "an outdoors"), with its article. Keeps the templated prose readable.
const TYPE_NOUN: Record<VenueType, { article: string; noun: string }> = {
  Restaurant: { article: "a", noun: "restaurant" },
  Cafe: { article: "a", noun: "café" },
  Bar: { article: "a", noun: "bar" },
  "Wine Bar": { article: "a", noun: "wine bar" },
  Pub: { article: "a", noun: "pub" },
  "Listening Bar": { article: "a", noun: "listening bar" },
  "Live Music": { article: "a", noun: "live-music spot" },
  Culture: { article: "a", noun: "cultural spot" },
  Market: { article: "a", noun: "market" },
  Outdoors: { article: "an", noun: "outdoor spot" },
};

function templateEditorial(
  name: string,
  type: VenueType,
  area: string,
  isDay: boolean,
): Editorial {
  const { noun } = TYPE_NOUN[type] ?? { noun: "spot" };

  const vibe = `An independent ${noun} in ${area}.`;

  const long_description =
    `An independent ${noun} in ${area}. ` +
    `Opening hours can vary, so it's worth a quick check before you head over.`;

  const critical_flags = isDay
    ? [
        {
          label: "Check times before you go",
          body: `Opening days and hours for ${name} vary by season. Confirm on the day so you're not caught out.`,
        },
      ]
    : [
        {
          label: "Independent: plan ahead",
          body: `Small, owner-run ${noun}. Booking, hours and walk-in policy vary, so check ahead, especially at weekends.`,
        },
      ];

  return { vibe, long_description, critical_flags };
}

// ── Helpers ──────────────────────────────────────────────────────────────

function typesOk(types: string[] | undefined, venueType?: VenueType): boolean {
  if (!types) return false;
  const isDay =
    venueType === "Culture" ||
    venueType === "Market" ||
    venueType === "Outdoors";
  // Markets frequently tag as shopping_mall, don't reject that when hunting
  // markets specifically.
  const reject =
    venueType === "Market"
      ? new Set([...REJECT_TYPES].filter((t) => t !== "shopping_mall"))
      : REJECT_TYPES;
  if (types.some((t) => reject.has(t))) return false;
  // Day-spots: Places types for galleries/markets/parks are inconsistent and
  // the keyword search already targets the right kind, so accept anything not
  // explicitly rejected. Food/drink still must match an allowed type.
  if (isDay) return true;
  return types.some((t) => ALLOWED_TYPES.has(t));
}

// Paginated fetch of one column's values from a table. PostgREST caps a plain
// select at 1000 rows and both venues and pending_candidates can exceed that,
// so an unpaginated fetch would silently miss rows and break the dedupe.
async function fetchColumnValues(
  table: string,
  column: string,
): Promise<Set<string>> {
  const out = new Set<string>();
  if (!supabase) return out;
  const PAGE = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select(column)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`fetch ${table}.${column}: ${error.message}`);
    // Cast through unknown: supabase-js can't type a dynamic column select.
    for (const r of (data ?? []) as unknown as Record<string, unknown>[]) {
      const v = r[column];
      if (typeof v === "string" && v) out.add(v);
    }
    // Loop until an EMPTY page, advancing by rows actually received: if the
    // server's max-rows cap is lower than PAGE, a short page is NOT the end,
    // and fixed PAGE-size jumps would skip the rows the cap withheld.
    if (!data || data.length === 0) break;
    from += data.length;
  }
  return out;
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log(
    `Fun London — venue discovery (all-Google, human-gated) · target ${TARGET} · ${DRY_RUN ? "DRY RUN" : "QUEUE FOR APPROVAL"}\n`,
  );

  // Dedupe sets: anything already in venues (including hidden rows, a venue
  // the reviewer removed from the catalogue must not be re-suggested) and
  // anything already in the pending queue in ANY status (a rejected candidate
  // must not come back either).
  let existingPlaceIds = new Set<string>();
  let queuedPlaceIds = new Set<string>();
  if (supabase) {
    existingPlaceIds = await fetchColumnValues("venues", "google_place_id");
    queuedPlaceIds = await fetchColumnValues(
      "pending_candidates",
      "google_place_id",
    );
    console.log(
      `Dedupe sets: ${existingPlaceIds.size} venue place ids, ${queuedPlaceIds.size} pending-candidate place ids\n`,
    );
  }

  // Build the search grid and rotate the starting point each run.
  const grid: { area: string; cat: Category }[] = [];
  for (const area of NEIGHBOURHOODS)
    for (const cat of CATEGORIES) grid.push({ area, cat });
  const start = Math.floor(Date.now() / (4 * 60 * 60 * 1000)) % grid.length;

  const queued: string[] = [];
  // Green-but-empty guard input: systemic insert failure (e.g. schema drift or
  // a dead service key) would otherwise produce a silent empty GREEN run.
  // Count the failures so we can fail loud.
  let insertFailures = 0;
  let skippedAlreadyQueued = 0;
  // Same guard for the OTHER systemic failure: a dead GOOGLE_PLACES_API_KEY
  // makes every grid search throw, which used to read as a quiet green run
  // with nothing examined. Count successes and failures so we can tell "every
  // search errored" apart from "the grid slice was genuinely empty".
  let searchFailures = 0;
  let searchSuccesses = 0;
  const seen = new Set<string>();
  let scanned = 0;

  for (let g = 0; g < grid.length && queued.length < TARGET; g++) {
    const { area, cat } = grid[(start + g) % grid.length];
    let places: Place[] = [];
    try {
      places = await searchPlaces(
        `${cat.keyword} in ${area}, London`,
        DISCOVERY_FIELDS,
      );
    } catch (e) {
      searchFailures++;
      console.error(`  ✗ search ${cat.type}·${area}: ${(e as Error).message}`);
      continue;
    }
    searchSuccesses++;
    await sleep(200);

    for (const p of places) {
      if (queued.length >= TARGET || scanned >= MAX_SCAN_PER_RUN) break;
      const name = p.displayName?.text;
      if (
        !name ||
        !p.id ||
        seen.has(p.id) ||
        existingPlaceIds.has(p.id) ||
        queuedPlaceIds.has(p.id)
      )
        continue;

      // Cheap pre-filter before any expensive calls. Day-spots (galleries,
      // markets, parks) get a lower review bar and may have no website.
      const isDay = cat.dayType === true;
      const minReviews = isDay ? MIN_REVIEWS_DAY : MIN_REVIEWS;
      if (
        p.businessStatus !== "OPERATIONAL" ||
        (p.rating ?? 0) < MIN_RATING ||
        (p.userRatingCount ?? 0) < minReviews ||
        (!isDay && !p.websiteUri) ||
        !typesOk(p.types, cat.type)
      ) {
        continue;
      }
      seen.add(p.id);
      scanned++;

      // Chain check (location count), skipped for day-spots: parks/markets/
      // galleries aren't franchise chains, and name-word counting false-flags
      // generically-named ones (e.g. "Victoria Park").
      let chainLocations: number | null = null;
      if (!isDay) {
        const locations = await londonLocationCount(name);
        if (locations >= CHAIN_LOCATIONS) {
          const reason = Number.isFinite(locations)
            ? `chain (${locations} locations)`
            : `unverifiable (Places error/blank brand), skipped, will retry next run`;
          console.log(`  ⊘ ${reason}: ${name}`);
          continue;
        }
        chainLocations = locations;
        await sleep(150);
      }

      // Draft copy for the reviewer (templated, claim-free, no model call).
      const editorial = templateEditorial(name, cat.type, area, isDay);

      // Neighbourhood from the venue's real Google postcode (validated),
      // not the search area it was found under, falling back to that area
      // when there's no usable postcode. Mirrors the ingest path. See
      // lib/postcode-areas.ts.
      const neighbourhood = areaFromPostcode(p.formattedAddress) ?? area;

      // The pending_candidates row. Field shape follows the two consumers:
      //   • scripts/ingest-from-pending.ts reads name, neighbourhood,
      //     type_guess, vibe_tags_draft, the drafts, and sources[] (source,
      //     time_of_day, moods), and refetches everything else from Places
      //     at ingest time.
      //   • /admin/candidates renders vibe_draft, long_description_draft,
      //     sources_count, chain_risk_score and sources[].{publication,url,
      //     title,date}.
      // The single source entry carries the FACTUAL Places data (no press
      // claims): the deterministic Google Maps link plus the numbers the
      // gates saw, so the reviewer can judge from evidence. time_of_day and
      // moods carry the discovery category's intent so ingest publishes a
      // gallery as a Day/culture spot, not the old Evening/dinner default.
      const runDate = new Date().toISOString().slice(0, 10);
      const row = {
        name,
        neighbourhood,
        type_guess: cat.type,
        google_place_id: p.id,
        sources: [
          {
            source: "discover-venues",
            publication: "Google Places",
            url: `https://www.google.com/maps/place/?q=place_id:${p.id}`,
            title: `${p.rating ?? "?"}★ · ${p.userRatingCount ?? 0} reviews · ${p.formattedAddress ?? area}`,
            date: runDate,
            website: p.websiteUri ?? null,
            google_types: p.types ?? [],
            search_keyword: cat.keyword,
            search_area: area,
            time_of_day: cat.timeOfDay,
            moods: cat.moods,
          },
        ],
        sources_count: 1,
        vibe_draft: editorial.vibe,
        long_description_draft: editorial.long_description,
        vibe_tags_draft: ["Independent", ...cat.moods],
        real_talk_drafts: editorial.critical_flags,
        filter_results: {
          gates: "passed",
          rating: p.rating ?? null,
          min_rating: MIN_RATING,
          reviews: p.userRatingCount ?? 0,
          min_reviews: minReviews,
          chain_locations: chainLocations,
          business_status: p.businessStatus ?? null,
          website: p.websiteUri ?? null,
        },
        // Informational only (we reject hard chains above): how close the
        // brand count came to the threshold. Day-spots skip the check.
        chain_risk_score:
          chainLocations == null
            ? null
            : Math.min(chainLocations / CHAIN_LOCATIONS, 1),
        status: "pending",
      };

      if (DRY_RUN) {
        console.log(
          `  ✅ [dry] would queue ${name} (${neighbourhood}) · ${p.rating}★ · ${p.userRatingCount} reviews`,
        );
        queued.push(name);
        continue;
      }
      if (!supabase) continue;
      // Plain insert, not upsert: pending_candidates.google_place_id is UNIQUE
      // in the live DB (see ingest-from-pending.ts), but schema.sql does not
      // declare the constraint, so an onConflict target could error where the
      // constraint is missing. A duplicate-key race (23505) is a graceful
      // skip: someone queued or ingested it between our dedupe fetch and now.
      const { error } = await supabase.from("pending_candidates").insert(row);
      if (error) {
        if (error.code === "23505") {
          console.log(`  ↩ already queued/ingested elsewhere: ${name}`);
          skippedAlreadyQueued++;
        } else {
          insertFailures++;
          console.error(`  ✗ queue insert ${name}: ${error.message}`);
        }
      } else {
        console.log(
          `  ✅ queued for approval: ${name} (${neighbourhood}) · ${p.rating}★ · ${p.userRatingCount} reviews`,
        );
        queued.push(name);
        queuedPlaceIds.add(p.id);
      }
    }
  }

  console.log("\n─────────── SUMMARY ───────────");
  console.log(`Examined:  ${scanned}`);
  console.log(
    `${DRY_RUN ? "Would queue" : "Queued"} ${queued.length}/${TARGET} candidate(s) for approval`,
  );
  queued.forEach((s) => console.log(`  • ${s}`));
  if (skippedAlreadyQueued > 0)
    console.log(`Skipped (already queued): ${skippedAlreadyQueued}`);
  console.log(
    `\n${DRY_RUN ? "Dry run complete." : "Discovery complete. Review at /admin/candidates."}`,
  );

  // Green-but-empty guard: scanned candidates, queued nothing, and the insert
  // failed repeatedly -> almost certainly systemic (schema drift, dead service
  // key, DB outage), not a genuinely empty grid slice. Exit nonzero so the
  // workflow's failure alert fires instead of reporting a useless run as
  // success.
  if (!DRY_RUN && queued.length === 0 && scanned > 0 && insertFailures >= 3) {
    console.error(
      `GREEN-BUT-EMPTY GUARD: scanned ${scanned}, queued 0, ` +
        `${insertFailures} insert failures. Likely systemic (DB/schema). ` +
        `Exiting 1 so the alert fires.`,
    );
    process.exit(1);
  }

  // Total Places failure guard: every grid search errored and none succeeded,
  // which is a dead/revoked GOOGLE_PLACES_API_KEY or a Places outage, never a
  // genuinely empty slice. Applies to dry runs too, a broken key should never
  // report green anywhere.
  if (searchFailures > 0 && searchSuccesses === 0) {
    console.error(
      `TOTAL SEARCH FAILURE GUARD: all ${searchFailures} Places searches ` +
        `errored (0 succeeded). Likely a dead GOOGLE_PLACES_API_KEY or a ` +
        `Places outage. Exiting 1 so the alert fires.`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
