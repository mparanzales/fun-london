import { describe, it, expect } from "vitest";
import {
  entriesFor,
  originalStops,
  replacedCount,
  canUndo,
} from "@/lib/plan-history";

/**
 * These three derivations shipped wrong, twice, with every test green — because
 * they lived in a React handler this suite cannot reach, and the store's own
 * round-trip tests were handed a signature rather than deriving one.
 */
const s = (...ids: string[]) => ids.map((id) => ({ venue: { id } }));
const NIGHT = { n: 1 };
const OTHER = { n: 2 };

describe("entriesFor", () => {
  it("keeps only the night on screen", () => {
    const stack = [
      { key: NIGHT, stops: s("a") },
      { key: OTHER, stops: s("x") },
      { key: NIGHT, stops: s("b") },
    ];
    expect(entriesFor(stack, NIGHT).map((e) => e.stops[0].venue.id)).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("originalStops", () => {
  it("🧨 is the DEEPEST entry, not the base, once anything has been replaced", () => {
    // The bug: the active-plan store holds what is on screen, so after a
    // refresh a night's base is its REPLACED arrangement. Reading the original
    // off the base reported zero replacements on a night with two — and "Try
    // another combination" then skipped the confirm card that exists to
    // protect exactly that work.
    const base = s("A2", "B"); // stop 0 already replaced, persisted, restored
    const mine = [{ key: NIGHT, stops: s("A1", "B") }]; // before that swap
    expect(originalStops(mine, base).map((x) => x.venue.id)).toEqual([
      "A1",
      "B",
    ]);
  });

  it("is the base when nothing has been replaced", () => {
    const base = s("A", "B");
    expect(originalStops([], base)).toBe(base);
  });
});

describe("replacedCount", () => {
  it("counts stops that differ from the original", () => {
    expect(replacedCount(s("A2", "B", "C2"), s("A1", "B", "C1"))).toBe(2);
  });

  it("🧨 returns to zero when a change is undone, not up", () => {
    // Measured against the base rather than the original, undoing on a
    // restored night INVERTED this: it claimed a change had been made when one
    // had just been taken back, and shipped `swapped: 1` on a save of an
    // unswapped night.
    const original = s("A1", "B");
    expect(replacedCount(s("A2", "B"), original)).toBe(1);
    expect(replacedCount(s("A1", "B"), original)).toBe(0);
  });
});

describe("canUndo", () => {
  it("🧨 is true for a restored history whose head differs from the screen", () => {
    // Gated on divergence-from-base, this was false after every refresh: the
    // stored night IS the base, so a full history rendered no button.
    const current = s("A2", "B");
    const mine = [{ key: NIGHT, stops: s("A1", "B") }];
    expect(canUndo(mine, current)).toBe(true);
  });

  it("is false with no history", () => {
    expect(canUndo([], s("A", "B"))).toBe(false);
  });

  it("is false when the head already matches the screen", () => {
    // Cycling a stop all the way round returns to the original while still
    // pushing history. Offering Undo there, then changing the night, is worse
    // than not offering it.
    const current = s("A", "B");
    const mine = [{ key: NIGHT, stops: s("A", "B") }];
    expect(canUndo(mine, current)).toBe(false);
  });

  it("ignores entries belonging to another night", () => {
    const stack = [{ key: OTHER, stops: s("x", "y") }];
    expect(canUndo(entriesFor(stack, NIGHT), s("A", "B"))).toBe(false);
  });
});
