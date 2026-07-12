// Shared Google Places reviews fetcher + mapper, used by:
//   scripts/refresh-reviews.ts     (nightly rotating batch)
//   scripts/ingest-from-pending.ts (approve-time fetch before embedding)
// One mapper for every writer of venues.reviews (the venue-creation-paths
// parity rule: writers of the same shape share code so they cannot drift).
//
// Reviews are stored VERBATIM, never synthesized, translated, summarized, or
// reordered (Google display policy + the project's provenance-honesty rule).
// Rating-only reviews (no text) are dropped.

import type { VenueReview } from "@/lib/types";

// Google Places Details review shape (the fields we keep).
export type GoogleReview = {
  rating?: number;
  text?: { text?: string };
  authorAttribution?: { displayName?: string; photoUri?: string };
  publishTime?: string;
  relativePublishTimeDescription?: string;
};

export function mapGoogleReviews(g: GoogleReview[] | undefined): VenueReview[] {
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

// Place Details for just the `reviews` field (server-side; key in the header).
// This is the expensive Atmosphere SKU, so callers request it deliberately and
// sparingly (a bounded nightly batch, or one call per human-approved publish).
// The error message is kept verbatim from refresh-reviews.ts: its quota
// handling greps the message for the HTTP status (429), so the status number
// must stay in the text.
export async function fetchPlaceReviews(
  placeId: string,
  apiKey: string,
): Promise<GoogleReview[]> {
  const res = await fetch(
    `https://places.googleapis.com/v1/places/${placeId}`,
    {
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "reviews",
      },
    },
  );
  if (!res.ok) throw new Error(`placeDetails HTTP ${res.status}`);
  const json = (await res.json()) as { reviews?: GoogleReview[] };
  return json.reviews ?? [];
}
