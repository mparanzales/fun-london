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

// Generic variant: download an arbitrary public image URL (e.g. a pop-up's
// og:image from its official page) and re-host it on Supabase Storage,
// returning a keyless public URL. Same bucket + flag gate. Returns null if
// disabled, not an image, or it fails — callers fall back to a stock image.
export async function mirrorImageUrlToStorage(
  imageUrl: string,
  key: string,
  supabase: SupabaseClient,
): Promise<string | null> {
  if (!photoStorageEnabled()) return null;
  try {
    const res = await fetch(imageUrl, { redirect: "follow" });
    if (!res.ok) return null;
    const headerType = res.headers.get("content-type") ?? "";
    const b = Buffer.from(await res.arrayBuffer());
    // Some CDNs mislabel images as application/octet-stream, so don't trust the
    // header alone — sniff the file's magic bytes.
    const isJpg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    const isPng =
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
    const isGif = b.subarray(0, 3).toString("ascii") === "GIF";
    const isWebp =
      b.subarray(0, 4).toString("ascii") === "RIFF" &&
      b.subarray(8, 12).toString("ascii") === "WEBP";
    if (
      !headerType.startsWith("image/") &&
      !(isJpg || isPng || isGif || isWebp)
    )
      return null;
    const ext =
      isPng || headerType.includes("png")
        ? "png"
        : isWebp || headerType.includes("webp")
          ? "webp"
          : isGif || headerType.includes("gif")
            ? "gif"
            : "jpg";
    const contentType = headerType.startsWith("image/")
      ? headerType
      : `image/${ext === "jpg" ? "jpeg" : ext}`;
    const buffer = b;
    const path = `${key}.${ext}`;
    const { error } = await supabase.storage
      .from(PHOTO_BUCKET)
      .upload(path, buffer, { contentType, upsert: true });
    if (error) {
      console.error(`  [photo] upload ${key}: ${error.message}`);
      return null;
    }
    const { data } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path);
    return data?.publicUrl ?? null;
  } catch (e) {
    console.error(`  [photo] mirror ${key}: ${(e as Error).message}`);
    return null;
  }
}
