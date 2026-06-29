import { describe, it, expect } from "vitest";
import {
  tagsToWeightedVector,
  cosineSimilarity,
  TAG_INDEX,
  TAG_COUNT,
  ALL_TAGS,
} from "../tag-vocabulary";

// Deterministic IDF for the assertions (independent of the generated TAG_IDF,
// which changes with the catalogue). Mirrors the real shape: distinctive tags
// high, boilerplate low.
const IDF = {
  casual: 0.35,
  "good-for-groups": 0.9,
  omakase: 5.1,
  sushi: 4.0,
  japanese: 5.0,
} as const;

describe("tag-vocabulary · IDF-weighted vectors (Stage 1.1)", () => {
  it("dedupes tags that live in two categories (no dead vector slots)", () => {
    // "coffee" and "date-night" each appear in two source arrays.
    expect(TAG_COUNT).toBe(new Set(ALL_TAGS).size);
    expect(TAG_COUNT).toBeLessThan(ALL_TAGS.length);
    expect(TAG_INDEX["coffee"]).toBeTypeOf("number");
    expect(TAG_INDEX["date-night"]).toBeTypeOf("number");
  });

  it("weights a distinctive tag far above boilerplate", () => {
    const v = tagsToWeightedVector(["casual", "omakase"], IDF);
    expect(v[TAG_INDEX["omakase"]]).toBeGreaterThan(v[TAG_INDEX["casual"]]);
  });

  it("produces a unit-norm vector", () => {
    const v = tagsToWeightedVector(["sushi", "japanese"], IDF);
    const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(mag).toBeCloseTo(1, 5);
  });

  it("makes a venue more similar to one sharing its RARE tag than its common tag", () => {
    const a = tagsToWeightedVector(["omakase", "casual"], IDF);
    const sharesRare = tagsToWeightedVector(["omakase", "sushi"], IDF);
    const sharesCommon = tagsToWeightedVector(
      ["casual", "good-for-groups"],
      IDF,
    );
    expect(cosineSimilarity(a, sharesRare)).toBeGreaterThan(
      cosineSimilarity(a, sharesCommon),
    );
  });

  it("ignores unknown tags and returns a zero vector for none", () => {
    const v = tagsToWeightedVector([], IDF);
    expect(v).toHaveLength(TAG_COUNT);
    expect(v.every((x) => x === 0)).toBe(true);
  });
});
