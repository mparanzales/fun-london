// Fun London — Tier 2: automated venue discovery (auto-publish).
//
// The events pipeline (Tier 3) keeps the Events tab fresh from Ticketmaster.
// This is the equivalent for PLACES: every run it scans Google Places for
// established, independent, bookable venues across London neighbourhoods,
// applies strict quality filters, de-dupes against the existing catalog,
// and — per Maria's call — AUTO-PUBLISHES the passing ones straight into
// public.venues (no human approval gate). The strict filters are the
// quality guard in place of a human reviewer.
//
// OpenTable note: there is no open OpenTable API to import a restaurant
// list from. Google Places is the legal, reliable source; for each place
// we keep the venue's booking website, and the Reserve button deep-links
// there (OpenTable/Resy when that's what the venue uses).
//
// Auto-discovered rows are marked via editorial_sources = [{publication:
// "Google Places", …}] so they're distinguishable from hand-curated ones
// and the daily maintenance cron (Tier 1) keeps them fresh thereafter.
//
// Run:
//   pnpm discover-venues:dry    # log what WOULD publish, no DB writes
//   pnpm discover-venues        # writes (auto-publish)

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { BookingLink, Mood, VenueType } from "@/lib/types";

const DRY_RUN = process.argv.includes("--dry-run");

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!GOOGLE_PLACES_API_KEY) {
  console.error("Missing GOOGLE_PLACES_API_KEY in env");
  process.exit(1);
}
if (!SUPABASE_URL) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL in env");
  process.exit(1);
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
const MIN_REVIEWS = 400; // established, not a brand-new unknown
const MAX_NEW_PER_RUN = 6; // cap growth + API cost per run
const COMBOS_PER_RUN = 8; // rotating slice of the search grid per run

// Independent-rich London neighbourhoods.
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
];

type Category = {
  keyword: string;
  type: VenueType;
  moods: Mood[];
  timeOfDay: "Day" | "Evening" | "Night";
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
  {
    keyword: "traditional pub",
    type: "Pub",
    moods: ["drinks"],
    timeOfDay: "Night",
  },
];

// Obvious chains we never want auto-published (substring, case-insensitive).
const CHAIN_DENYLIST = [
  "dishoom",
  "franco manca",
  "honest burger",
  "flat iron",
  "pizza pilgrims",
  "brewdog",
  "nando",
  "wagamama",
  "pret",
  "gail",
  "côte",
  "cote ",
  "bill's",
  "wahaca",
  "byron",
  "five guys",
  "pizza express",
  "zizzi",
  "ask italian",
  "leon",
  "itsu",
  "wasabi",
  "paul",
  "starbucks",
  "costa",
  "caffe nero",
  "shake shack",
  "mcdonald",
  "kfc",
  "burger king",
  "greggs",
  "patty and bun",
  "the breakfast club",
  "côte brasserie",
  "rosa's thai",
  "franco",
  "homeslice",
  "the ivy",
  "hawksmoor",
  "patron",
  "tortilla",
  "chipotle",
  "pho ",
];

// Google Place types we accept / reject.
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
  reservable?: boolean;
  businessStatus?: string;
};

const SEARCH_FIELD_MASK = [
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
  "places.reservable",
  "places.businessStatus",
].join(",");

