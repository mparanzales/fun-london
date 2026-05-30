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
//      >= CHAIN_LOCATIONS distinct => chain => reject (Maria's rule: judge by
//      number of locations, NOT a name denylist).
//   4. VALIDATE (Gemini + built-in Google Search) — which trusted publications
//      actually cover this venue? Require >= 2 distinct ones.
//   5. EDITORIAL (Gemini) — write the vibe, the review (good AND bad, in the
//      cool/brat/gen-z voice), and the "Real Talk" critical flags.
//   6. AUTO-PUBLISH to public.venues with the real editorial_sources +
//      critical_flags (per Maria: auto-publish, strict gate is the guard).
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
import type { BookingLink, Mood, VenueType } from "@/lib/types";

const DRY_RUN = process.argv.includes("--dry-run");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const TARGET = limitArg ? Number(limitArg.split("=")[1]) : 10;

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
const CHAIN_LOCATIONS = 6; // >= this many London locations of the name = chain
const MAX_SCAN_PER_RUN = 60; // bound API usage: stop after examining this many
const REQUIRED_SOURCES = 2;

const NEIGHBOURHOODS = [
  "Soho", "Shoreditch", "Hackney", "Dalston", "Peckham", "Bermondsey",
  "Clerkenwell", "Islington", "Borough", "Marylebone", "Fitzrovia", "Brixton",
  "Stoke Newington", "Spitalfields", "London Fields", "Camberwell",
];

type Category = {
  keyword: string;
  type: VenueType;
  moods: Mood[];
  timeOfDay: "Day" | "Evening" | "Night";
};

const CATEGORIES: Category[] = [
  { keyword: "independent restaurant", type: "Restaurant", moods: ["dinner"], timeOfDay: "Evening" },
  { keyword: "natural wine bar", type: "Wine Bar", moods: ["drinks"], timeOfDay: "Evening" },
  { keyword: "cocktail bar", type: "Bar", moods: ["drinks"], timeOfDay: "Night" },
  { keyword: "speciality coffee shop", type: "Cafe", moods: [], timeOfDay: "Day" },
  { keyword: "gastropub", type: "Pub", moods: ["drinks"], timeOfDay: "Night" },
];

// The trusted publications that count toward the 2-source gate.
const TRUSTED_PUBLICATIONS = [
  "Time Out", "The Infatuation", "Eater London", "Square Meal", "Hot Dinners",
  "Harden's", "Michelin", "The Good Food Guide", "Condé Nast Traveller",
  "Evening Standard", "The Guardian", "Foodism", "World's 50 Best",
];

const ALLOWED_TYPES = new Set([
  "restaurant", "bar", "cafe", "coffee_shop", "pub", "wine_bar",
  "fine_dining_restaurant", "bakery", "brunch_restaurant",
]);
const REJECT_TYPES = new Set([
  "fast_food_restaurant", "meal_takeaway", "lodging", "supermarket",
  "grocery_store", "shopping_mall", "night_club", "liquor_store",
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
  "places.id", "places.displayName", "places.formattedAddress",
  "places.location", "places.rating", "places.userRatingCount",
  "places.photos", "places.websiteUri", "places.nationalPhoneNumber",
  "places.internationalPhoneNumber", "places.priceLevel", "places.types",
  "places.businessStatus",
].join(",");

// Count distinct London locations of a venue name → chain heuristic.
async function londonLocationCount(name: string): Promise<number> {
  try {
    const places = await searchPlaces(
      `${name} London`,
      "places.id,places.displayName",
    );
    const firstWord = name.toLowerCase().split(" ")[0];
    const matches = places.filter((p) =>
      (p.displayName?.text ?? "").toLowerCase().includes(firstWord),
    );
    return matches.length;
  } catch {
    return 1; // on error, don't falsely flag as chain
  }
}

function photoUrl(photoName: string, maxWidth = 1600): string {
  return `https://places.googleapis.com/v1/${photoName}/media?key=${GOOGLE_PLACES_API_KEY}&maxWidthPx=${maxWidth}`;
}

// ── Gemini (validation via grounding + editorial) ────────────────────────

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

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
  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
    }),
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

