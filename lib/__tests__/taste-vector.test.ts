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
    expect(signalWeight("outbound_click", { target: "booking" })).toBeGreaterThan(
      signalWeight("outbound_click", { target: "website" }),
    );
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
    expect(cosineSimilarity(taste, wineBar)).toBeGreaterThan(cosineSimilarity(taste, steak));
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
    expect(cosineSimilarity(taste, wineBar)).toBeGreaterThan(cosineSimilarity(taste, steak));
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
    acc = accumulateSignal(acc, near(wineBar, 7), "open", { daysSinceLastUpdate: 0 });
    expect(cosineSimilarity(normalise(acc), batch)).toBeCloseTo(1, 5);
  });
});
