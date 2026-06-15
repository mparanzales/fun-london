// Photo mirroring — removes the Google Places API key from public venue
// photo URLs by downloading the photo at ingest time and re-hosting it on
// Supabase Storage (a keyless public URL).
//
// SAFETY / INVARIANT: a keyed `places.googleapis.com` URL must NEVER be
// written to venues.img_url — it would re-expose the Places API key to every
// browser (the bug that kept regressing). The keyed media URL is built and
// used ONLY inside this module, server-side, to fetch the photo bytes. Callers
// must go through `resolveVenuePhoto()` (ingest/discover) or self-heal via
// `mirrorPhotoToStorage()` (refresh); on any failure they fall back to the
// keyless `FALLBACK_IMG_URL`, never to a keyed URL. Mirroring is FLAG-GATED on
// FL_PHOTO_BUCKET — when it is unset, callers get the keyless fallback (not a
// keyed URL), so a missing bucket degrades to a placeholder, never a leak.
//
// To enable photo mirroring:
//   1. Supabase dashboard → Storage → New bucket → name "venue-photos",
//      make it PUBLIC.
//   2. Add FL_PHOTO_BUCKET=venue-photos to .env.local AND to the GitHub
//      Actions secrets used by the ingest/discover/maintenance workflows.
//   3. Run `pnpm ingest` (and let the discovery/refresh crons run) to rewrite
//      img_url on every venue to the keyless Storage URL.
//   4. Rotate the previous Google Cloud key and apply an API/referrer
//      restriction + daily quota cap.

import type { SupabaseClient } from "@supabase/supabase-js";

// Read the bucket LAZILY (not at module load). Scripts call dotenv.config()
// AFTER their imports, and ES modules evaluate imported modules first — so a
// module-level `process.env.FL_PHOTO_BUCKET` read here saw it empty and made the
// backfill scripts wrongly report "FL_PHOTO_BUCKET not set". Reading it on each
// call fixes that.
function photoBucket(): string {
  return process.env.FL_PHOTO_BUCKET ?? "";
}

// Sentinel for "no real photo" — EMPTY, never a stock image. A venue without
// its OWN photo is then hidden by the read-side `img_url <> ''` filter rather
// than shown on a generic picture. (Was an Unsplash URL; purged so we never
// display an image that isn't the real place.)
export const FALLBACK_IMG_URL = "";

export function photoStorageEnabled(): boolean {
  return photoBucket().length > 0;
}

// True if a URL points at Google's Places media endpoint, which embeds the API
// key as a query param. Such URLs are safe to FETCH server-side but must NEVER
// be stored in venues.img_url. Used to detect and self-heal stale keyed rows.
export function isKeyedPhotoUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && url.includes("places.googleapis.com");
}

const MIRROR_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Run a mirror operation with a few retries on transient failure (network
// blips, Google 5xx/429, Storage upload errors). Returns null only after every
// attempt fails — so a momentary hiccup never makes a caller persist a keyed
// fallback, which was the root cause of keyed URLs creeping back in.
async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MIRROR_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt < MIRROR_ATTEMPTS) await sleep(400 * attempt);
    }
  }
  console.error(
    `  [photo] ${label}: gave up after ${MIRROR_ATTEMPTS} attempts — ${(lastErr as Error).message}`,
  );
  return null;
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
  return withRetry(`mirror ${slug}`, async () => {
    const res = await fetch(googleMediaUrl(photoName));
    if (!res.ok) throw new Error(`fetch HTTP ${res.status}`);
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    const ext = contentType.includes("png") ? "png" : "jpg";
    const buffer = Buffer.from(await res.arrayBuffer());
    const path = `${slug}.${ext}`;

    const { error } = await supabase.storage
      .from(photoBucket())
      .upload(path, buffer, { contentType, upsert: true });
    if (error) throw new Error(`upload: ${error.message}`);

    const { data } = supabase.storage.from(photoBucket()).getPublicUrl(path);
    if (!data?.publicUrl) throw new Error("no public URL returned");
    return data.publicUrl;
  });
}

// The single safe way to turn a Google photo NAME into a URL for the DB.
// Mirrors to keyless Storage; on any failure (or when mirroring is disabled)
// returns the keyless stock fallback. GUARANTEE: never returns a keyed URL, so
// ingest/discover can use it unconditionally without re-introducing the key.
export async function resolveVenuePhoto(
  photoName: string | null | undefined,
  slug: string,
  supabase: SupabaseClient,
): Promise<string> {
  if (!photoName) return FALLBACK_IMG_URL;
  const mirrored = await mirrorPhotoToStorage(photoName, slug, supabase);
  return mirrored ?? FALLBACK_IMG_URL;
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
      .from(photoBucket())
      .upload(path, buffer, { contentType, upsert: true });
    if (error) {
      console.error(`  [photo] upload ${key}: ${error.message}`);
      return null;
    }
    const { data } = supabase.storage.from(photoBucket()).getPublicUrl(path);
    return data?.publicUrl ?? null;
  } catch (e) {
    console.error(`  [photo] mirror ${key}: ${(e as Error).message}`);
    return null;
  }
}
