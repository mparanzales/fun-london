// Shared review-embedding core for public.venue_embeddings, used by:
//   scripts/embed-reviews.ts       (catalogue backfill, --stale, --missing-only)
//   scripts/ingest-from-pending.ts (approve-time embedding of fresh venues)
//
// The model is Xenova/all-MiniLM-L6-v2 running LOCALLY on CPU via
// @huggingface/transformers: no API, no vendor, no quota, ~$0. Each review is
// embedded separately (the model truncates at 256 tokens, so concatenating
// five reviews would drop most of them), then the per-review unit vectors are
// mean-pooled and re-normalised into one unit 384-d venue vector.
//
// Every writer of venue_embeddings goes through buildEmbeddingRow /
// embedAndUpsertVenue so the row shape stays in parity across paths
// (the venue-creation-paths-parity rule: fix all writers, not one).

import { pipeline } from "@huggingface/transformers";
import type { SupabaseClient } from "@supabase/supabase-js";

export const EMBED_MODEL = "Xenova/all-MiniLM-L6-v2";
export const EMBED_DIM = 384;

// Anything with an optional text field counts as a review (VenueReview and
// the raw stored JSON both satisfy this).
export type ReviewLike = { text?: string };

// Minimal structural type so we don't couple to @huggingface's exported
// generics.
type Extractor = (
  texts: string[],
  opts: { pooling: "mean"; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

let _extractor: Extractor | null = null;
async function getExtractor(): Promise<Extractor> {
  if (!_extractor) {
    _extractor = (await pipeline(
      "feature-extraction",
      EMBED_MODEL,
    )) as unknown as Extractor;
  }
  return _extractor;
}

// Usable review texts: trimmed, non-empty strings only.
export function reviewTexts(reviews: ReviewLike[] | null | undefined): string[] {
  if (!Array.isArray(reviews)) return [];
  return reviews
    .map((r) => (typeof r?.text === "string" ? r.text.trim() : ""))
    .filter((t) => t.length > 0);
}

// Mean-pool unit vectors and re-normalise to a unit vector.
export function meanPoolUnit(vectors: number[][]): number[] {
  const out = new Array<number>(EMBED_DIM).fill(0);
  for (const v of vectors) for (let i = 0; i < EMBED_DIM; i++) out[i] += v[i];
  let mag = 0;
  for (let i = 0; i < EMBED_DIM; i++) {
    out[i] /= vectors.length;
    mag += out[i] * out[i];
  }
  mag = Math.sqrt(mag) || 1;
  for (let i = 0; i < EMBED_DIM; i++) out[i] /= mag;
  return out;
}

// Embed a venue's review texts into one unit 384-d vector (null if no usable
// text). Loads the model lazily on first call (downloads once, then cached).
export async function embedReviews(texts: string[]): Promise<number[] | null> {
  if (texts.length === 0) return null;
  const extractor = await getExtractor();
  const out = await extractor(texts, { pooling: "mean", normalize: true });
  const perReview = out.tolist(); // [n, 384] unit vectors
  if (!perReview.length || perReview[0].length !== EMBED_DIM) {
    throw new Error(
      `unexpected embedding shape ${perReview.length}x${perReview[0]?.length}`,
    );
  }
  return meanPoolUnit(perReview);
}

// pgvector literal for PostgREST writes.
export const toVectorLiteral = (v: number[]): string =>
  `[${v.map((x) => x.toFixed(6)).join(",")}]`;

// The one venue_embeddings row shape, shared by every writer.
export function buildEmbeddingRow(
  venueId: string,
  vec: number[],
  sourceReviewsCount: number,
  reviewsSyncedAt: string | null,
): Record<string, unknown> {
  if (vec.length !== EMBED_DIM) {
    throw new Error(`embedding has dim ${vec.length}, expected ${EMBED_DIM}`);
  }
  return {
    venue_id: venueId,
    review_embedding: toVectorLiteral(vec),
    model: EMBED_MODEL,
    source_reviews_count: sourceReviewsCount,
    reviews_synced_at: reviewsSyncedAt,
    // Per-row timestamp (not per-run) is deliberate: it records when THIS
    // venue's vector was built, which is what staleness checks care about.
    updated_at: new Date().toISOString(),
  };
}

// Embed ONE venue's reviews and upsert its venue_embeddings row.
// Returns "no_reviews" (nothing to embed, nothing written) or "embedded".
// Throws on model or write failure; the caller decides whether one venue's
// failure aborts the run (backfill: yes, approve-time ingest: no).
export async function embedAndUpsertVenue(
  supabase: SupabaseClient,
  venue: {
    id: string;
    reviews: ReviewLike[] | null;
    reviews_synced_at: string | null;
  },
): Promise<{ status: "embedded"; reviewCount: number } | { status: "no_reviews" }> {
  const texts = reviewTexts(venue.reviews);
  const vec = await embedReviews(texts);
  if (!vec) return { status: "no_reviews" };
  const row = buildEmbeddingRow(venue.id, vec, texts.length, venue.reviews_synced_at);
  const { error } = await supabase
    .from("venue_embeddings")
    .upsert(row, { onConflict: "venue_id" });
  if (error) throw new Error(`venue_embeddings upsert failed: ${error.message}`);
  return { status: "embedded", reviewCount: texts.length };
}
