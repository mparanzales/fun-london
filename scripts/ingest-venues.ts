// Fun London — venue ingestion script.
//
// Reads scripts/venues-seed.ts. For each venue:
//   1. Google Places Text Search to find the place_id.
//   2. Google Place Details to fetch the canonical data
//      (name, address, lat/lng, photos, rating, website, phone, types).
//   3. Detect booking platforms from the venue's website.
//   4. Route: venues table if at least one major-platform booking (OpenTable,
//      Resy, SevenRooms, TheFork, Quandoo, Tablein); partner_prospects
//      otherwise.
//   5. Upsert to Supabase. Idempotent on google_place_id.
//
// Run:
//   pnpm ingest                    # writes to Supabase
//   pnpm ingest:dry                # prints what would be written, no DB write
//
// Required environment (in .env.local):
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY       (NOT the anon key — needs write access)
//   GOOGLE_PLACES_API_KEY

import * as dotenv from "dotenv";
// Next.js convention: env vars live in .env.local (not .env). Load it
// explicitly so this script works from any cwd inside the repo.
dotenv.config({ path: ".env.local" });

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { VENUE_SEEDS, type VenueSeed } from "./venues-seed";
import { mirrorPhotoToStorage } from "./photo-storage";
import type { BookingLink, BookingPlatform } from "@/lib/types";
import {
  normalizeOpeningHours,
  type GoogleOpeningHours,
} from "@/lib/opening-hours";

const DRY_RUN = process.argv.includes("--dry-run");

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
    "Missing SUPABASE_SERVICE_ROLE_KEY in .env.local (required for writes). " +
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

// Booking platform fingerprints. Major platforms = real reservation systems.
// "website" is the fallback (venue's own site).
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

// ── Google Places API ────────────────────────────────────────────────────

const PLACES_BASE = "https://places.googleapis.com/v1/places";

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

async function placesTextSearch(query: string): Promise<PlaceSearchResult> {
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
    throw new Error(
      `Places search failed for "${query}": ${res.status} ${await res.text()}`,
    );
  }
  const json = (await res.json()) as { places?: PlaceSearchResult[] };
  if (!json.places || json.places.length === 0) {
    throw new Error(`No Places result for "${query}"`);
  }
  return json.places[0];
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
    method: "GET",
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

// ── Booking platform detection ───────────────────────────────────────────

function detectBookingLinks(
  websiteUri: string | undefined,
  reservable: boolean | undefined,
): BookingLink[] {
  if (!websiteUri) return [];
  const links: BookingLink[] = [];

  // Check for major platform patterns in the venue's website redirects.
  // Most independent venues link to OpenTable/Resy from their site; here
  // we only know the venue's own URL, so we always add it as priority 99
  // (the catch-all fallback). Major platforms are detected if the
  // website itself IS a booking widget (rare), and would be added by the
  // partner-dashboard scraper later.
  for (const { platform, pattern } of PLATFORM_PATTERNS) {
    if (pattern.test(websiteUri)) {
      links.push({ platform, url: websiteUri, priority: 1 });
      return links;
    }
  }

  // Default: the venue's own site as a fallback link. We still mark it
  // "reservable" if Google says so (means there's some booking flow on
  // the site, even if not OpenTable/Resy). Otherwise, websites that
  // can't actually be booked through (walk-in venues, info-only) end up
  // as walk-in venues in the catalog.
  links.push({
    platform: "website",
    url: websiteUri,
    priority: 99,
  });
  return links;
}

function hasMajorBookingPlatform(links: BookingLink[]): boolean {
  return links.some((l) =>
    (MAJOR_PLATFORMS as readonly BookingPlatform[]).includes(l.platform),
  );
}

// ── Photo URL ────────────────────────────────────────────────────────────

