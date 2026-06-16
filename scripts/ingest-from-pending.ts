// Fun London — ingest approved pending_candidates into venues.
//
// For each approved candidate:
//   1. Google Places Text Search to find the place_id.
//   2. Google Place Details for canonical data (lat/lng, photos, hours, etc.).
//   3. Upsert into public.venues (curation_tier = "discovered").
//      Also upsert into partner_prospects if no major booking platform detected.
//   4. Mark the candidate as status = "ingested" in pending_candidates.
//
// Idempotent: safe to re-run. Skips candidates whose google_place_id is
// already in venues. Skips candidates that previously failed (status =
// "ingest_failed") unless you pass --retry-failed.
//
// Run:
//   pnpm ingest:from-pending --dry-run     # print what would happen, no writes
//   pnpm ingest:from-pending               # write to Supabase
//   pnpm ingest:from-pending --limit=50    # process only the first 50
//   pnpm ingest:from-pending --retry-failed
//
// Required environment (.env.local):
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   GOOGLE_PLACES_API_KEY

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { resolveVenuePhoto } from "./photo-storage";
import {
  normalizeOpeningHours,
  type GoogleOpeningHours,
} from "@/lib/opening-hours";
import type { BookingLink, BookingPlatform } from "@/lib/types";

const DRY_RUN = process.argv.includes("--dry-run");
const RETRY_FAILED = process.argv.includes("--retry-failed");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? parseInt(limitArg.slice("--limit=".length), 10) : null;
// Milliseconds between Google API calls to stay within rate limits
const API_DELAY_MS = 200;

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!GOOGLE_PLACES_API_KEY) {
  console.error("Missing GOOGLE_PLACES_API_KEY in .env.local");
  process.exit(1);
}
if (!SUPABASE_URL) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL in .env.local");
  process.exit(1);
}
if (!SUPABASE_SERVICE_ROLE_KEY && !DRY_RUN) {
  console.error(
    "Missing SUPABASE_SERVICE_ROLE_KEY in .env.local. Use --dry-run to skip writes.",
  );
  process.exit(1);
}

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createSupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      })
    : null;

// ── Types ────────────────────────────────────────────────────────────────────

type Candidate = {
  id: string;
  name: string;
  neighbourhood: string | null;
  type_guess: string | null;
  vibe_tags_draft: string[] | null;
  sources: Array<{
    source: string;
    cuisine_type?: string | null;
    cuisine_lists?: string[];
    occasion_lists?: string[];
    vibe_lists?: string[];
    top_lists?: string[];
    london_region?: string | null;
  }>;
};

type PlaceSearchResult = {
  id: string;
  displayName: { text: string };
  formattedAddress: string;
};

type PlaceDetails = {
  id: string;
  displayName: { text: string };
  formattedAddress: string;
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
  regularOpeningHours?: GoogleOpeningHours;
};

// ── Google Places ────────────────────────────────────────────────────────────

const PLACES_BASE = "https://places.googleapis.com/v1/places";

