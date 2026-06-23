import { describe, it, expect } from "vitest";
import {
  normalizeOpeningHours,
  getOpenState,
  isOpenNow,
  londonWallClock,
} from "@/lib/opening-hours";
import type { OpeningHours } from "@/lib/types";

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

describe("londonWallClock", () => {
  it("uses GMT in winter (London == UTC)", () => {
    // 2025-01-06 is a Monday.
    expect(londonWallClock(new Date("2025-01-06T12:00:00Z"))).toEqual({
      day: 1,
      hour: 12,
      minute: 0,
    });
  });

  it("uses BST in summer (London == UTC+1)", () => {
    const w = londonWallClock(new Date("2025-07-01T10:30:00Z"));
    expect(w.hour).toBe(11);
    expect(w.minute).toBe(30);
  });
});

describe("getOpenState / isOpenNow", () => {
  // Mon 09:00–17:00.
  const monOnly: OpeningHours = {
    periods: [
      {
        open: { day: 1, hour: 9, minute: 0 },
        close: { day: 1, hour: 17, minute: 0 },
      },
    ],
  };

  it("returns unknown when there are no hours", () => {
    const t = new Date("2025-01-06T12:00:00Z");
    expect(getOpenState(null, t).status).toBe("unknown");
    expect(getOpenState({ periods: [] }, t).status).toBe("unknown");
  });

  it("is open inside the period and reports the close time", () => {
    const t = new Date("2025-01-06T12:00:00Z"); // Mon 12:00 GMT
    const s = getOpenState(monOnly, t);
    expect(s.status).toBe("open");
    if (s.status === "open") {
      expect(s.closesAt).toEqual({ day: 1, hour: 17, minute: 0 });
    }
    expect(isOpenNow(monOnly, t)).toBe(true);
  });

  it("is closed before opening and reports today's opening", () => {
    const s = getOpenState(monOnly, new Date("2025-01-06T08:00:00Z")); // Mon 08:00
    expect(s.status).toBe("closed");
    if (s.status === "closed") {
      expect(s.opensAt).toEqual({ day: 1, hour: 9, minute: 0 });
    }
  });

  it("is closed after closing", () => {
    expect(isOpenNow(monOnly, new Date("2025-01-06T18:00:00Z"))).toBe(false);
  });

  it("handles a period that wraps past midnight (Fri 18:00 → Sat 02:00)", () => {
    const friNight: OpeningHours = {
      periods: [
        {
          open: { day: 5, hour: 18, minute: 0 },
          close: { day: 6, hour: 2, minute: 0 },
        },
      ],
    };
    // 2025-01-11 is a Saturday; 01:00 GMT is inside the wrap.
    expect(isOpenNow(friNight, new Date("2025-01-11T01:00:00Z"))).toBe(true);
    // 03:00 is after close.
    expect(isOpenNow(friNight, new Date("2025-01-11T03:00:00Z"))).toBe(false);
  });

  it("handles a period that wraps across the week boundary (Sat 22:00 → Sun 03:00)", () => {
    const satNight: OpeningHours = {
      periods: [
        {
          open: { day: 6, hour: 22, minute: 0 },
          close: { day: 0, hour: 3, minute: 0 },
        },
      ],
    };
    // 2025-01-12 is a Sunday; 01:00 is inside the Sat-night wrap.
    expect(isOpenNow(satNight, new Date("2025-01-12T01:00:00Z"))).toBe(true);
  });

  it("treats a null close as open 24h", () => {
    const allDay: OpeningHours = {
      periods: [{ open: { day: 0, hour: 0, minute: 0 }, close: null }],
    };
    const s = getOpenState(allDay, new Date("2025-01-08T04:17:00Z"));
    expect(s.status).toBe("open");
    if (s.status === "open") expect(s.closesAt).toBeNull();
  });

  it("flips with DST for a Tue noon to 2pm venue at 11:30 UTC", () => {
    // 2025-07-01 and 2025-01-07 are both Tuesdays (day 2).
    const lunchTue: OpeningHours = {
      periods: [
        {
          open: { day: 2, hour: 12, minute: 0 },
          close: { day: 2, hour: 14, minute: 0 },
        },
      ],
    };
    // Summer: 11:30Z → 12:30 BST → open.
    expect(isOpenNow(lunchTue, new Date("2025-07-01T11:30:00Z"))).toBe(true);
    // Winter: 11:30Z → 11:30 GMT → closed.
    expect(isOpenNow(lunchTue, new Date("2025-01-07T11:30:00Z"))).toBe(false);
  });
});
