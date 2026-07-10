import { describe, it, expect } from "vitest";
import {
  centroidOf,
  centerVector,
  coldStartRelevance,
  mmrRerank,
  rankForTaste,
  type Candidate,
  type RankItem,
} from "../ranker";
import { cosineSimilarity, normalise } from "../tag-vocabulary";

describe("ranker (Stage 3)", () => {
  it("centroidOf is the mean vector", () => {
    expect(
      centroidOf([
        [2, 0],
        [0, 4],
      ]),
    ).toEqual([1, 2]);
    expect(centroidOf([])).toBeInstanceOf(Array);
  });

  it("centering removes the shared baseline so distinctive parts dominate", () => {
    // Two venues with a big COMMON component + tiny distinctive differences:
    // raw cosine ~1 (everything looks alike); centred cosine is far lower.
    const a = normalise([10, 1, 0]);
    const b = normalise([10, 0, 1]);
    const rawCos = cosineSimilarity(a, b);
    const centroid = centroidOf([a, b]);
    const ca = centerVector(a, centroid);
    const cb = centerVector(b, centroid);
    expect(cosineSimilarity(ca, cb)).toBeLessThan(rawCos);
    expect(cosineSimilarity(ca, cb)).toBeLessThan(0); // distinctive parts diverge
  });

  it("coldStartRelevance rewards rating + a curated bump", () => {
    expect(coldStartRelevance(5.0, 1000, false)).toBeGreaterThan(
      coldStartRelevance(4.0, 1000, false),
    );
    expect(coldStartRelevance(3.5, 1000, false)).toBe(0);
    expect(coldStartRelevance(4.0, 1000, true)).toBeGreaterThan(
      coldStartRelevance(4.0, 1000, false),
    );
  });

  it("coldStartRelevance: Bayesian shrink, a 5.0 with few reviews loses to a 4.7 with many", () => {
    expect(coldStartRelevance(4.7, 5000, false)).toBeGreaterThan(
      coldStartRelevance(5.0, 8, false),
    );
  });

  it("MMR diversifies: avoids two near-duplicates when a distinct option exists", () => {
    const x = normalise([1, 0, 0]);
    const xDup = normalise([1, 0.04, 0]); // near-duplicate of x
    const y = normalise([0, 1, 0]); // distinct
    const items: RankItem[] = [
      { id: "x", vec: x, rel: 1.0 },
      { id: "xDup", vec: xDup, rel: 0.95 },
      { id: "y", vec: y, rel: 0.9 },
    ];
    const diverse = mmrRerank(items, 2, 0.5).map((i) => i.id);
    expect(diverse).toEqual(["x", "y"]); // picks the distinct y over the near-dup
    const relevanceOnly = mmrRerank(items, 2, 1).map((i) => i.id);
    expect(relevanceOnly).toEqual(["x", "xDup"]); // λ=1 → pure relevance
  });

  it("category penalty interleaves a one-type-heavy pool (more variety)", () => {
    const v = (s: number) => normalise([Math.sin(s), Math.cos(s), 0.1]);
    const items: RankItem[] = [
      { id: "e1", vec: v(1), rel: 0.9, category: "eats" },
      { id: "e2", vec: v(2), rel: 0.85, category: "eats" },
      { id: "e3", vec: v(3), rel: 0.8, category: "eats" },
      { id: "e4", vec: v(4), rel: 0.75, category: "eats" },
      { id: "b1", vec: v(5), rel: 0.6, category: "bars" },
    ];
    // No penalty (pure relevance) → all eats first, the lone bar last.
    expect(mmrRerank(items, 5, 1, 0).map((i) => i.id)[4]).toBe("b1");
    // With a category penalty the bar is promoted ahead of some eats.
    expect(
      mmrRerank(items, 5, 1, 0.2)
        .map((i) => i.id)
        .indexOf("b1"),
    ).toBeLessThan(4);
  });

  it("rankForTaste personalises when taste has signal", () => {
    const liked = normalise([1, 0, 0]);
    const other = normalise([0, 1, 0]);
    const candidates: Candidate[] = [
      {
        id: "match",
        vec: liked,
        rating: 4.0,
        reviewCount: 100,
        curated: false,
      },
      { id: "miss", vec: other, rating: 5.0, reviewCount: 100, curated: true },
    ];
    const ranked = rankForTaste(liked, candidates, {
      limit: 2,
      diversify: false,
    });
    expect(ranked[0].id).toBe("match"); // taste beats the higher-rated mismatch
    expect(ranked[0].personalised).toBe(true);
  });

  it("rankForTaste falls back to quality on cold-start (zero taste)", () => {
    const zero = [0, 0, 0];
    const candidates: Candidate[] = [
      {
        id: "low",
        vec: normalise([1, 0, 0]),
        rating: 3.8,
        reviewCount: 1000,
        curated: false,
      },
      {
        id: "high",
        vec: normalise([0, 1, 0]),
        rating: 4.9,
        reviewCount: 1000,
        curated: true,
      },
    ];
    const ranked = rankForTaste(zero, candidates, {
      limit: 2,
      diversify: false,
    });
    expect(ranked[0].id).toBe("high"); // best quality leads
    expect(ranked[0].personalised).toBe(false);
  });
});

describe("quality prior in personalised relevance (QUALITY_PRIOR_WEIGHT)", () => {
  const axis = (i: number): number[] => {
    const v = new Array<number>(400).fill(0);
    v[i] = 1;
    return v;
  };

  it("reorders an equal-taste tie toward the better-loved venue", () => {
    const taste = axis(0);
    const ranked = rankForTaste(
      taste,
      [
        {
          id: "meh",
          vec: axis(0),
          rating: 3.9,
          reviewCount: 5000,
          curated: false,
        },
        {
          id: "loved",
          vec: axis(0),
          rating: 4.9,
          reviewCount: 5000,
          curated: false,
        },
      ],
      { limit: 2, diversify: false },
    );
    expect(ranked[0].id).toBe("loved");
    expect(ranked[0].personalised).toBe(true);
  });

  it("never overrides a real taste gap (prior is a tiebreaker, not a ranker)", () => {
    const taste = axis(0);
    const ranked = rankForTaste(
      taste,
      [
        {
          id: "match-modest",
          vec: axis(0), // cosine 1 to taste
          rating: 3.9,
          reviewCount: 5000,
          curated: false,
        },
        {
          id: "mismatch-perfect",
          vec: axis(1), // cosine 0 to taste
          rating: 5.0,
          reviewCount: 5000,
          curated: true,
        },
      ],
      { limit: 2, diversify: false },
    );
    expect(ranked[0].id).toBe("match-modest");
  });
});
