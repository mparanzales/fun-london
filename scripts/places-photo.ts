// Resolve a venue (by name + area) to a REAL Google Places photo, mirrored to
// keyless Supabase Storage. Shared by the events cleanup (fix-events.ts) and the
// pop-up ingestion (discover-popups.ts) so both source images the SAME way:
// the venue's actual photo, never a brand logo or stock image.
//
// INVARIANT (same as photo-storage.ts): the keyed places.googleapis.com URL is
// used server-side ONLY to fetch bytes; the DB only ever gets the keyless
// `<key>.jpg` Storage URL. Returns null when no place/photo is found or
// mirroring is disabled — callers then leave img_url empty, which the read-side
// `img_url <> ''` filter hides (never a wrong/stock photo).

import type { SupabaseClient } from "@supabase/supabase-js";
import { mirrorPhotoToStorage, photoStorageEnabled } from "./photo-storage";

const PLACES_BASE = "https://places.googleapis.com/v1/places";

async function placeIdForVenue(
  query: string,
  apiKey: string,
): Promise<string | null> {
  const res = await fetch(`${PLACES_BASE}:searchText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.id,places.displayName",
    },
    body: JSON.stringify({ textQuery: query, regionCode: "GB" }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { places?: { id: string }[] };
  return json.places?.[0]?.id ?? null;
}

async function firstPhotoName(
  placeId: string,
  apiKey: string,
): Promise<string | null> {
  const res = await fetch(`${PLACES_BASE}/${placeId}`, {
    headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "photos" },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { photos?: { name: string }[] };
  return json.photos?.[0]?.name ?? null;
}

/**
 * Resolve `venueName` (+ `area`) to a real Places photo, mirrored to keyless
 * Storage under `storageKey`. Returns the keyless public URL, or null if no
 * place/photo found or photo mirroring is disabled.
 */
export async function realVenuePhoto(
  venueName: string,
  area: string,
  storageKey: string,
  supabase: SupabaseClient,
): Promise<string | null> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey || !photoStorageEnabled()) return null;
  try {
    const placeId = await placeIdForVenue(
      `${venueName}, ${area}, London`,
      apiKey,
    );
    if (!placeId) return null;
    const photoName = await firstPhotoName(placeId, apiKey);
    if (!photoName) return null;
    return await mirrorPhotoToStorage(photoName, storageKey, supabase);
  } catch {
    return null;
  }
}
