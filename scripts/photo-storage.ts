// Photo mirroring — removes the Google Places API key from public venue
// photo URLs by downloading the photo at ingest time and re-hosting it on
// Supabase Storage (a keyless public URL).
//
// SAFETY: this is FLAG-GATED. It only activates when FL_PHOTO_BUCKET is set
// (the name of a public Storage bucket). Until then every caller falls back to
// the existing keyed Google URL, so the live ingestion crons behave exactly as
// before — zero risk from merging this.
//
// THE MAINTAINER — to switch it on (closes the exposed-key security issue for good):
//   1. Supabase dashboard → Storage → New bucket → name "venue-photos",
//      make it PUBLIC.
//   2. Add FL_PHOTO_BUCKET=venue-photos to .env.local AND to the GitHub
//      Actions secrets used by the ingest/discover/maintenance workflows.
//   3. Run `pnpm ingest` (and let the discovery/refresh crons run) to rewrite
//      img_url on every venue to the keyless Storage URL.
//   4. Once `curl https://www.funldn.com/explore | grep AIza` returns nothing,
//      ROTATE the old key in Google Cloud and apply an API restriction +
//      daily quota cap.

import type { SupabaseClient } from "@supabase/supabase-js";

export const PHOTO_BUCKET = process.env.FL_PHOTO_BUCKET ?? "";

export function photoStorageEnabled(): boolean {
  return PHOTO_BUCKET.length > 0;
}

// Build the (key-bearing) Google CDN URL used to FETCH the photo bytes.
// This URL is used server-side only — it never reaches a browser when the
// mirror succeeds.
function googleMediaUrl(photoName: string, maxWidth = 1600): string {
  const key = process.env.GOOGLE_PLACES_API_KEY ?? "";
  return `https://places.googleapis.com/v1/${photoName}/media?key=${key}&maxWidthPx=${maxWidth}`;
}

// Download the Google photo and upload it to Supabase Storage, returning a
// keyless public URL. Returns null if mirroring is disabled or fails — the
// caller then falls back to the keyed URL, so a Storage hiccup never breaks
// ingestion.
export async function mirrorPhotoToStorage(
  photoName: string,
  slug: string,
  supabase: SupabaseClient,
): Promise<string | null> {
  if (!photoStorageEnabled()) return null;
  try {
    const res = await fetch(googleMediaUrl(photoName));
    if (!res.ok) {
      console.error(`  [photo] fetch ${slug}: HTTP ${res.status}`);
      return null;
    }
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    const ext = contentType.includes("png") ? "png" : "jpg";
    const buffer = Buffer.from(await res.arrayBuffer());
    const path = `${slug}.${ext}`;

    const { error } = await supabase.storage
      .from(PHOTO_BUCKET)
      .upload(path, buffer, { contentType, upsert: true });
    if (error) {
      console.error(`  [photo] upload ${slug}: ${error.message}`);
      return null;
    }
    const { data } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path);
    return data?.publicUrl ?? null;
  } catch (e) {
    console.error(`  [photo] mirror ${slug}: ${(e as Error).message}`);
    return null;
  }
}