async function placesTextSearch(
  query: string,
): Promise<PlaceSearchResult | null> {
  const res = await fetch(`${PLACES_BASE}:searchText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY!,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress",
    },
    body: JSON.stringify({ textQuery: query }),
  });
  if (!res.ok) {
    throw new Error(`Places search failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { places?: PlaceSearchResult[] };
  return json.places?.[0] ?? null;
}

async function placeDetails(placeId: string): Promise<PlaceDetails> {
  const fieldMask = [
    "id",
    "displayName",
    "formattedAddress",
    "location",
    "rating",
    "userRatingCount",
    "photos",
    "websiteUri",
    "nationalPhoneNumber",
    "internationalPhoneNumber",
    "priceLevel",
    "types",
    "reservable",
    "businessStatus",
    "regularOpeningHours",
  ].join(",");

  const res = await fetch(`${PLACES_BASE}/${placeId}`, {
    headers: {
      "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY!,
      "X-Goog-FieldMask": fieldMask,
    },
  });
  if (!res.ok) {
    throw new Error(
      `Place details failed for ${placeId}: ${res.status} ${await res.text()}`,
    );
  }
  return (await res.json()) as PlaceDetails;
}

// ── Booking platform detection ───────────────────────────────────────────────

const PLATFORM_PATTERNS: { platform: BookingPlatform; pattern: RegExp }[] = [
  { platform: "opentable", pattern: /opentable\.(com|co\.uk)/i },
  { platform: "resy", pattern: /resy\.com/i },
  { platform: "sevenrooms", pattern: /sevenrooms\.com/i },
  { platform: "thefork", pattern: /thefork\.(com|co\.uk)/i },
  { platform: "quandoo", pattern: /quandoo\.(com|co\.uk)/i },
  { platform: "tablein", pattern: /tablein\.com/i },
];

const MAJOR_PLATFORMS: BookingPlatform[] = [
  "opentable",
  "resy",
  "sevenrooms",
  "thefork",
  "quandoo",
  "tablein",
];

function detectBookingLinks(websiteUri?: string): BookingLink[] {
  if (!websiteUri) return [];
  for (const { platform, pattern } of PLATFORM_PATTERNS) {
    if (pattern.test(websiteUri)) {
      return [{ platform, url: websiteUri, priority: 1 }];
    }
  }
  return [{ platform: "website", url: websiteUri, priority: 99 }];
}

function hasMajorBookingPlatform(links: BookingLink[]): boolean {
  return links.some((l) =>
    (MAJOR_PLATFORMS as readonly BookingPlatform[]).includes(l.platform),
  );
}

// ── Slug ─────────────────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// ── Derive venue fields from candidate + Google data ─────────────────────────

// Map Google priceLevel to Fun London PriceTier
function mapPriceLevel(level?: string): string {
  switch (level) {
    case "PRICE_LEVEL_FREE":
      return "Free";
    case "PRICE_LEVEL_INEXPENSIVE":
      return "£";
    case "PRICE_LEVEL_MODERATE":
      return "££";
    case "PRICE_LEVEL_EXPENSIVE":
    case "PRICE_LEVEL_VERY_EXPENSIVE":
      return "£££";
    default:
      return "££";
  }
}

// Map Google place types to Fun London VenueType
function mapVenueType(candidate: Candidate, googleTypes?: string[]): string {
  const typeGuess = candidate.type_guess?.toLowerCase() ?? "";
  const onezoneSource = candidate.sources.find((s) => s.source === "onezone");
  const cuisine = onezoneSource?.cuisine_type?.toLowerCase() ?? "";
  const venueLists = onezoneSource?.vibe_lists ?? [];

  if (
    typeGuess === "pub" ||
    cuisine === "gastropub" ||
    cuisine === "beer" ||
    cuisine === "guinness" ||
    venueLists.some((v) => v.toLowerCase().includes("pub"))
  )
    return "Pub";

  if (
    typeGuess === "wine bar" ||
    cuisine === "wine" ||
    cuisine === "natural wine"
  )
    return "Wine Bar";

  if (
    typeGuess === "bar" ||
    cuisine === "cocktail" ||
    cuisine === "craft beer" ||
    venueLists.some(
      (v) =>
        v.toLowerCase().includes("cocktail") || v.toLowerCase().includes("bar"),
    )
  )
    return "Bar";

  if (
    typeGuess === "cafe" ||
    [
      "bakery",
      "pastries",
      "cake",
      "coffee",
      "matcha",
      "sandwiches",
      "deli",
      "salads",
      "healthy",
      "smoothies",
      "juice",
      "ice cream",
      "poke",
      "acai",
    ].includes(cuisine)
  )
    return "Cafe";

  if (typeGuess === "market" || cuisine === "street food") return "Market";

  if (googleTypes?.includes("night_club")) return "Live Music";

  return "Restaurant";
}

// Derive mood tags from OneZone occasion lists and vibe lists
function deriveMoodTags(candidate: Candidate): string[] {
  const source = candidate.sources.find((s) => s.source === "onezone");
  if (!source) return ["dinner"];

  const moods = new Set<string>();
  const occasions = (source.occasion_lists ?? []).map((o) => o.toLowerCase());
  const vibes = (source.vibe_lists ?? []).map((v) => v.toLowerCase());
  const tags = (candidate.vibe_tags_draft ?? []).map((t) => t.toLowerCase());
  const all = [...occasions, ...vibes, ...tags];

  const drinkKeywords = [
    "drinks",
    "bar",
    "cocktail",
    "beer",
    "wine",
    "pub",
    "boozers",
  ];
  const cultureKeywords = ["art", "culture", "museum", "gallery", "theatre"];
  const activityKeywords = ["market", "outdoor", "activity", "spa", "dancing"];

  if (all.some((t) => drinkKeywords.some((k) => t.includes(k))))
    moods.add("drinks");
  if (all.some((t) => cultureKeywords.some((k) => t.includes(k))))
    moods.add("culture");
  if (all.some((t) => activityKeywords.some((k) => t.includes(k))))
    moods.add("activity");

  // Default: dinner is always valid for a restaurant
  moods.add("dinner");

  return Array.from(moods);
}

// Carry the FULL onezone tag set onto the venue, deduped. vibe_tags_draft holds
// the rich raw "Tags" column (Date Night, Cosy, Tasting Menu, ...) plus the
// Vibes lists; `source` carries the remaining curated lists. We insert ALL of
// them — the card decides how many chips to render.
function deriveVibeTags(candidate: Candidate): string[] {
  const source = candidate.sources.find((s) => s.source === "onezone");

  const tags = new Set<string>();
  for (const t of candidate.vibe_tags_draft ?? []) tags.add(t);
  for (const c of source?.cuisine_lists ?? []) tags.add(c);
  for (const o of source?.occasion_lists ?? []) tags.add(o);
  for (const v of source?.vibe_lists ?? []) tags.add(v);
  for (const t of source?.top_lists ?? []) tags.add(t);

  return Array.from(tags);
}

// ── Row builders ─────────────────────────────────────────────────────────────

function buildVenueRow(
  candidate: Candidate,
  details: PlaceDetails,
  imgUrl: string,
  slug: string,
) {
  const bookingLinks = detectBookingLinks(details.websiteUri);
  const source = candidate.sources.find((s) => s.source === "onezone");

  return {
    slug,
    name: details.displayName.text,
    type: mapVenueType(candidate, details.types),
    // vibe and long_description are intentionally minimal — the admin can
    // enrich these after ingestion, or a future AI pass can fill them in.
    // NOTE: long_description / next_slot_label are "" and tables_free 0 (not
    // null) because those columns are NOT NULL — a null would fail the insert.
    vibe: source?.cuisine_type ?? candidate.type_guess ?? "London favourite",
    long_description: "",
    neighbourhood: candidate.neighbourhood ?? "London",
    address: details.formattedAddress,
    lat: details.location?.latitude ?? null,
    lng: details.location?.longitude ?? null,
    price: mapPriceLevel(details.priceLevel),
    time_of_day: "Evening", // sensible default; admin can refine
    rating: details.rating ?? 4.0,
    review_count: details.userRatingCount ?? 0,
    walking_mins: 12,
    tables_free: 0,
    next_slot_label: "",
    img_url: imgUrl,
    curation_tier: "discovered",
    mood_tags: deriveMoodTags(candidate),
    vibe_tags: deriveVibeTags(candidate),
    google_place_id: details.id,
    booking_links: bookingLinks,
    website_url: details.websiteUri ?? null,
    phone:
      details.nationalPhoneNumber ?? details.internationalPhoneNumber ?? null,
    instagram_handle: null,
    editorial_sources: [],
    creator_coverage: [],
    critical_flags: [],
    opening_hours: normalizeOpeningHours(details.regularOpeningHours),
  };
}

function buildProspectRow(candidate: Candidate, details: PlaceDetails) {
  const bookingLinks = detectBookingLinks(details.websiteUri);
  const bookingMethod =
    bookingLinks.length === 0
      ? "walk-in only"
      : bookingLinks[0].platform === "website"
        ? "own website only"
        : `platform: ${bookingLinks[0].platform}`;

  return {
    name: details.displayName.text,
    google_place_id: details.id,
    type: mapVenueType(candidate, details.types),
    neighbourhood: candidate.neighbourhood ?? "London",
    address: details.formattedAddress,
    website_url: details.websiteUri ?? null,
    phone:
      details.nationalPhoneNumber ?? details.internationalPhoneNumber ?? null,
    instagram_handle: null,
    why_qualified:
      "Approved from OneZone import. No major booking platform detected — added to BD pipeline.",
    current_booking_method: bookingMethod,
    editorial_sources: [],
    creator_coverage: [],
    critical_flags: [],
    bd_status: "prospect" as const,
    notes: `OneZone source. Area: ${candidate.neighbourhood ?? "unknown"}`,
  };
}

// ── Per-candidate processor ──────────────────────────────────────────────────

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Quality gate ──────────────────────────────────────────────────────────────
// onezone restaurant names that are also street addresses ("64 Goodge Street")
// frequently match a junk Google listing with no rating. Only AUTO-PUBLISH
// high-confidence matches: operational, with a real rating and enough reviews.
// Everything else is quarantined (status="needs_review") for a human to judge —
// it is NOT lost, just kept out of the live catalogue.
const MIN_REVIEWS = 20;

function qualityCheck(d: PlaceDetails): { ok: boolean; reason?: string } {
  if (d.businessStatus !== "OPERATIONAL")
    return {
      ok: false,
      reason: `not operational (status=${d.businessStatus ?? "unknown"})`,
    };
  if (d.rating == null)
    return {
      ok: false,
      reason: "no Google rating (likely an address / wrong match)",
    };
  if ((d.userRatingCount ?? 0) < MIN_REVIEWS)
    return {
      ok: false,
      reason: `only ${d.userRatingCount ?? 0} reviews (min ${MIN_REVIEWS})`,
    };
  return { ok: true };
}

async function processCandidate(candidate: Candidate, usedSlugs: Set<string>) {
  const searchQuery = `${candidate.name} ${candidate.neighbourhood ?? ""} London`;
  console.log(`\n→ "${candidate.name}" (${candidate.neighbourhood ?? "?"})`);

  const searchResult = await placesTextSearch(searchQuery);
  if (!searchResult) {
    throw new Error(`No Google Places result for "${searchQuery}"`);
  }
  console.log(
    `  found: ${searchResult.displayName.text} · ${searchResult.formattedAddress}`,
  );

  // Already in venues? Don't re-publish — but reconcile first. The onezone
  // candidate may carry tags this venue was imported without (e.g. venues
  // ingested before the all-tags fix, or matched by a different candidate).
  // Union the candidate's full tag set into the existing venue so nothing the
  // spreadsheet knows is lost, then mark the candidate "skipped" (stamping the
  // matched place_id) so it drains and never re-bills Google next pass.
  if (!DRY_RUN && supabase) {
    const { data: existing } = await supabase
      .from("venues")
      .select("id, slug, vibe_tags, curation_tier")
      .eq("google_place_id", searchResult.id)
      .maybeSingle();
    if (existing) {
      // Only enrich DISCOVERED venues. Curated venues carry hand-picked
      // editorial chips — never overwrite those with raw onezone labels.
      let added = 0;
      if (existing.curation_tier === "discovered") {
        const existingSet = new Set<string>(existing.vibe_tags ?? []);
        const mergedSet = new Set<string>([
          ...existingSet,
          ...deriveVibeTags(candidate),
        ]);
        // Count by set difference so a pre-existing duplicate in the stored
        // array can't make a genuinely-new tag look like "nothing added".
        added = mergedSet.size - existingSet.size;
        if (added > 0) {
          const { error: enrichErr } = await supabase
            .from("venues")
            .update({ vibe_tags: Array.from(mergedSet) })
            .eq("id", existing.id);
          if (enrichErr)
            console.warn(`  ⚠ tag enrich failed: ${enrichErr.message}`);
          else
            console.log(
              `  ↩ already in venues as "${existing.slug}" — +${added} missing tags (now ${mergedSet.size})`,
            );
        } else {
          console.log(
            `  ↩ already in venues as "${existing.slug}" — tags already complete`,
          );
        }
      } else {
        console.log(
          `  ↩ already in venues as "${existing.slug}" (curated — tags left untouched)`,
        );
      }
      const { error: skipErr } = await supabase
        .from("pending_candidates")
        .update({
          // No google_place_id stamp: it is UNIQUE on pending_candidates and
          // many onezone candidates map to one venue, so only the published
          // ("ingested") candidate holds the link. The matched venue slug is
          // recorded in reviewed_notes instead.
          status: "skipped",
          reviewed_at: new Date().toISOString(),
          reviewed_notes: `Already in venues as "${existing.slug}"${added > 0 ? ` (+${added} tags)` : ""}`,
        })
        .eq("id", candidate.id);
      if (skipErr)
        console.warn(`  ⚠ skip status update failed: ${skipErr.message}`);
      return { status: "skipped" as const };
    }
  }

  const details = await placeDetails(searchResult.id);
  console.log(
    `  rating: ${details.rating ?? "n/a"} · reviews: ${details.userRatingCount ?? 0} · status: ${details.businessStatus ?? "?"}`,
  );

  // ── Quality gate: auto-publish only confident matches; quarantine the rest ──
  const gate = qualityCheck(details);
  if (!gate.ok) {
    console.log(`  ⏸ needs review — ${gate.reason} (not published)`);
    if (!DRY_RUN && supabase) {
      const { error: qErr } = await supabase
        .from("pending_candidates")
        .update({
          status: "needs_review",
          reviewed_at: new Date().toISOString(),
          reviewed_notes: `Auto-gate: ${gate.reason}`,
          // Do NOT stamp google_place_id here: pending_candidates.google_place_id
          // is UNIQUE, and several onezone candidates can resolve to the same
          // Google place. Only the candidate that actually publishes (the
          // "ingested" path) holds the 1:1 link. The match is preserved in
          // filter_results below for the reviewer.
          filter_results: {
            gate: "failed",
            reason: gate.reason,
            matched_name: details.displayName.text,
            matched_address: details.formattedAddress,
            rating: details.rating ?? null,
            reviews: details.userRatingCount ?? 0,
            business_status: details.businessStatus ?? null,
            website: details.websiteUri ?? null,
          },
        })
        .eq("id", candidate.id);
      if (qErr)
        console.warn(`  ⚠ needs_review status update failed: ${qErr.message}`);
    }
    return { status: "needs_review" as const };
  }

  const bookingLinks = detectBookingLinks(details.websiteUri);
  const hasMajor = hasMajorBookingPlatform(bookingLinks);

  let slug = slugify(details.displayName.text);
  let n = 2;
  while (usedSlugs.has(slug))
    slug = `${slugify(details.displayName.text)}-${n++}`;
  usedSlugs.add(slug);

  if (DRY_RUN) {
    console.log(
      `  [dry-run] would upsert as slug="${slug}" · type=${mapVenueType(candidate, details.types)} · booking=${bookingLinks[0]?.platform ?? "none"}`,
    );
    return { status: "dry" as const };
  }

  if (!supabase) throw new Error("Supabase client not initialised");

  const photoName = details.photos?.[0]?.name;
  const imgUrl = await resolveVenuePhoto(photoName, slug, supabase);

  const venueRow = buildVenueRow(candidate, details, imgUrl, slug);
  const { error: venueErr } = await supabase
    .from("venues")
    .upsert(venueRow, { onConflict: "google_place_id" });
  if (venueErr) throw new Error(`venues upsert failed: ${venueErr.message}`);
  console.log(`  ✓ venues · slug="${slug}"`);

  if (!hasMajor) {
    const prospectRow = buildProspectRow(candidate, details);
    const { error: prospectErr } = await supabase
      .from("partner_prospects")
      .upsert(prospectRow, { onConflict: "google_place_id" });
    if (prospectErr)
      console.warn(
        `  ⚠ partner_prospects upsert failed: ${prospectErr.message}`,
      );
    else console.log(`  ★ partner_prospects`);
  }

  // Mark candidate ingested + stamp the matched place_id so the venue can be
  // linked back to its candidate (e.g. for tag backfills / personalisation).
  const { error: ingErr } = await supabase
    .from("pending_candidates")
    .update({
      status: "ingested",
      reviewed_at: new Date().toISOString(),
      google_place_id: details.id,
    })
    .eq("id", candidate.id);
  if (ingErr)
    console.warn(`  ⚠ ingested status update failed: ${ingErr.message}`);

  return { status: "ingested" as const };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(
    `Fun London — ingest from pending_candidates · ${DRY_RUN ? "DRY RUN" : "WRITING"}${LIMIT ? ` · limit ${LIMIT}` : ""}\n`,
  );

  if (!supabase && !DRY_RUN) throw new Error("No Supabase client");

  // Fetch approved candidates
  const statuses = RETRY_FAILED ? ["approved", "ingest_failed"] : ["approved"];

  let query = supabase
    ? supabase
        .from("pending_candidates")
        .select("id, name, neighbourhood, type_guess, vibe_tags_draft, sources")
        .in("status", statuses)
        .order("created_at", { ascending: true })
    : null;

  if (!query) {
    // dry-run without supabase: fetch via REST for display
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/pending_candidates?select=id,name,neighbourhood,type_guess,vibe_tags_draft,sources&status=in.(${statuses.join(",")})&order=created_at.asc${LIMIT ? `&limit=${LIMIT}` : ""}`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY ?? "",
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY ?? ""}`,
        },
      },
    );
    const candidates = (await res.json()) as Candidate[];
    console.log(
      `Found ${candidates.length} approved candidates (dry-run fetch)`,
    );
    return;
  }

  if (LIMIT) query = query.limit(LIMIT);
  const { data: rows, error } = await query;
  if (error) {
    console.error("Failed to fetch candidates:", error.message);
    process.exit(1);
  }

  const candidates = (rows ?? []) as Candidate[];
  console.log(`Found ${candidates.length} approved candidates to process\n`);

  if (candidates.length === 0) {
    console.log("Nothing to do. Run the import script and bulk-approve first.");
    return;
  }

  // Pre-fetch ALL existing slugs (paginated). PostgREST caps a plain select at
  // 1000 rows and there are well over 1000 venues, so an unpaginated fetch
  // would miss slugs and let the slugify loop below collide with the
  // venues_slug_key UNIQUE constraint (a 23505 that would strand the candidate
  // in ingest_failed and silently never publish it).
  const usedSlugs = new Set<string>();
  if (supabase) {
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data: page, error: slugErr } = await supabase
        .from("venues")
        .select("slug")
        .range(from, from + PAGE - 1);
      if (slugErr) {
        console.error("Failed to pre-fetch slugs:", slugErr.message);
        process.exit(1);
      }
      for (const r of page ?? []) usedSlugs.add((r as { slug: string }).slug);
      if (!page || page.length < PAGE) break;
    }
  }

  const results = {
    ingested: 0,
    skipped: 0,
    needsReview: 0,
    failed: [] as { name: string; error: string }[],
  };

  for (const candidate of candidates) {
    try {
      const r = await processCandidate(candidate, usedSlugs);
      if (r.status === "ingested") results.ingested++;
      else if (r.status === "skipped") results.skipped++;
      else if (r.status === "needs_review") results.needsReview++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ FAILED: ${msg}`);
      results.failed.push({ name: candidate.name, error: msg });

      // Mark as failed so --retry-failed can target them
      if (supabase && !DRY_RUN) {
        const { error: fErr } = await supabase
          .from("pending_candidates")
          .update({
            status: "ingest_failed",
            reviewed_notes: msg.slice(0, 500),
          })
          .eq("id", candidate.id);
        if (fErr)
          console.warn(
            `  ⚠ ingest_failed status update failed: ${fErr.message}`,
          );
      }
    }

    // Rate-limit: 5 req/s is comfortably within Google's 10 req/s default
    await sleep(API_DELAY_MS);
  }

  console.log("\n─────────── SUMMARY ───────────");
  console.log(`Ingested (published):        ${results.ingested}`);
  console.log(`Needs review (quarantined):  ${results.needsReview}`);
  console.log(`Skipped (already in venues): ${results.skipped}`);
  console.log(`Failed (lookup error):       ${results.failed.length}`);
  if (results.failed.length > 0) {
    results.failed.forEach((f) => console.log(`  ✗ ${f.name}: ${f.error}`));
    console.log("\nRe-run with --retry-failed to retry only the failed ones.");
  }
  console.log(`\n${DRY_RUN ? "Dry run complete." : "Done."}`);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