// Ask Gemini to write the brand-voice editorial + Real Talk.
async function writeEditorial(
  name: string,
  type: VenueType,
  area: string,
  sources: Source[],
): Promise<Editorial | null> {
  const prompt =
    `You are the editorial voice of Fun London — a curated London going-out ` +
    `guide. Voice: cool, gen-z, "brat", confident and honest — the good AND ` +
    `the bad, never fawning, never corporate.\n\n` +
    `Write a short editorial for the ${type.toLowerCase()} "${name}" in ${area}, ` +
    `London. It is covered by: ${sources.map((s) => s.publication).join(", ")}. ` +
    `Use what you know from those reviews.\n\n` +
    `Return JSON with exactly these keys:\n` +
    `- "vibe": a punchy one-line tagline (max ~8 words)\n` +
    `- "long_description": 2-3 sentences, the honest lowdown incl. one real ` +
    `downside or watch-out\n` +
    `- "critical_flags": array of 1-2 {"label","body"} "Real Talk" notes ` +
    `(queues, no-bookings, loud, pricey, events-only, etc.) — label ~4 words, ` +
    `body one sentence.`;
  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" },
    }),
  });
  if (!res.ok) throw new Error(`Gemini editorial ${res.status}`);
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ??
    "";
  const parsed = extractJson(text) as Editorial | null;
  if (!parsed || !parsed.vibe || !parsed.long_description) return null;
  if (!Array.isArray(parsed.critical_flags)) parsed.critical_flags = [];
  return parsed;
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
    if (re.test(websiteUri)) return [{ platform, url: websiteUri, priority: 1 }];
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

      // Cheap pre-filter before any expensive calls.
      if (
        p.businessStatus !== "OPERATIONAL" ||
        (p.rating ?? 0) < MIN_RATING ||
        (p.userRatingCount ?? 0) < MIN_REVIEWS ||
        !p.websiteUri ||
        !typesOk(p.types)
      ) {
        continue;
      }
      seen.add(p.id);
      scanned++;

      // Chain check (location count).
      const locations = await londonLocationCount(name);
      if (locations >= CHAIN_LOCATIONS) {
        console.log(`  ⊘ chain (${locations} locations): ${name}`);
        continue;
      }
      await sleep(150);

      // 2-source validation via Gemini + Google Search.
      let sources: Source[] = [];
      try {
        sources = await validateSources(name, area);
      } catch (e) {
        console.error(`  ✗ validate ${name}: ${(e as Error).message}`);
        continue;
      }
      if (sources.length < REQUIRED_SOURCES) {
        console.log(`  ✗ ${name}: only ${sources.length} source(s)`);
        continue;
      }

      // Editorial.
      let editorial: Editorial | null = null;
      try {
        editorial = await writeEditorial(name, cat.type, area, sources);
      } catch (e) {
        console.error(`  ✗ editorial ${name}: ${(e as Error).message}`);
        continue;
      }
      if (!editorial) {
        console.log(`  ✗ ${name}: editorial generation failed`);
        continue;
      }

      // Unique slug.
      let slug = slugify(name);
      let n = 2;
      while (usedSlugs.has(slug)) slug = `${slugify(name)}-${n++}`;
      usedSlugs.add(slug);

      const row = {
        slug,
        name,
        type: cat.type,
        vibe: editorial.vibe,
        long_description: editorial.long_description,
        neighbourhood: area,
        address: p.formattedAddress ?? `${area}, London`,
        lat: p.location?.latitude ?? null,
        lng: p.location?.longitude ?? null,
        price: priceFromLevel(p.priceLevel),
        time_of_day: cat.timeOfDay,
        rating: p.rating ?? MIN_RATING,
        review_count: p.userRatingCount ?? 0,
        walking_mins: 12,
        tables_free: 4,
        next_slot_label: "Open today",
        img_url: p.photos?.[0]?.name
          ? photoUrl(p.photos[0].name)
          : "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=1600&q=80",
        mood_tags: cat.moods,
        vibe_tags: ["Independent"],
        google_place_id: p.id,
        booking_links: detectBookingLinks(p.websiteUri),
        website_url: p.websiteUri ?? null,
        phone: p.nationalPhoneNumber ?? p.internationalPhoneNumber ?? null,
        instagram_handle: null,
        editorial_sources: sources.map((s) => ({
          publication: s.publication,
          url: s.url,
        })),
        creator_coverage: null,
        critical_flags: editorial.critical_flags,
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
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
