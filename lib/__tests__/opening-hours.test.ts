import { describe, it, expect } from "vitest";
import { normalizeOpeningHours } from "@/lib/opening-hours";

describe("normalizeOpeningHours", () => {
  it("returns null for nullish or empty input", () => {
    expect(normalizeOpeningHours(null)).toBeNull();
    expect(normalizeOpeningHours(undefined)).toBeNull();
    expect(normalizeOpeningHours({ periods: [] })).toBeNull();
  });

  it("normalizes a period and fills missing minute/hour with 0", () => {
    const out = normalizeOpeningHours({
      periods: [{ open: { day: 1, hour: 9 }, close: { day: 1, hour: 17 } }],
    });
    expect(out?.periods[0].open).toEqual({ day: 1, hour: 9, minute: 0 });
    expect(out?.periods[0].close).toEqual({ day: 1, hour: 17, minute: 0 });
  });

  it("treats a period with no close as open-24h (close = null)", () => {
    const out = normalizeOpeningHours({
      periods: [{ open: { day: 0, hour: 0, minute: 0 } }],
    });
    expect(out?.periods[0].close).toBeNull();
  });

  it("drops periods that have no valid open day", () => {
    const out = normalizeOpeningHours({
      periods: [{ close: { day: 2, hour: 12 } }],
    });
    expect(out).toBeNull();
  });
});
