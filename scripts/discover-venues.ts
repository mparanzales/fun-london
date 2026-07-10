// Fun London — Tier 2: autonomous venue discovery (strict, all-Google, free).
//
// Runs unattended (GitHub Actions, every 4h). For each run it loops until it
// has collected TARGET fully-compliant new venues — or it exhausts the search
// grid. Pipeline per candidate:
//
//   1. DISCOVER — Google Places search across a rotating London grid.
//   2. PRE-FILTER (cheap) — operational · rating >= 4.4 · >= 400 reviews ·
//      has website · food/drink type · not already in catalog.
//   3. CHAIN CHECK — Google Places: count locations of the name in London;
//      >= CHAIN_LOCATIONS distinct => chain => reject (the maintainer's rule: judge by
//      number of locations, NOT a name denylist).
//   4. VALIDATE (Gemini + built-in Google Search) — which trusted publications
//      actually cover this venue? Require >= 2 distinct ones.
//   5. EDITORIAL (Gemini) — write the vibe, the review (good AND bad, in the
//      cool/brat/gen-z voice), and the "Real Talk" critical flags.
//   6. AUTO-PUBLISH to public.venues with the real editorial_sources +
//      critical_flags (per the maintainer: auto-publish, strict gate is the guard).
//
// All-Google + free: Google Places (discovery + chain check) and Gemini 2.5
// Flash (validation via grounding + editorial). One Gemini key does both.
//
// Run:
//   pnpm discover-venues:dry            # no DB writes
//   pnpm discover-venues                # auto-publish
//   pnpm discover-venues -- --limit=2   # cap target (for testing)

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import {
  resolveVenuePhotos,
  mirrorMapToStorage,
  FALLBACK_IMG_URL,
} from "./photo-storage";
import type { BookingLink, Mood, VenueType } from "@/lib/types";
import {
  normalizeOpeningHours,
  type GoogleOpeningHours,
} from "@/lib/opening-hours";
import { areaFromPostcode } from "@/lib/postcode-areas";
import {
  TAG_VERSION,
  fallbackCanonicalTags,
  rawTagsToCanonical,
} from "@/lib/tag-vocabulary";

const DRY_RUN = process.argv.includes("--dry-run");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
// Default target per run is small (3) on purpose: the cron fires 6x/day, so a
// modest per-run target lets venues TRICKLE through the day instead of one run
// draining the Gemini free DAILY quota and leaving the later 5 runs to 429.
// Override with --limit=N for a manual catch-up run.
const TARGET = limitArg ? Number(limitArg.split("=")[1]) : 3;

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

for (const [k, v] of Object.entries({
  GOOGLE_PLACES_API_KEY,
  GEMINI_API_KEY,
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
const REQUIRED_SOURCES = 2;
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
  // West / North / South-west broadening (2026-06-04) — the grid was
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
  // Day-spots — fill the Morning/Afternoon mood decks (Culture/Market/Outdoors,
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

// The trusted publications that count toward the 2-source gate.
const TRUSTED_PUBLICATIONS = [
  "Time Out",
  "The Infatuation",
  "Eater London",
  "Square Meal",
  "Hot Dinners",
  "Harden's",
  "Michelin",
  "The Good Food Guide",
  "Condé Nast Traveller",
  "Evening Standard",
  "The Guardian",
  "Foodism",
  "World's 50 Best",
  // Strong on day-spots (galleries, markets, parks).
  "Londonist",
  "Secret London",
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
  // Day-spots (used leniently — see typesOk).
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
]);

// ── Google Places ────────────────────────────────────────────────────────

const PLACES_BASE = "https://places.googleapis.com/v1/places";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Place = {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  rating?: number;
  userRatingCount?: number;
  photos?: { name: string }[];
  websiteUri?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  priceLevel?: string;
  types?: string[];
  businessStatus?: string;
  regularOpeningHours?: GoogleOpeningHours;
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

const DISCOVERY_FIELDS = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.rating",
  "places.userRatingCount",
  "places.photos",
  "places.websiteUri",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.priceLevel",
  "places.types",
  "places.businessStatus",
  "places.regularOpeningHours",
].join(",");

// Normalise a place name to lowercase alphanumerics (single-spaced).
function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// The BRAND part of a venue name — strip any branch/location suffix that
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
    // independent. Returning a low count here would let chains auto-publish
    // into a "no chains" catalogue on a transient blip. Fail CLOSED: return
    // Infinity so the venue is skipped this run and retried on the next cron,
    // mirroring the fail-closed `continue` used for source validation below.
    return Infinity;
  }
}

