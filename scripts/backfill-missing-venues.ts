// Backfill the day-one seed venues that never went through Places ingestion:
// rows that are visible but have NO google_place_id (so no reviews/photos), plus
// any visible row whose reviews are missing/empty. For each one:
//   1. Resolve a google_place_id via Text Search (name + area), guarded by a
//      name-match check so we never attach a WRONG place to a venue.
//   2. Pull full Place Details + reviews (verbatim) in one call.
//   3. Mirror photos to keyless Supabase Storage (same invariant as ingest).
//   4. UPDATE the SAME row in place — never insert (that's what created the
//      duplicate seed/twin pairs in the first place).
//
//   pnpm backfill-missing-venues:dry   # resolve place_ids + name-match only, no details/write
//   pnpm backfill-missing-venues       # resolve + fetch + mirror + write (SPENDS Places)
//
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import {
  resolveVenuePhotos,
  photoStorageEnabled,
} from "./photo-storage";
import {
  normalizeOpeningHours,
  type GoogleOpeningHours,
} from "@/lib/opening-hours";
import type { VenueReview } from "@/lib/types";

const DRY_RUN = process.argv.includes("--dry-run");
const PLACES_BASE = "https://places.googleapis.com/v1/places";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PLACES_KEY = process.env.GOOGLE_PLACES_API_KEY;
if (!SUPABASE_URL || !SERVICE) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!PLACES_KEY) {
  console.error("Missing GOOGLE_PLACES_API_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE, {
  auth: { persistSession: false },
});

type VenueRow = {
  id: string;
  slug: string;
  name: string;
  neighbourhood: string | null;
  google_place_id: string | null;
};

type GoogleReview = {
  rating?: number;
  text?: { text?: string };
  authorAttribution?: { displayName?: string; photoUri?: string };
  publishTime?: string;
  relativePublishTimeDescription?: string;
};

type PlaceDetails = {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  rating?: number;
  userRatingCount?: number;
  photos?: { name?: string }[];
  websiteUri?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  businessStatus?: string;
  regularOpeningHours?: GoogleOpeningHours;
  reviews?: GoogleReview[];
};

