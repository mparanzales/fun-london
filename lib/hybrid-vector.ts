// Stage 1.3 — the hybrid venue vector (the served "item vector").
//
// Blends the venue brain's two senses into ONE comparable fingerprint:
//   • the IDF-weighted canonical-TAG vector (Stage 1.1) — "what it is"
//     (cuisine, occasion, vibe), precise but coarse;
//   • the MiniLM REVIEW embedding (Stage 1.2) — "how it feels", rich and
//     semantic.
//
// We concatenate the two unit sub-vectors, each scaled by a weight, then
// L2-normalise the whole. A neat property falls out: the cosine of two hybrid
// vectors equals
//     (wTag²·cosTag + wReview²·cosReview) / (wTag² + wReview²)
// i.e. a weighted average of the tag-cosine and the review-cosine. So one knob
// controls how much "what it is" vs "how it feels" drives similarity — and the
// IDF weighting means boilerplate tags (casual) contribute ~nothing, so adding
// the tag side rarely hurts and sharpens matches where a tag is distinctive.
//
// The user taste vector (Stage 2) is built in this SAME concatenated space (a
// weighted sum of the hybrid vectors of venues a user liked), so cosine between
// a user and a venue is well-defined.

import {
  type Tag,
  TAG_COUNT,
  tagsToWeightedVector,
  normalise,
} from "./tag-vocabulary";

export const REVIEW_DIM = 384;
export const HYBRID_DIM = TAG_COUNT + REVIEW_DIM;

export type HybridWeights = { tag: number; review: number };

// v1 default — REVIEW-LEANING, calibrated on sample neighbours (run
// `pnpm verify-hybrid`). Reviews carry far more signal, and review-to-review
// cosines sit in a high, narrow band (~0.85) while tag cosines spread wider — so
// EQUAL weights let coarse tags DOMINATE the ranking, which wrecked generic-tag
// venues (Bao Soho → "Breakfast Club"; Monmouth Coffee → random cafés). At
// tag=0.4 reviews lead and tags act as a gentle refiner that still suppresses
// tonal false-positives (Artesian stops matching a cheap chain bar; the
// Lighterman surfaces actual waterside pubs). The exact value is the first
// golden-set / Stage-7 bandit tuning knob.
export const HYBRID_WEIGHTS: HybridWeights = { tag: 0.4, review: 1 };

/**
 * Build the hybrid item vector for a venue: [wTag·tagVec | wReview·reviewVec],
 * L2-normalised. `reviewEmbedding` is the stored 384-d unit vector (or null for
 * the handful of venues with no reviews — then the hybrid gracefully degrades
 * to the tag vector alone). Unknown tags are ignored by tagsToWeightedVector.
 */
export function buildHybridVector(
  tags: Tag[],
  reviewEmbedding: number[] | null,
  weights: HybridWeights = HYBRID_WEIGHTS,
): number[] {
  const tagVec = tagsToWeightedVector(tags); // unit-norm (or all-zero if no tags)
  const out = new Array<number>(HYBRID_DIM).fill(0);
  for (let i = 0; i < TAG_COUNT; i++) out[i] = weights.tag * tagVec[i];
  if (reviewEmbedding && reviewEmbedding.length === REVIEW_DIM) {
    for (let i = 0; i < REVIEW_DIM; i++) {
      out[TAG_COUNT + i] = weights.review * reviewEmbedding[i];
    }
  }
  return normalise(out);
}
