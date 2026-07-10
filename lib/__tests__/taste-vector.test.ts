import { describe, it, expect } from "vitest";
import {
  buildTasteVector,
  accumulateSignal,
  signalWeight,
  recencyWeight,
  type TasteSignal,
} from "../taste-vector";
import { HYBRID_DIM } from "../hybrid-vector";
import { cosineSimilarity, normalise } from "../tag-vocabulary";

// Synthetic archetype "venue" vectors in the hybrid space.
function archetype(seed: number): number[] {
  const v = new Array<number>(HYBRID_DIM).fill(0);
  for (let i = 0; i < HYBRID_DIM; i++) v[i] = Math.sin(seed + i * 0.9);
  return normalise(v);
}
// A nearby variant of an archetype (same "kind", slightly different).
function near(base: number[], seed: number, eps = 0.12): number[] {
  return normalise(base.map((x, i) => x + eps * Math.sin(seed + i)));
}

const wineBar = archetype(1);
const steak = archetype(50);

describe("taste-vector (Stage 2.1)", () => {
  it("signal weights: save > open > 0, dismiss < 0, booking outbound > generic", () => {
    expect(signalWeight("save")).toBeGreaterThan(signalWeight("open"));
    expect(signalWeight("open")).toBeGreaterThan(0);
    expect(signalWeight("dismiss")).toBeLessThan(0);
    expect(signalWeight("search")).toBe(0);
    expect(
      signalWeight("outbound_click", { target: "booking" }),
    ).toBeGreaterThan(signalWeight("outbound_click", { target: "website" }));
  });

  it("recency: now=1, one half-life=0.5, monotonically decreasing", () => {
    expect(recencyWeight(0)).toBe(1);
    expect(recencyWeight(45)).toBeCloseTo(0.5, 5);
    expect(recencyWeight(90)).toBeLessThan(recencyWeight(45));
  });

  it("saving 5 cosy wine bars → taste closest to wine bars, not steakhouses", () => {
    const signals: TasteSignal[] = [2, 3, 4, 5, 6].map((s) => ({
      vector: near(wineBar, s),
      eventType: "save",
    }));
    const taste = buildTasteVector(signals);
    expect(cosineSimilarity(taste, wineBar)).toBeGreaterThan(
      cosineSimilarity(taste, steak),
    );
    expect(cosineSimilarity(taste, wineBar)).toBeGreaterThan(0.7);
  });

  it("a dismiss pushes taste AWAY from that kind", () => {
    const taste = buildTasteVector([
      { vector: near(wineBar, 2), eventType: "save" },
      { vector: near(wineBar, 3), eventType: "save" },
      { vector: near(wineBar, 4), eventType: "save" },
      { vector: steak, eventType: "dismiss" },
    ]);
    expect(cosineSimilarity(taste, steak)).toBeLessThan(0);
    expect(cosineSimilarity(taste, wineBar)).toBeGreaterThan(0);
  });

  it("recency: a fresh save outweighs a year-old one of the other kind", () => {
    const taste = buildTasteVector([
      { vector: wineBar, eventType: "save", ageDays: 0 },
      { vector: steak, eventType: "save", ageDays: 365 },
    ]);
    expect(cosineSimilarity(taste, wineBar)).toBeGreaterThan(
      cosineSimilarity(taste, steak),
    );
  });

  it("no net signal → all-zero vector (cold-start handoff)", () => {
    const taste = buildTasteVector([]);
    expect(taste).toHaveLength(HYBRID_DIM);
    expect(taste.every((x) => x === 0)).toBe(true);
  });

  it("online accumulate matches the batch direction", () => {
    const batch = buildTasteVector([
      { vector: near(wineBar, 2), eventType: "save" },
      { vector: near(wineBar, 7), eventType: "open" },
    ]);
    let acc = new Array<number>(HYBRID_DIM).fill(0);
    acc = accumulateSignal(acc, near(wineBar, 2), "save");
    acc = accumulateSignal(acc, near(wineBar, 7), "open", {
      daysSinceLastUpdate: 0,
    });
    expect(cosineSimilarity(normalise(acc), batch)).toBeCloseTo(1, 5);
  });
});

