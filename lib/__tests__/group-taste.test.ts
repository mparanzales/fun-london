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

  it("averages a venue over only the members that scored it", () => {
    // b appears in one of two maps → its mean is over that one member, not
    // diluted by a phantom zero from the other.
    const out = averageTasteMaps([{ a: 1, b: 0.6 }, { a: 0 }]);
    expect(out).toEqual({ a: 0.5, b: 0.6 });
  });

  it("three members: equal-weight mean", () => {
    const out = averageTasteMaps([{ a: 0.9 }, { a: 0.3 }, { a: 0.3 }]);
    expect(out!.a).toBeCloseTo(0.5, 10);
  });
});