// ── Gemini (validation via grounding + editorial) ────────────────────────

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

// Free-tier pacing. Gemini's free tier caps requests-per-minute (and per day),
// and the old code fired calls back-to-back — so most runs got HTTP 429'd and
// published ~nothing. These two knobs keep us under the limit instead:
//   • GEMINI_MIN_GAP_MS — minimum spacing between any two Gemini calls.
//   • GEMINI_MAX_RETRIES — on a 429/503, wait (honouring Retry-After, else
//     exponential backoff) and try again rather than abandoning the venue.
const GEMINI_MIN_GAP_MS = 4500; // ~13 calls/min ceiling
const GEMINI_MAX_RETRIES = 4;
let lastGeminiAt = 0;

// Single choke-point for every Gemini call: paces, then retries on rate-limit /
// transient errors. Returns the final Response (callers keep their own res.ok
// handling); only the network layer can throw, exactly as a bare fetch would.
async function geminiFetch(body: unknown): Promise<Response> {
  let attempt = 0;
  for (;;) {
    const since = Date.now() - lastGeminiAt;
    if (since < GEMINI_MIN_GAP_MS) await sleep(GEMINI_MIN_GAP_MS - since);
    lastGeminiAt = Date.now();

    const res = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    // 429 = rate-limited, 503 = transient overload. Back off and retry.
    if (
      (res.status === 429 || res.status === 503) &&
      attempt < GEMINI_MAX_RETRIES
    ) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const backoff =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : GEMINI_MIN_GAP_MS * Math.pow(2, attempt); // 4.5s, 9s, 18s, 36s
      console.log(
        `    ⏳ Gemini ${res.status} — backing off ${Math.round(backoff / 1000)}s (retry ${attempt + 1}/${GEMINI_MAX_RETRIES})`,
      );
      await sleep(backoff);
      attempt++;
      continue;
    }
    return res;
  }
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced ? fenced[1] : text).trim();
  const start = raw.search(/[[{]/);
  if (start === -1) return null;
  try {
    return JSON.parse(raw.slice(start));
  } catch {
    return null;
  }
}

type Source = { publication: string; url: string };

// Ask Gemini (with Google Search) which trusted publications cover the venue.
async function validateSources(name: string, area: string): Promise<Source[]> {
  const prompt =
    `Using Google Search, determine which of these publications have a genuine ` +
    `review or feature of the London venue "${name}" in ${area}: ` +
    `${TRUSTED_PUBLICATIONS.join(", ")}. ` +
    `Only include a publication if you actually find its page for THIS venue. ` +
    `Reply ONLY with a JSON array of {"publication","url"} — no prose.`;
  const res = await geminiFetch({
    contents: [{ parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
  });
  if (!res.ok) throw new Error(`Gemini validate ${res.status}`);
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ??
    "";
  const parsed = extractJson(text);
  if (!Array.isArray(parsed)) return [];
  const known = new Set(TRUSTED_PUBLICATIONS.map((p) => p.toLowerCase()));
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const s of parsed as Source[]) {
    const pub = (s?.publication ?? "").trim();
    const url = (s?.url ?? "").trim();
    if (!pub || !url.startsWith("http")) continue;
    if (!known.has(pub.toLowerCase()) || seen.has(pub.toLowerCase())) continue;
    seen.add(pub.toLowerCase());
    out.push({ publication: pub, url });
  }
  return out;
}

type Editorial = {
  vibe: string;
  long_description: string;
  critical_flags: { label: string; body: string }[];
};

// Editorial WITHOUT a Gemini call — templated from the data we already have
// (type, area, the trusted sources that validated the venue, day-vs-night).
//
// Why: the robot used to make 3 Gemini calls per venue (validate sources,
// write editorial, find booking link). On the free tier that drained the
// daily quota after a couple of venues and the rest of the day 429'd. The
// booking-link call was also dead (the row uses detectBookingLinks() from the
// website directly). So we keep ONLY the source-validation Gemini call — the
// integrity gate that can't be faked — and template the prose. Net: 3 → 1
// Gemini calls per venue, ~3x more venues under the same free quota.
//
// Trade-off: these blurbs are competent and honest but not the full "brat"
// voice. When on paid Gemini (or for a hand-polish pass) the richer editorial
// can be layered back on; this just guarantees something publishable for free.
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

  // Honest, grounded copy only. We have NOT read this venue or verified any
  // editorial coverage, so the description claims nothing it can't back: just
  // the type and the (postcode-derived) area, plus a practical heads-up. The
  // old template asserted "cross-checked across N trusted sources" and "the
  // critics keep coming back" for every robot-found venue, which was fabricated
  // (see the provenance audit). No source names, no critic claims, no dashes.
  const vibe = `An independent ${noun} in ${area}.`;

  const long_description =
    `An independent ${noun} in ${area}. ` +
    `Opening hours can vary, so it's worth a quick check before you head over.`;

  const critical_flags = isDay
    ? [
        {
          label: "Check times before you go",
          body: `Opening days and hours for ${name} vary by season — confirm on the day so you're not caught out.`,
        },
      ]
    : [
        {
          label: "Independent — plan ahead",
          body: `Small, owner-run ${noun} — booking, hours and walk-in policy vary, so check ahead, especially at weekends.`,
        },
      ];

  return { vibe, long_description, critical_flags };
}

// ── Helpers ──────────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function priceFromLevel(level: string | undefined): "£" | "££" | "£££" {
  switch (level) {
    case "PRICE_LEVEL_INEXPENSIVE":
      return "£";
    case "PRICE_LEVEL_EXPENSIVE":
    case "PRICE_LEVEL_VERY_EXPENSIVE":
      return "£££";
    default:
      return "££";
  }
}