describe("taste-vector Stage 6: capped exposure penalty", () => {
  const imp = (vector: number[], venueId: string): TasteSignal => ({
    vector,
    eventType: "impression",
    venueId,
  });
  // n distinct venues of a kind, each impressed `times` (≥3 to clear the min).
  const impressedKind = (
    base: number[],
    n: number,
    times: number,
    seed = 100,
  ) =>
    Array.from({ length: n }, (_, s) => near(base, seed + s)).flatMap((v, s) =>
      Array.from({ length: times }, () => imp(v, `imp-${seed}-${s}`)),
    );

  it("impressions with no deliberate signal → all-zero (stays cold-start)", () => {
    const taste = buildTasteVector(impressedKind(wineBar, 5, 8));
    expect(taste.every((x) => x === 0)).toBe(true);
  });

  it("repeatedly shown-but-skipped venues pull taste away from that kind", () => {
    const saved: TasteSignal = {
      vector: steak,
      eventType: "save",
      venueId: "steak",
    };
    const withImp = buildTasteVector([saved, ...impressedKind(wineBar, 5, 3)]);
    const noImp = buildTasteVector([saved]);
    expect(cosineSimilarity(withImp, wineBar)).toBeLessThan(
      cosineSimilarity(noImp, wineBar),
    );
  });

  it("impressions can REFINE but never DOMINATE a deliberate signal", () => {
    // One save toward steak, vs 40 shown-but-skipped steak-ish venues (huge raw
    // penalty away from steak). The bound keeps the single save winning.
    const saved: TasteSignal = {
      vector: steak,
      eventType: "save",
      venueId: "steak",
    };
    const taste = buildTasteVector([
      saved,
      ...impressedKind(steak, 40, 3, 200),
    ]);
    expect(cosineSimilarity(taste, steak)).toBeGreaterThan(0);
  });

  it("a venue you engaged is exempt, so its own impressions don't count", () => {
    const base = buildTasteVector([
      { vector: wineBar, eventType: "save", venueId: "wb" },
    ]);
    const withImp = buildTasteVector([
      { vector: wineBar, eventType: "save", venueId: "wb" },
      imp(wineBar, "wb"),
      imp(wineBar, "wb"),
      imp(wineBar, "wb"),
      imp(wineBar, "wb"),
    ]);
    expect(cosineSimilarity(base, withImp)).toBeCloseTo(1, 6);
  });

  it("fewer than the minimum impressions → no penalty", () => {
    const saved: TasteSignal = {
      vector: steak,
      eventType: "save",
      venueId: "steak",
    };
    const twice = buildTasteVector([
      saved,
      imp(wineBar, "wb"),
      imp(wineBar, "wb"),
    ]);
    const none = buildTasteVector([saved]);
    expect(cosineSimilarity(twice, none)).toBeCloseTo(1, 6);
  });
});

describe("per-venue net cap (VENUE_NET_CAP)", () => {
  // Exactly-orthogonal unit vectors so coefficients are assertable precisely.
  const axis = (i: number): number[] => {
    const v = new Array<number>(HYBRID_DIM).fill(0);
    v[i] = 1;
    return v;
  };
  const a = axis(0);
  const b = axis(1);

  it("20 opens of one venue can't drown a single save of another", () => {
    const taste = buildTasteVector([
      { vector: b, eventType: "save", venueId: "b" },
      ...Array.from({ length: 20 }, () => ({
        vector: a,
        eventType: "open" as const,
        venueId: "a",
      })),
    ]);
    // Uncapped, venue a would weigh 20 x 0.3 = 6.0 (cos_b ~ 0.16); clamped to
    // +-2.0 the taste is (2a + 1b)/sqrt(5) - the save still reads clearly.
    expect(cosineSimilarity(taste, b)).toBeCloseTo(1 / Math.sqrt(5), 2);
    expect(cosineSimilarity(taste, a)).toBeCloseTo(2 / Math.sqrt(5), 2);
  });

  it("save + booking click still outweighs a lone save (cap binds only past it)", () => {
    const taste = buildTasteVector([
      { vector: a, eventType: "save", venueId: "a" },
      {
        vector: a,
        eventType: "outbound_click",
        context: { target: "booking" },
        venueId: "a",
      },
      { vector: b, eventType: "save", venueId: "b" },
    ]);
    // Venue a nets 1.9 (under the 2.0 cap) vs b's 1.0.
    expect(cosineSimilarity(taste, a)).toBeGreaterThan(
      cosineSimilarity(taste, b),
    );
  });

  it("a pile of dismisses clamps too (bounded negative pull)", () => {
    const taste = buildTasteVector([
      { vector: b, eventType: "save", venueId: "b" },
      ...Array.from({ length: 5 }, () => ({
        vector: a,
        eventType: "dismiss" as const,
        venueId: "a",
      })),
    ]);
    // Net -5.0 clamps to -2.0: away from a, but not to the exclusion of b.
    expect(cosineSimilarity(taste, a)).toBeLessThan(0);
    expect(cosineSimilarity(taste, a)).toBeGreaterThanOrEqual(-0.9);
    expect(cosineSimilarity(taste, b)).toBeCloseTo(1 / Math.sqrt(5), 2);
  });
});