function photoUrl(photoName: string, maxWidth = 1600): string {
  // Returns a Google-CDN URL that resolves to the photo. The API key is
  // inline because the photo-media endpoint requires it. Acceptable for
  // V1 because the key is restricted to Places API only at the Google
  // Cloud level — even if scraped from the page, it can't be abused for
  // anything beyond Places lookups (and our usage is well under the free
  // tier). Future: download + reupload to Supabase Storage so the key
  // doesn't appear in public URLs.
  return `https://places.googleapis.com/v1/${photoName}/media?key=${GOOGLE_PLACES_API_KEY}&maxWidthPx=${maxWidth}`;
}

// ── Row builders ─────────────────────────────────────────────────────────

const UNSPLASH_FALLBACK =
  "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=1600&q=80";

function buildVenueRow(seed: VenueSeed, details: PlaceDetails, imgUrl: string) {
  const websiteUri = details.websiteUri ?? null;
  const bookingLinks = detectBookingLinks(
    websiteUri ?? undefined,
    details.reservable,
  );

  return {
    slug: seed.slug,
    name: details.displayName.text,
    type: seed.type,
    vibe: seed.vibe,
    long_description: seed.longDescription,
    neighbourhood: seed.neighbourhood,
    address: details.formattedAddress,
    lat: details.location?.latitude ?? null,
    lng: details.location?.longitude ?? null,
    price: seed.price,
    time_of_day: seed.timeOfDay,
    rating: details.rating ?? 4.5,
    review_count: details.userRatingCount ?? 0,
    walking_mins: 12, // hard-coded V1 default; future: compute from user location
    tables_free: 4, // hard-coded V1 default; future: real-time from booking platforms
    next_slot_label: "Open today",
    img_url: imgUrl,
    mood_tags: seed.moodTags,
    vibe_tags: seed.vibeTags,
    google_place_id: details.id,
    booking_links: bookingLinks,
    website_url: websiteUri,
    phone:
      details.nationalPhoneNumber ?? details.internationalPhoneNumber ?? null,
    instagram_handle: null, // not in Google Places — could be added manually later
    editorial_sources: seed.editorialSources,
    creator_coverage: seed.creatorCoverage,
    critical_flags: seed.criticalFlags,
    opening_hours: normalizeOpeningHours(details.regularOpeningHours),
  };
}

function buildProspectRow(seed: VenueSeed, details: PlaceDetails) {
  const websiteUri = details.websiteUri ?? null;
  const bookingLinks = detectBookingLinks(
    websiteUri ?? undefined,
    details.reservable,
  );
  const currentBookingMethod = (() => {
    if (bookingLinks.length === 0) return "walk-in only";
    if (bookingLinks[0].platform === "website") return "own website only";
    return `platform: ${bookingLinks[0].platform}`;
  })();

  return {
    name: details.displayName.text,
    google_place_id: details.id,
    type: seed.type,
    neighbourhood: seed.neighbourhood,
    address: details.formattedAddress,
    website_url: websiteUri,
    phone:
      details.nationalPhoneNumber ?? details.internationalPhoneNumber ?? null,
    instagram_handle: null,
    why_qualified:
      "Passed all four hard curation filters (independent · ≥2 trusted sources · open · has booking method), but no major-platform booking detected.",
    current_booking_method: currentBookingMethod,
    editorial_sources: seed.editorialSources,
    creator_coverage: seed.creatorCoverage,
    critical_flags: seed.criticalFlags,
    bd_status: "prospect" as const,
    notes: null,
  };
}

// ── Per-venue processor ──────────────────────────────────────────────────