async function searchPlaces(query: string): Promise<Place[]> {
  const res = await fetch(`${PLACES_BASE}:searchText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY!,
      "X-Goog-FieldMask": SEARCH_FIELD_MASK,
    },
    body: JSON.stringify({ textQuery: query, maxResultCount: 20 }),
  });
  if (!res.ok) {
    throw new Error(`Places search failed for "${query}": ${res.status}`);
  }
  const json = (await res.json()) as { places?: Place[] };
  return json.places ?? [];
}

function photoUrl(photoName: string, maxWidth = 1600): string {
  return `https://places.googleapis.com/v1/${photoName}/media?key=${GOOGLE_PLACES_API_KEY}&maxWidthPx=${maxWidth}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

function isChain(name: string): boolean {
  const n = name.toLowerCase();
  return CHAIN_DENYLIST.some((c) => n.includes(c));
}

function typesOk(types: string[] | undefined): boolean {
  if (!types) return false;
  if (types.some((t) => REJECT_TYPES.has(t))) return false;
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

// ── Row builder (with auto editorial provenance) ─────────────────────────

function buildRow(place: Place, cat: Category, area: string, slug: string) {
  const name = place.displayName!.text;
  const rating = place.rating ?? MIN_RATING;
  const reviews = place.userRatingCount ?? 0;
  const photo = place.photos?.[0]?.name;
  const mapsUrl = `https://www.google.com/maps/place/?q=place_id:${place.id}`;

  return {
    slug,
    name,
    type: cat.type,
    vibe: `An independent ${cat.type.toLowerCase()} in ${area}.`,
    long_description: `A well-rated independent ${cat.type.toLowerCase()} in ${area}, holding ${rating.toFixed(1)}★ across ${reviews.toLocaleString()} Google reviews. Auto-discovered and pending an editorial write-up.`,
    neighbourhood: area,
    address: place.formattedAddress ?? `${area}, London`,
    lat: place.location?.latitude ?? null,
    lng: place.location?.longitude ?? null,
    price: priceFromLevel(place.priceLevel),
    time_of_day: cat.timeOfDay,
    rating,
    review_count: reviews,
    walking_mins: 12,
    tables_free: 4,
    next_slot_label: "Open today",
    img_url: photo
      ? photoUrl(photo)
      : "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=1600&q=80",
    mood_tags: cat.moods,
    vibe_tags: ["Independent"],
    google_place_id: place.id,
    booking_links: detectBookingLinks(place.websiteUri),
    website_url: place.websiteUri ?? null,
    phone: place.nationalPhoneNumber ?? place.internationalPhoneNumber ?? null,
    instagram_handle: null,
    editorial_sources: [
      {
        publication: "Google Places",
        url: mapsUrl,
        title: `Auto-discovered · ${rating.toFixed(1)}★ over ${reviews.toLocaleString()} reviews`,
        date: new Date().toISOString().slice(0, 10),
      },
    ],
    creator_coverage: null,
    critical_flags: null,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log(
    `Fun London — venue discovery · ${DRY_RUN ? "DRY RUN" : "AUTO-PUBLISH"}\n`,
  );

  // Existing catalog: dedupe by place_id, keep slugs unique.
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

  // Build the full search grid and take a rotating window so successive
  // runs explore different slices (and we don't pay for all 80 each time).
  const grid: { area: string; cat: Category }[] = [];
  for (const area of NEIGHBOURHOODS)
    for (const cat of CATEGORIES) grid.push({ area, cat });
  const start = Math.floor(Date.now() / (4 * 60 * 60 * 1000)) % grid.length;
  const combos = Array.from(
    { length: Math.min(COMBOS_PER_RUN, grid.length) },
    (_, i) => grid[(start + i) % grid.length],
  );

  const published: string[] = [];
  const seenThisRun = new Set<string>();
  let scanned = 0;
  let rejected = 0;

  for (const { area, cat } of combos) {
    if (published.length >= MAX_NEW_PER_RUN) break;
    let places: Place[] = [];
    try {
      places = await searchPlaces(`${cat.keyword} in ${area}, London`);
    } catch (e) {
      console.error(`  ✗ search ${cat.type} · ${area}:`, (e as Error).message);
      continue;
    }
    await sleep(250); // stay polite to the Places API

    for (const p of places) {
      if (published.length >= MAX_NEW_PER_RUN) break;
      scanned++;
      const name = p.displayName?.text;
      if (!name || !p.id) continue;
      if (existingPlaceIds.has(p.id) || seenThisRun.has(p.id)) continue;

      // Strict quality filters (the guard in place of a human reviewer).
      const reasons: string[] = [];
      if (p.businessStatus !== "OPERATIONAL") reasons.push("not operational");
      if ((p.rating ?? 0) < MIN_RATING) reasons.push(`rating ${p.rating ?? 0}`);
      if ((p.userRatingCount ?? 0) < MIN_REVIEWS)
        reasons.push(`${p.userRatingCount ?? 0} reviews`);
      if (!p.websiteUri) reasons.push("no website");
      if (isChain(name)) reasons.push("chain denylist");
      if (!typesOk(p.types)) reasons.push("type mismatch");
      if (reasons.length > 0) {
        rejected++;
        continue;
      }

      // Unique slug.
      let slug = slugify(name);
      if (usedSlugs.has(slug)) slug = `${slug}-${slugify(area)}`;
      let n = 2;
      while (usedSlugs.has(slug)) slug = `${slugify(name)}-${n++}`;

      const row = buildRow(p, cat, area, slug);
      seenThisRun.add(p.id);
      usedSlugs.add(slug);

      if (DRY_RUN) {
        console.log(
          `  [dry] ${cat.type} · ${area}: ${name} — ${p.rating}★ (${p.userRatingCount}) → /${slug}`,
        );
        published.push(slug);
        continue;
      }

      if (!supabase) continue;
      const { error } = await supabase
        .from("venues")
        .upsert(row, { onConflict: "google_place_id" });
      if (error) {
        console.error(`  ✗ upsert ${name}: ${error.message}`);
        rejected++;
      } else {
        console.log(`  ✓ published ${name} → /${slug}`);
        published.push(slug);
      }
    }
  }

  console.log("\n─────────── SUMMARY ───────────");
  console.log(`Combos scanned:   ${combos.length} (grid offset ${start})`);
  console.log(`Places examined:  ${scanned}`);
  console.log(`Rejected:         ${rejected}`);
  console.log(
    `${DRY_RUN ? "Would publish" : "Published"}:    ${published.length}`,
  );
  published.forEach((s) => console.log(`  • ${s}`));
  console.log(`\n${DRY_RUN ? "Dry run complete." : "Discovery complete."}`);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
