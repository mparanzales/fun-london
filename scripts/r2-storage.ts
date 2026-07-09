// ─────────────────────────────────────────────────────────────────────────
// Cloudflare R2 photo backend (S3-compatible) — replaces Supabase Storage.
//
// WHY: Supabase Storage hit 708% of its 1 GB free tier (7 GB of venue photos).
// R2's free tier is 10 GB + ZERO egress, and it sits on Cloudflare's London
// edge, so photos are both £0 and faster. This module is SCRIPT/SERVER-ONLY —
// it pulls in @aws-sdk/client-s3 + sharp, which must NEVER enter the app/client
// bundle (the runtime only ever builds URL strings, in lib/img.ts).
//
// Env (GitHub Actions secrets + local .env.local):
//   R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT
// Non-secret, hardcoded below: bucket + public base (img.funldn.com).
// ─────────────────────────────────────────────────────────────────────────

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";

export const R2_BUCKET = process.env.R2_BUCKET || "fun-london-photos";
// The public custom domain bound to the bucket. Non-secret. Overridable so a
// throwaway test bucket can point elsewhere without a code change.
export const R2_PUBLIC_BASE = (
  process.env.R2_PUBLIC_BASE || "https://img.funldn.com"
).replace(/\/+$/, "");

// Card + detail target widths. Detail covers the venue hero / gallery viewer;
// card covers the 2-col feed grid. `withoutEnlargement` means a small source is
// never upscaled (no fake resolution, no wasted bytes).
export const R2_DETAIL_WIDTH = 1280;
export const R2_CARD_WIDTH = 512;
const DETAIL_QUALITY = 80;
const CARD_QUALITY = 72;

let client: S3Client | null = null;

// True only when all three R2 secrets are present. Scripts check this and fail
// loud rather than half-migrate; the write path falls back to Supabase when
// unset so local dev without R2 keys still works.
export function r2Configured(): boolean {
  return Boolean(
    process.env.R2_ACCESS_KEY_ID?.trim() &&
      process.env.R2_SECRET_ACCESS_KEY?.trim() &&
      process.env.R2_ENDPOINT?.trim(),
  );
}

function r2(): S3Client {
  if (client) return client;
  if (!r2Configured()) {
    throw new Error(
      "R2 not configured — set R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT",
    );
  }
  client = new S3Client({
    region: "auto", // R2 ignores region but the SDK requires the field.
    endpoint: process.env.R2_ENDPOINT!.trim(),
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!.trim(),
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!.trim(),
    },
  });
  return client;
}

// Strip the extension from a storage key: "padella-1.jpg" -> "padella-1".
export function stemOf(key: string): string {
  return key.replace(/\.(jpe?g|png|webp|gif)$/i, "");
}

// True for the B&W static-map objects ("${slug}-map.png"). Maps render at a
// single fixed size, so they get ONE variant, not a card + detail pair.
export function isMapKey(key: string): boolean {
  return /-map$/.test(stemOf(key));
}

// The R2 object keys a source photo maps to. Detail always; card unless it's a
// map. All .webp.
export function variantKeys(sourceKey: string): {
  detail: string;
  card: string | null;
} {
  const stem = stemOf(sourceKey);
  return {
    detail: `${stem}.webp`,
    card: isMapKey(sourceKey) ? null : `${stem}-sm.webp`,
  };
}

// The public URL stored in the DB for a source photo (the DETAIL variant).
// lib/img.ts derives the card URL from this at render time.
export function r2PublicUrl(sourceKey: string): string {
  return `${R2_PUBLIC_BASE}/${variantKeys(sourceKey).detail}`;
}

async function toWebp(
  input: Buffer,
  width: number,
  quality: number,
): Promise<Buffer> {
  // Note: animated GIFs (rare pop-up posters) are intentionally flattened to
  // their first frame — a card feed wants small still images, not animation.
  return sharp(input)
    .rotate() // respect EXIF orientation before stripping metadata
    .resize({ width, withoutEnlargement: true })
    .webp({ quality })
    .toBuffer();
}

async function put(key: string, body: Buffer): Promise<void> {
  await r2().send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: "image/webp",
      // Immutable content-addressed-ish keys → cache hard at the edge + browser.
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
}

// Encode `input` to the right WebP variant(s) for `sourceKey` and upload them to
// R2. Returns the public DETAIL url to store in the DB (+ the byte sizes for
// logging/verification). Idempotent: re-running overwrites the same keys.
export async function uploadPhotoToR2(
  sourceKey: string,
  input: Buffer,
): Promise<{ url: string; detailBytes: number; cardBytes: number | null }> {
  const { detail, card } = variantKeys(sourceKey);
  const detailBuf = await toWebp(input, R2_DETAIL_WIDTH, DETAIL_QUALITY);
  await put(detail, detailBuf);
  let cardBytes: number | null = null;
  if (card) {
    const cardBuf = await toWebp(input, R2_CARD_WIDTH, CARD_QUALITY);
    await put(card, cardBuf);
    cardBytes = cardBuf.length;
  }
  return {
    url: `${R2_PUBLIC_BASE}/${detail}`,
    detailBytes: detailBuf.length,
    cardBytes,
  };
}