// Reviews stored VERBATIM (Google display policy + provenance-honesty rule).
function mapReviews(g: GoogleReview[] | undefined): VenueReview[] {
  return (g ?? [])
    .map((r) => ({
      author: r.authorAttribution?.displayName ?? "Google user",
      rating: r.rating ?? 0,
      text: r.text?.text ?? "",
      relativeTime: r.relativePublishTimeDescription ?? "",
      publishTime: r.publishTime,
      authorPhotoUrl: r.authorAttribution?.photoUri,
    }))
    .filter((r) => r.text.trim().length > 0);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Loose name match: the resolved place's name should share the venue's core
// name (handles "Bao" ⊂ "Bao Soho", trailing branch words, punctuation, etc.).
function nameMatches(venueName: string, placeName: string | undefined): boolean {
  if (!placeName) return false;
  const a = norm(venueName);
  const b = norm(placeName);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  // first significant token in common (e.g. "spiritland")
  const first = a.split(" ")[0];
  return first.length >= 4 && b.includes(first);
}

async function searchPlace(
  query: string,
): Promise<{ id: string; name?: string } | null> {
  const res = await fetch(`${PLACES_BASE}:searchText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": PLACES_KEY!,
      "X-Goog-FieldMask": "places.id,places.displayName",
    },
    body: JSON.stringify({ textQuery: query, regionCode: "GB" }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    places?: { id: string; displayName?: { text?: string } }[];
  };
  const p = json.places?.[0];
  return p ? { id: p.id, name: p.displayName?.text } : null;
}

async function placeDetails(placeId: string): Promise<PlaceDetails> {
  const fieldMask = [
    "id", "displayName", "formattedAddress", "location", "rating",
    "userRatingCount", "photos", "websiteUri", "nationalPhoneNumber",
    "internationalPhoneNumber", "businessStatus", "regularOpeningHours",
    "reviews",
  ].join(",");
  const res = await fetch(`${PLACES_BASE}/${placeId}`, {
    headers: { "X-Goog-Api-Key": PLACES_KEY!, "X-Goog-FieldMask": fieldMask },
  });
  if (!res.ok) throw new Error(`details HTTP ${res.status}: ${await res.text()}`);
  return (await res.json()) as PlaceDetails;
}

async function main() {
  console.log(`backfill-missing-venues · ${DRY_RUN ? "DRY-RUN" : "WRITE"}`);
  if (!DRY_RUN && !photoStorageEnabled()) {
    console.log("note: FL_PHOTO_BUCKET unset → place_id + reviews + hours only, no photos.\n");
  } else {
    console.log("");
  }

  // Targets: (a) visible venues with NO place_id (the day-one stubs), plus
  // (b) an explicit re-check list — venues that HAVE a place_id but came back
  // with empty reviews (e.g. markets), to confirm whether Google now has any.
  const RECHECK_SLUGS = ["exmouth-market"];
  const cols = "id, slug, name, neighbourhood, google_place_id";
  const [stubsRes, recheckRes] = await Promise.all([
    supabase.from("venues").select(cols).is("hidden_at", null).is("google_place_id", null),
    supabase.from("venues").select(cols).is("hidden_at", null).in("slug", RECHECK_SLUGS),
  ]);
  if (stubsRes.error || recheckRes.error) {
    console.error(`read failed: ${(stubsRes.error ?? recheckRes.error)?.message}`);
    process.exit(1);
  }
  const targets = [...(stubsRes.data ?? []), ...(recheckRes.data ?? [])] as VenueRow[];

  console.log(`${targets.length} venue(s) to backfill:\n`);

  let ok = 0;
  let skipped = 0;
  let failed = 0;
  for (const v of targets) {
    const area = v.neighbourhood ?? "London";
    try {
      // 1. Resolve place_id (or reuse the one already there).
      let placeId = v.google_place_id;
      if (!placeId) {
        const hit = await searchPlace(`${v.name}, ${area}, London`);
        if (!hit) {
          console.log(`  ⊘ ${v.slug}: no Places match — skipped`);
          skipped++;
          continue;
        }
        if (!nameMatches(v.name, hit.name)) {
          console.log(`  ⊘ ${v.slug}: best match "${hit.name}" ≠ "${v.name}" — skipped (won't attach a wrong place)`);
          skipped++;
          continue;
        }
        placeId = hit.id;
        console.log(`  • ${v.slug}: matched "${hit.name}" → ${placeId}`);
      }

      if (DRY_RUN) {
        console.log(`    [dry] would fetch details + reviews + photos for ${v.slug}`);
        ok++;
        continue;
      }

      // 2. Full details + reviews.
      const d = await placeDetails(placeId);
      const reviews = mapReviews(d.reviews);
      const hours = normalizeOpeningHours(d.regularOpeningHours);

      // 3. Photos → keyless Storage (hero = photo_urls[0]).
      const photoUrls = await resolveVenuePhotos(d.photos, v.slug, supabase);

      // 4. Build the in-place update (only set fields Google returned).
      const nowIso = new Date().toISOString();
      const update: Record<string, unknown> = {
        google_place_id: placeId,
        reviews,
        reviews_synced_at: nowIso,
        last_synced_at: nowIso,
      };
      if (d.rating != null) update.rating = d.rating;
      if (d.userRatingCount != null) update.review_count = d.userRatingCount;
      if (d.formattedAddress) update.address = d.formattedAddress;
      if (d.location?.latitude != null) update.lat = d.location.latitude;
      if (d.location?.longitude != null) update.lng = d.location.longitude;
      if (d.nationalPhoneNumber ?? d.internationalPhoneNumber)
        update.phone = d.nationalPhoneNumber ?? d.internationalPhoneNumber;
      if (d.websiteUri) update.website_url = d.websiteUri;
      if (hours) update.opening_hours = hours;
      if (photoUrls.length > 0) {
        update.img_url = photoUrls[0];
        update.photo_urls = photoUrls;
      }

      const { error: upErr } = await supabase.from("venues").update(update).eq("id", v.id);
      if (upErr) {
        console.log(`  ✗ ${v.slug}: update failed — ${upErr.message}`);
        failed++;
        continue;
      }
      console.log(`  ✓ ${v.slug}: ${reviews.length} reviews, ${photoUrls.length} photos${hours ? ", hours" : ""}`);
      ok++;
    } catch (e) {
      console.log(`  ✗ ${v.slug}: ${(e as Error).message}`);
      failed++;
    }
  }

  console.log(`\n${DRY_RUN ? "[dry] " : ""}done — ${ok} backfilled, ${skipped} skipped, ${failed} failed (of ${targets.length}).`);
}

main().catch((e) => {
  console.error("\nFATAL:", e);
  process.exit(1);
});
