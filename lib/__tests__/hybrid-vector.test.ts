import { describe, it, expect } from "vitest";
import { buildHybridVector, HYBRID_DIM, REVIEW_DIM } from "../hybrid-vector";
import {
  TAG_COUNT,
  tagsToWeightedVector,
  cosineSimilarity,
  normalise,
} from "../tag-vocabulary";

// Deterministic unit-norm "review embedding" for the assertions.
function unitReview(seed: number): number[] {
  const v = new Array<number>(REVIEW_DIM).fill(0);
  for (let i = 0; i < REVIEW_DIM; i++) v[i] = Math.sin(seed + i * 0.7);
  return normalise(v);
}

const mag = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));

describe("hybrid-vector (Stage 1.3)", () => {
  it("has dimension TAG_COUNT + 384 and is unit-norm", () => {
    const v = buildHybridVector(["sushi", "omakase"], unitReview(1));
    expect(v).toHaveLength(HYBRID_DIM);
    expect(HYBRID_DIM).toBe(TAG_COUNT + REVIEW_DIM);
    expect(mag(v)).toBeCloseTo(1, 5);
  });

  it("tag-only weights recover the tag vector (review slots zero)", () => {
    const v = buildHybridVector(["sushi"], unitReview(2), {
      tag: 1,
      review: 0,
    });
    const tagPart = v.slice(0, TAG_COUNT);
    const reviewPart = v.slice(TAG_COUNT);
    expect(
      cosineSimilarity(tagPart, tagsToWeightedVector(["sushi"])),
    ).toBeCloseTo(1, 5);
    expect(reviewPart.every((x) => x === 0)).toBe(true);
  });

  it("review-only weights recover the review embedding (tag slots zero)", () => {
    const r = unitReview(3);
    const v = buildHybridVector(["sushi"], r, { tag: 0, review: 1 });
    expect(v.slice(0, TAG_COUNT).every((x) => x === 0)).toBe(true);
    const reviewPart = v.slice(TAG_COUNT);
    for (let i = 0; i < REVIEW_DIM; i++)
      expect(reviewPart[i]).toBeCloseTo(r[i], 5);
  });

  it("degrades gracefully to tags-only when the review embedding is null", () => {
    const v = buildHybridVector(["omakase", "sushi"], null);
    expect(v).toHaveLength(HYBRID_DIM);
    expect(v.some(Number.isNaN)).toBe(false);
    expect(mag(v)).toBeCloseTo(1, 5);
    expect(v.slice(TAG_COUNT).every((x) => x === 0)).toBe(true);
  });

  it("blends: a full match beats either partial match (explicit equal weights)", () => {
    // Use explicit equal weights so this tests the blending MATH, independent of
    // the shipped review-leaning HYBRID_WEIGHTS default.
    const w = { tag: 1, review: 1 };
    const r1 = unitReview(10);
    const r2 = unitReview(11); // a different 'feel'
    const seed = buildHybridVector(["sushi", "omakase"], r1, w);
    const sharesBoth = buildHybridVector(["sushi", "omakase"], r1, w);
    const sharesTagOnly = buildHybridVector(["sushi", "omakase"], r2, w);
    const sharesReviewOnly = buildHybridVector(["pizza", "italian"], r1, w);
    expect(cosineSimilarity(seed, sharesBoth)).toBeCloseTo(1, 5);
    // both partial matches are positive but strictly below a full match
    expect(cosineSimilarity(seed, sharesTagOnly)).toBeGreaterThan(0);
    expect(cosineSimilarity(seed, sharesReviewOnly)).toBeGreaterThan(0);
    expect(cosineSimilarity(seed, sharesTagOnly)).toBeLessThan(0.9999);
    expect(cosineSimilarity(seed, sharesReviewOnly)).toBeLessThan(0.9999);
  });

  it("review-leaning default ranks a shared-review match above a shared-tag match", () => {
    // The calibrated default (tag=0.4, review=1): two venues that READ alike
    // should beat two that merely share tags.
    const r1 = unitReview(20);
    const r2 = unitReview(21);
    const seed = buildHybridVector(["sushi", "omakase"], r1);
    const sharesReviewOnly = buildHybridVector(["pizza", "italian"], r1);
    const sharesTagOnly = buildHybridVector(["sushi", "omakase"], r2);
    expect(cosineSimilarity(seed, sharesReviewOnly)).toBeGreaterThan(
      cosineSimilarity(seed, sharesTagOnly),
    );
  });
});
