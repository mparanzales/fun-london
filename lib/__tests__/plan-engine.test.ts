import { describe, it, expect } from "vitest";
import {
  withinBudget,
  walkMins,
  isOpenAt,
  computePlan,
} from "@/lib/plan-engine";
import type { Venue, OpeningHours } from "@/lib/types";
import { makeVenue } from "./_fixtures";

describe("withinBudget", () => {
  it("'Any' allows every price", () => {
    expect(withinBudget("£", "Any")).toBe(true);
    expect(withinBudget("£££", "Any")).toBe(true);
  });

  it("'£' caps at the cheapest tier", () => {
    expect(withinBudget("£", "£")).toBe(true);
    expect(withinBudget("££", "£")).toBe(false);
  });

  it("'££' allows up to ££ but not £££", () => {
    expect(withinBudget("££", "££")).toBe(true);
    expect(withinBudget("£££", "££")).toBe(false);
  });
});

describe("walkMins", () => {
  it("uses the 8-min fallback when either venue lacks coordinates", () => {
    expect(walkMins(makeVenue({}), makeVenue({ lat: 51.5, lng: -0.1 }))).toBe(
      8,
    );
  });

  it("returns the 2-min floor for identical coordinates", () => {
    const a = makeVenue({ lat: 51.5142, lng: -0.1494 });
    const b = makeVenue({ lat: 51.5142, lng: -0.1494 });
    expect(walkMins(a, b)).toBe(2);
  });

  it("scales up with distance", () => {
    const a = makeVenue({ lat: 51.51, lng: -0.1 });
    const b = makeVenue({ lat: 51.53, lng: -0.1 });
    expect(walkMins(a, b)).toBeGreaterThan(2);
  });
});

describe("isOpenAt", () => {
  it("fails open when opening hours are unknown", () => {
    const v = makeVenue({ openingHours: null });
    expect(isOpenAt(v, new Date(2026, 5, 10, 20, 0))).toBe(true);
  });

  it("respects an explicit open/closed window", () => {
    // Build the period for the same weekday as the test date, so the test
    // doesn't depend on which day 2026-06-10 happens to be.
    const noon = new Date(2026, 5, 10, 12, 0);
    const day = noon.getDay();
    const oh: OpeningHours = {
      periods: [
        {
          open: { day, hour: 9, minute: 0 },
          close: { day, hour: 17, minute: 0 },
        },
      ],
    };
    const v = makeVenue({ openingHours: oh });
    expect(isOpenAt(v, noon)).toBe(true); // 12:00 → inside 09–17
    expect(isOpenAt(v, new Date(2026, 5, 10, 20, 0))).toBe(false); // 20:00 → closed
  });
});

describe("computePlan", () => {
  it("returns zero steps when there are no venues (drives the empty-state guard)", () => {
    const plan = computePlan([] as Venue[], {
      area: "Soho",
      vibe: "Chill",
      budget: "Any",
      offset: 0,
    });
    expect(plan.steps).toHaveLength(0);
  });

  it("builds at least one stop when venues exist in the area", () => {
    const venues = [
      makeVenue({
        id: "a",
        neighbourhood: "Soho",
        type: "Restaurant" as Venue["type"],
      }),
      makeVenue({
        id: "b",
        neighbourhood: "Soho",
        type: "Bar" as Venue["type"],
      }),
      makeVenue({
        id: "c",
        neighbourhood: "Soho",
        type: "Cafe" as Venue["type"],
      }),
    ];
    const plan = computePlan(venues, {
      area: "Soho",
      vibe: "Lively",
      budget: "Any",
      offset: 0,
    });
    expect(plan.steps.length).toBeGreaterThanOrEqual(1);
    expect(plan.steps.length).toBeLessThanOrEqual(3);
    expect(plan.area).toBe("Soho");
  });
});
