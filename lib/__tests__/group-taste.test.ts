import { describe, it, expect } from "vitest";
import { averageTasteMaps } from "@/lib/group-taste";

describe("averageTasteMaps · group taste from peer-shared maps", () => {
  it("empty set returns null (plan falls back to rating-led)", () => {
    expect(averageTasteMaps([])).toBeNull();
  });

  it("all members present but signal-less (all-empty maps) returns null", () => {
    // Everyone broadcast {} — the barrier is satisfied, but there's nothing to
    // tune, so we stay rating-led rather than claim a false "tuned" state.
    expect(averageTasteMaps([{}, {}, {}])).toBeNull();
  });

  it("ignores absent (null/undefined) entries and averages the rest", () => {
    const out = averageTasteMaps([{ a: 1 }, undefined, null, { a: 0 }]);
    expect(out).toEqual({ a: 0.5 });
  });

  it("a single member's map is returned as-is (average of one)", () => {
    expect(averageTasteMaps([{ a: 0.4, b: -0.2 }])).toEqual({
      a: 0.4,
      b: -0.2,
    });
  });

  it("two members are averaged per venue", () => {
    const out = averageTasteMaps([
      { a: 1, b: 0 },
      { a: 0, b: 1 },
    ]);
    expect(out).toEqual({ a: 0.5, b: 0.5 });
  });

  it("treats a venue missing from a member's map as 0 (wire-compacted maps)", () => {
    // Taste maps are compacted before broadcast (near-zero scores dropped, see
    // lib/taste-feed.compactTasteScores) — so b absent from the second map
    // means that member scored it ~0, not "didn't vote". The mean dilutes:
    // 0.6 / 2 members, not 0.6 / 1. The old per-scorer denominator inflated a
    // venue one member loves and everyone else is neutral on.
    const out = averageTasteMaps([{ a: 1, b: 0.6 }, { a: 0 }]);
    expect(out).toEqual({ a: 0.5, b: 0.3 });
  });

  it("three members: equal-weight mean", () => {
    const out = averageTasteMaps([{ a: 0.9 }, { a: 0.3 }, { a: 0.3 }]);
    expect(out!.a).toBeCloseTo(0.5, 10);
  });
});
