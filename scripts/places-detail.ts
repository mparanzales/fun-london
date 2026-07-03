// Resolve an event's venue (by name + area) to the FULL Google Places detail we
// need to give an event page venue-level richness: rating, address, hours,
// website, phone, map, reviews, and Google's own factual editorial blurb.
//
// Deterministic + real: facts come from Places, never from an LLM (see the
// Gemini policy). The event's photo is still handled separately by
// places-photo.ts (mirrored to keyless Storage); this only adds the text/data.
//
// The normalized `openingHours` matches lib/opening-hours' OpeningHours shape so
// the event page can reuse getOpenState()/formatOpeningLine() unchanged.

const PLACES_BASE = "https://places.googleapis.com/v1/places";

const DETAIL_FIELDS = [
  "id",
  "displayName",
  "primaryTypeDisplayName",
  "rating",
  "userRatingCount",
  "formattedAddress",
  "location",
  "regularOpeningHours",
  "websiteUri",
  "nationalPhoneNumber",
  "googleMapsUri",
  "editorialSummary",
  "reviews",
].join(",");

export type EventPlaceReview = {
  author: string | null;
  rating: number | null;
  text: string | null;
  publishedAt: string | null;
  uri: string | null;
};

export type EventPlace = {
  placeId: string;
  matchedName: string | null;
  primaryType: string | null;
  rating: number | null;
  ratingCount: number | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  // Shaped like lib/opening-hours' OpeningHours (periods + weekdayDescriptions).
  openingHours: {
    periods: {
      open: { day: number; hour: number; minute: number };
      close: { day: number; hour: number; minute: number } | null;
    }[];
    weekdayDescriptions: string[];
  } | null;
  website: string | null;
  phone: string | null;
  mapsUrl: string | null;
  // Our mirrored keyless static-map thumbnail (matches the venue page). The
  // resolver leaves this null; the backfill fills it via mirrorMapToStorage.
  mapUrl: string | null;
  editorial: string | null;
  reviews: EventPlaceReview[];
};

async function searchPlaceId(
  query: string,
  apiKey: string,
): Promise<string | null> {
  const res = await fetch(`${PLACES_BASE}:searchText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.id",
    },
    body: JSON.stringify({ textQuery: query, regionCode: "GB" }),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { places?: { id: string }[] };
  return j.places?.[0]?.id ?? null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function normalizeHours(roh: any): EventPlace["openingHours"] {
  if (!roh) return null;
  const periods = (roh.periods ?? [])
    .filter((p: any) => p?.open)
    .map((p: any) => ({
      open: {
        day: p.open.day ?? 0,
        hour: p.open.hour ?? 0,
        minute: p.open.minute ?? 0,
      },
      close: p.close
        ? {
            day: p.close.day ?? 0,
            hour: p.close.hour ?? 0,
            minute: p.close.minute ?? 0,
          }
        : null,
    }));
  return { periods, weekdayDescriptions: roh.weekdayDescriptions ?? [] };
}

function normalizeReviews(reviews: any): EventPlaceReview[] {
  if (!Array.isArray(reviews)) return [];
  return reviews.slice(0, 5).map((r: any) => ({
    author: r.authorAttribution?.displayName ?? null,
    rating: typeof r.rating === "number" ? r.rating : null,
    text: r.text?.text ?? r.originalText?.text ?? null,
    publishedAt: r.publishTime ?? null,
    uri: r.googleMapsUri ?? null,
  }));
}

/** Resolve `venueName` (+ `area`) to the full Places detail, or null. */
export async function resolveEventPlace(
  venueName: string,
  area: string,
  apiKey: string,
): Promise<EventPlace | null> {
  const placeId = await searchPlaceId(`${venueName}, ${area}, London`, apiKey);
  if (!placeId) return null;
  const res = await fetch(`${PLACES_BASE}/${placeId}`, {
    headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": DETAIL_FIELDS },
  });
  if (!res.ok) return null;
  const d = (await res.json()) as any;
  return {
    placeId: d.id ?? placeId,
    matchedName: d.displayName?.text ?? null,
    primaryType: d.primaryTypeDisplayName?.text ?? null,
    rating: typeof d.rating === "number" ? d.rating : null,
    ratingCount:
      typeof d.userRatingCount === "number" ? d.userRatingCount : null,
    address: d.formattedAddress ?? null,
    lat: d.location?.latitude ?? null,
    lng: d.location?.longitude ?? null,
    openingHours: normalizeHours(d.regularOpeningHours),
    website: d.websiteUri ?? null,
    phone: d.nationalPhoneNumber ?? null,
    mapsUrl: d.googleMapsUri ?? null,
    mapUrl: null, // filled by the backfill (mirrorMapToStorage)
    editorial: d.editorialSummary?.text ?? null,
    reviews: normalizeReviews(d.reviews),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