function typesOk(types: string[] | undefined, venueType?: VenueType): boolean {
  if (!types) return false;
  const isDay =
    venueType === "Culture" ||
    venueType === "Market" ||
    venueType === "Outdoors";
  // Markets frequently tag as shopping_mall — don't reject that when hunting
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

function detectBookingLinks(websiteUri: string | undefined): BookingLink[] {
  if (!websiteUri) return [];
  const patterns: { platform: BookingLink["platform"]; re: RegExp }[] = [
    { platform: "opentable", re: /opentable\.(com|co\.uk)/i },
    { platform: "resy", re: /resy\.com/i },
    { platform: "sevenrooms", re: /sevenrooms\.com/i },
    { platform: "thefork", re: /thefork\.(com|co\.uk)/i },
  ];
  for (const { platform, re } of patterns) {
    if (re.test(websiteUri))
      return [{ platform, url: websiteUri, priority: 1 }];
  }
  return [{ platform: "website", url: websiteUri, priority: 99 }];
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log(
    `Fun London — venue discovery (strict, all-Google) · target ${TARGET} · ${DRY_RUN ? "DRY RUN" : "AUTO-PUBLISH"}\n`,
  );

  const existingPlaceIds = new Set<string>();
  const usedSlugs = new Set<string>();
  if (supabase) {
    const { data } = await supabase
      .from("venues")
      .select("slug,google_place_id");
    for (const r of data ?? []) {
      if (r.google_place_id) existingPlaceIds.add(r.google_place_id as string);
      if (r.slug) usedSlugs.add(r.slug as string);
    }
  }

  // Build the search grid and rotate the starting point each run.
  const grid: { area: string; cat: Category }[] = [];
  for (const area of NEIGHBOURHOODS)
    for (const cat of CATEGORIES) grid.push({ area, cat });
  const start = Math.floor(Date.now() / (4 * 60 * 60 * 1000)) % grid.length;

  const published: string[] = [];
  // Green-but-empty guard input: systemic source-validation failure (e.g. the
  // shared Gemini free-tier quota is drained -> every validate throws) used to
  // produce a silent empty GREEN run. Count the throws so we can fail loud.
  let validateFailures = 0;
  const seen = new Set<string>();
  let scanned = 0;

  for (let g = 0; g < grid.length && published.length < TARGET; g++) {
    const { area, cat } = grid[(start + g) % grid.length];
    let places: Place[] = [];
    try {
      places = await searchPlaces(
        `${cat.keyword} in ${area}, London`,
        DISCOVERY_FIELDS,
      );
    } catch (e) {
      console.error(`  ✗ search ${cat.type}·${area}: ${(e as Error).message}`);
      continue;
    }
    await sleep(200);

    for (const p of places) {
      if (published.length >= TARGET || scanned >= MAX_SCAN_PER_RUN) break;
      const name = p.displayName?.text;
      if (!name || !p.id || seen.has(p.id) || existingPlaceIds.has(p.id))
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

      // Chain check (location count) — skip for day-spots: parks/markets/
      // galleries aren't franchise chains, and name-word counting false-flags
      // generically-named ones (e.g. "Victoria Park").
      if (!isDay) {
        const locations = await londonLocationCount(name);
        if (locations >= CHAIN_LOCATIONS) {
          const reason = Number.isFinite(locations)
            ? `chain (${locations} locations)`
            : `unverifiable (Places error/blank brand) — skipped, will retry next run`;
          console.log(`  ⊘ ${reason}: ${name}`);
          continue;
        }
        await sleep(150);
      }

      // Source validation via Gemini + Google Search. Outdoors (parks/lidos)
      // rarely get formal reviews, so 1 trusted listing is enough there;
      // food, drink, culture and markets still need 2.
      let sources: Source[] = [];
      try {
        sources = await validateSources(name, area);
      } catch (e) {
        validateFailures += 1;
        console.error(`  ✗ validate ${name}: ${(e as Error).message}`);
        continue;
      }
      const requiredSources = cat.type === "Outdoors" ? 1 : REQUIRED_SOURCES;
      if (sources.length < requiredSources) {
        console.log(
          `  ✗ ${name}: only ${sources.length}/${requiredSources} source(s)`,
        );
        continue;
      }

      // Editorial — templated from the venue + its validated sources (no
      // Gemini call). See templateEditorial: keeps the robot to ONE Gemini
      // call per venue (source validation only) so the free daily quota
      // stretches ~3x further.
      const editorial = templateEditorial(name, cat.type, area, isDay);

      // Canonical tags for the recommender + search, mirroring the ingest path
      // (scripts/ingest-from-pending.ts canonicalForCandidate): map the raw
      // tags, with a type/mood floor so a venue is never invisible. Without
      // this, robot-found venues land at canonical_tags_version 0 and are
      // silently missing from the shared vocabulary.
      const rawTags = ["Independent", ...cat.moods];
      const canonicalFromTags = rawTagsToCanonical(rawTags);
      const canonicalTags =
        canonicalFromTags.length > 0
          ? canonicalFromTags
          : fallbackCanonicalTags(cat.type, cat.moods);

      // Unique slug.
      let slug = slugify(name);
      let n = 2;
      while (usedSlugs.has(slug)) slug = `${slugify(name)}-${n++}`;
      usedSlugs.add(slug);

      // Resolve the photo to a keyless URL (mirrored to Storage, or the
      // keyless stock fallback). Never a keyed Google URL — see photo-storage.
      // On dry runs we skip the fetch/upload entirely and use the fallback.
      const photoUrls =
        supabase && !DRY_RUN
          ? await resolveVenuePhotos(p.photos, slug, supabase)
          : [];
      const imgUrl = photoUrls[0] ?? FALLBACK_IMG_URL;
      const mapLat = p.location?.latitude ?? null;
      const mapLng = p.location?.longitude ?? null;
      const mapUrl =
        supabase && !DRY_RUN && mapLat != null && mapLng != null
          ? await mirrorMapToStorage(slug, mapLat, mapLng, supabase)
          : null;

      const row = {
        slug,
        name,
        type: cat.type,
        vibe: editorial.vibe,
        long_description: editorial.long_description,
        // Neighbourhood from the venue's real Google postcode (validated),
        // not the search area it was found under, falling back to that area
        // when there's no usable postcode. Mirrors the ingest path. See
        // lib/postcode-areas.ts.
        neighbourhood: areaFromPostcode(p.formattedAddress) ?? area,
        address: p.formattedAddress ?? `${area}, London`,
        lat: p.location?.latitude ?? null,
        lng: p.location?.longitude ?? null,
        price: isDay && !p.priceLevel ? "Free" : priceFromLevel(p.priceLevel),
        time_of_day: cat.timeOfDay,
        rating: p.rating ?? MIN_RATING,
        review_count: p.userRatingCount ?? 0,
        walking_mins: 12,
        tables_free: 4,
        next_slot_label: "Open today",
        img_url: imgUrl,
        photo_urls: photoUrls,
        map_url: mapUrl,
        // Robot-found venues are the discovered tier (curated seed ranks first).
        curation_tier: "discovered",
        mood_tags: cat.moods,
        vibe_tags: ["Independent"],
        canonical_tags: canonicalTags,
        canonical_tags_version: TAG_VERSION,
        google_place_id: p.id,
        booking_links: detectBookingLinks(p.websiteUri),
        website_url: p.websiteUri ?? null,
        phone: p.nationalPhoneNumber ?? p.internationalPhoneNumber ?? null,
        instagram_handle: null,
        // No editorial_sources written. The source validation below is still
        // used as a publish-quality gate (a venue must clear it to be listed),
        // but we do NOT persist the source list: the provenance audit showed
        // these robot-collected URLs are unreliable (dead/recycled/wrong-
        // business), and the venue page only surfaces sources flagged
        // verified anyway. Mirrors the ingest path, which writes [].
        editorial_sources: [],
        creator_coverage: null,
        critical_flags: editorial.critical_flags,
        opening_hours: normalizeOpeningHours(p.regularOpeningHours),
      };

      if (DRY_RUN) {
        console.log(
          `  ✅ [dry] ${name} (${area}) — ${sources.length} sources: ${sources.map((s) => s.publication).join(", ")}`,
        );
        console.log(`        vibe: ${editorial.vibe}`);
        published.push(slug);
        continue;
      }
      if (!supabase) continue;
      const { error } = await supabase
        .from("venues")
        .upsert(row, { onConflict: "google_place_id" });
      if (error) {
        console.error(`  ✗ upsert ${name}: ${error.message}`);
      } else {
        console.log(
          `  ✅ published ${name} → /${slug} (${sources.map((s) => s.publication).join(", ")})`,
        );
        published.push(slug);
      }
    }
  }

  console.log("\n─────────── SUMMARY ───────────");
  console.log(`Examined:  ${scanned}`);
  console.log(
    `${DRY_RUN ? "Would publish" : "Published"}: ${published.length}/${TARGET}`,
  );
  published.forEach((s) => console.log(`  • ${s}`));
  console.log(`\n${DRY_RUN ? "Dry run complete." : "Discovery complete."}`);

  // Green-but-empty guard: scanned candidates, published nothing, and source
  // validation failed repeatedly -> almost certainly systemic (Gemini quota or
  // outage), not a genuinely empty grid slice. Exit nonzero so the workflow's
  // failure alert fires instead of reporting a useless run as success.
  if (
    !DRY_RUN &&
    published.length === 0 &&
    scanned > 0 &&
    validateFailures >= 5
  ) {
    console.error(
      `GREEN-BUT-EMPTY GUARD: scanned ${scanned}, published 0, ` +
        `${validateFailures} validation failures. Likely systemic ` +
        `(Gemini quota/outage). Exiting 1 so the alert fires.`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