async function processVenue(seed: VenueSeed): Promise<{
  slug: string;
  inVenues: boolean;
  inProspects: boolean;
  placeId: string;
  bookingPlatforms: BookingPlatform[];
}> {
  console.log(`\n→ ${seed.slug}`);

  const searchResult = await placesTextSearch(seed.searchQuery);
  console.log(`  found: ${searchResult.displayName.text}`);
  console.log(`  place_id: ${searchResult.id}`);

  const details = await placeDetails(searchResult.id);
  console.log(
    `  rating: ${details.rating ?? "n/a"} · reviews: ${details.userRatingCount ?? 0}`,
  );
  console.log(`  website: ${details.websiteUri ?? "(none)"}`);
  console.log(`  reservable: ${details.reservable ?? "unknown"}`);

  const links = detectBookingLinks(details.websiteUri, details.reservable);
  const platforms = links.map((l) => l.platform);
  const hasMajor = hasMajorBookingPlatform(links);
  console.log(
    `  booking: ${platforms.join(", ") || "(none)"} · ${hasMajor ? "has major platform" : "owner-managed → ALSO partner prospect"}`,
  );

  // Always upsert to venues — every venue that passes the curation
  // filters belongs in the public catalog. partner_prospects is an
  // *overlay* for internal BD use, not a replacement. Day-spots
  // (galleries/markets/parks) are catalog venues but not booking
  // partners, so they opt out of the prospects overlay via skipProspect.
  const wantsProspect = !hasMajor && !seed.skipProspect;
  if (DRY_RUN) {
    console.log(`  [dry-run] would upsert to venues`);
    if (wantsProspect)
      console.log(`  [dry-run] would ALSO upsert to partner_prospects`);
  } else {
    if (!supabase) throw new Error("Supabase client not initialised");

    // Resolve the venue photo: mirror to Supabase Storage (keyless URL) when
    // FL_PHOTO_BUCKET is configured, else fall back to the keyed Google URL.
    const photoName = details.photos?.[0]?.name;
    const imgUrl = photoName
      ? ((await mirrorPhotoToStorage(photoName, seed.slug, supabase)) ??
        photoUrl(photoName))
      : UNSPLASH_FALLBACK;

    const venueRow = buildVenueRow(seed, details, imgUrl);
    const { error: venueErr } = await supabase
      .from("venues")
      .upsert(venueRow, { onConflict: "google_place_id" });
    if (venueErr) {
      throw new Error(
        `venues upsert failed for ${seed.slug}: ${venueErr.message}`,
      );
    }
    console.log(`  ✓ upserted to venues`);

    if (wantsProspect) {
      const prospectRow = buildProspectRow(seed, details);
      const { error: prospectErr } = await supabase
        .from("partner_prospects")
        .upsert(prospectRow, { onConflict: "google_place_id" });
      if (prospectErr) {
        throw new Error(
          `partner_prospects upsert failed for ${seed.slug}: ${prospectErr.message}`,
        );
      }
      console.log(`  ★ also upserted to partner_prospects`);
    }
  }

  return {
    slug: seed.slug,
    inVenues: true,
    inProspects: wantsProspect,
    placeId: details.id,
    bookingPlatforms: platforms,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log(
    `Fun London — venue ingestion · ${VENUE_SEEDS.length} venues · ${DRY_RUN ? "DRY RUN" : "WRITING"}\n`,
  );

  const results = {
    venues: [] as string[],
    prospectsOverlay: [] as string[], // also in venues
    failed: [] as { slug: string; error: string }[],
  };

  for (const seed of VENUE_SEEDS) {
    try {
      const r = await processVenue(seed);
      if (r.inVenues) results.venues.push(r.slug);
      if (r.inProspects) results.prospectsOverlay.push(r.slug);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ FAILED: ${msg}`);
      results.failed.push({ slug: seed.slug, error: msg });
    }
  }

  console.log("\n─────────── SUMMARY ───────────");
  console.log(`Venues (catalog, user-facing): ${results.venues.length}`);
  results.venues.forEach((s) => console.log(`  ✓ ${s}`));
  console.log(
    `Partner prospects (internal BD overlay): ${results.prospectsOverlay.length}`,
  );
  results.prospectsOverlay.forEach((s) => console.log(`  ★ ${s}`));
  if (results.failed.length > 0) {
    console.log(`\nFailed: ${results.failed.length}`);
    results.failed.forEach((f) => console.log(`  ✗ ${f.slug}: ${f.error}`));
  }
  console.log(`\n${DRY_RUN ? "Dry run complete." : "Ingestion complete."}`);
  if (results.failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
