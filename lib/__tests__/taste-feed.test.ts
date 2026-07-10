import { describe, it, expect } from "vitest";
import { compactTasteScores, TASTE_SCORE_MIN } from "@/lib/taste-feed";
import { DELIBERATE_SIGNAL_TYPES, SIGNAL_WEIGHTS } from "@/lib/taste-vector";

describe("compactTasteScores · wire compaction of the taste map", () => {
  it("drops near-zero scores (both signs) and keeps meaningful ones", () => {
    const out = compactTasteScores({
      strong: 0.42,
      weakPos: 0.01,
      weakNeg: -0.049,
      strongNeg: -0.3,
    });
    expect(out).toEqual({ strong: 0.42, strongNeg: -0.3 });
  });

  it("rounds survivors to 3 decimal places", () => {
    const out = compactTasteScores({ a: 0.123456789, b: -0.0999999 });
    expect(out).toEqual({ a: 0.123, b: -0.1 });
  });

  it("keeps a score exactly at the threshold", () => {
    const out = compactTasteScores({ edge: TASTE_SCORE_MIN });
    expect(out).toEqual({ edge: TASTE_SCORE_MIN });
  });

  it("an all-near-zero map compacts to empty (consumers read missing as 0)", () => {
    expect(compactTasteScores({ a: 0.001, b: -0.002 })).toEqual({});
  });
});

describe("DELIBERATE_SIGNAL_TYPES · the taste-carrying fetch filter", () => {
  it("includes every nonzero-weight signal and nothing else", () => {
    for (const t of DELIBERATE_SIGNAL_TYPES) {
      expect(SIGNAL_WEIGHTS[t]).not.toBe(0);
    }
    // The important members, by name.
    expect(DELIBERATE_SIGNAL_TYPES).toContain("save");
    expect(DELIBERATE_SIGNAL_TYPES).toContain("dismiss");
    expect(DELIBERATE_SIGNAL_TYPES).toContain("outbound_click");
  });

  it("excludes impressions (fetched separately for the Stage 6 penalty) and zero-weight navigation", () => {
    expect(DELIBERATE_SIGNAL_TYPES).not.toContain("impression");
    expect(DELIBERATE_SIGNAL_TYPES).not.toContain("search");
    expect(DELIBERATE_SIGNAL_TYPES).not.toContain("filter");
    expect(DELIBERATE_SIGNAL_TYPES).not.toContain("plan_started");
    expect(DELIBERATE_SIGNAL_TYPES).not.toContain("plan_abandoned");
  });
});
