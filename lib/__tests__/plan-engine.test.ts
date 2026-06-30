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

  it("does not repeat a venue type when the area has alternatives (no Pub then Pub)", () => {
    const venues = [
      makeVenue({
        id: "cafe",
        neighbourhood: "Notting Hill",
        type: "Cafe" as Venue["type"],
      }),
      makeVenue({
        id: "pub1",
        neighbourhood: "Notting Hill",
        type: "Pub" as Venue["type"],
      }),
      makeVenue({
        id: "pub2",
        neighbourhood: "Notting Hill",
        type: "Pub" as Venue["type"],
      }),
      makeVenue({
        id: "bar",
        neighbourhood: "Notting Hill",
        type: "Bar" as Venue["type"],
      }),
    ];
    const plan = computePlan(venues, {
      area: "Notting Hill",
      vibe: "Lively",
      budget: "Any",
      offset: 0,
    });
    const types = plan.steps.map((s) => s.venue.type);
    // Three distinct types are available, so the night should not repeat one.
    expect(new Set(types).size).toBe(types.length);
    expect(types.filter((t) => t === "Pub").length).toBeLessThanOrEqual(1);
  });

  it("excludes a venue that is closed at `when` (no routing to a shut door)", () => {
    const probe = new Date(2026, 5, 10, 12, 0);
    const day = probe.getDay();
    // Open 09:00–17:00 on the test day → shut at 23:00.
    const dayHours: OpeningHours = {
      periods: [
        {
          open: { day, hour: 9, minute: 0 },
          close: { day, hour: 17, minute: 0 },
        },
      ],
    };
    const when = new Date(2026, 5, 10, 23, 0); // after close
    const venues = [
      makeVenue({
        id: "closed-bar",
        neighbourhood: "Soho",
        type: "Bar" as Venue["type"],
        openingHours: dayHours,
      }),
      makeVenue({
        id: "open-restaurant",
        neighbourhood: "Soho",
        type: "Restaurant" as Venue["type"],
        openingHours: null,
      }),
      makeVenue({
        id: "open-cafe",
        neighbourhood: "Soho",
        type: "Cafe" as Venue["type"],
        openingHours: null,
      }),
      makeVenue({
        id: "open-pub",
        neighbourhood: "Soho",
        type: "Pub" as Venue["type"],
        openingHours: null,
      }),
    ];
    const plan = computePlan(venues, {
      area: "Soho",
      vibe: "Lively",
      budget: "Any",
      offset: 0,
      when,
    });
    const ids = plan.steps.map((s) => s.venue.id);
    expect(ids).not.toContain("closed-bar");
    expect(plan.steps.length).toBeGreaterThanOrEqual(1);
  });
});

describe("computePlan — taste-aware (Stage 4.1)", () => {
  const venues: Venue[] = [
    makeVenue({ id: "r-meh", type: "Restaurant", neighbourhood: "Soho", price: "££", rating: 4.6 }),
    makeVenue({ id: "r-fav", type: "Restaurant", neighbourhood: "Soho", price: "££", rating: 4.5 }),
    makeVenue({ id: "bar", type: "Bar", neighbourhood: "Soho", price: "££", rating: 4.5 }),
    makeVenue({ id: "music", type: "Live Music", neighbourhood: "Soho", price: "££", rating: 4.5 }),
  ];
  const opts = { area: "Soho", vibe: "Fancy" as const, budget: "Any" as const };
  const startId = (p: ReturnType<typeof computePlan>) =>
    p.steps.find((s) => s.role === "Start")?.venue.id;

  it("taste promotes the on-brief venue the user actually likes", () => {
    // Without taste the slightly higher-rated 'r-meh' starts the night…
    expect(startId(computePlan(venues, opts))).toBe("r-meh");
    // …with taste, the favourite wins the Start slot.
    expect(
      startId(computePlan(venues, { ...opts, tasteScores: { "r-fav": 0.6, "r-meh": 0 } })),
    ).toBe("r-fav");
  });

  it("no taste scores → identical to the non-personalised plan (backward compatible)", () => {
    const base = computePlan(venues, opts).steps.map((s) => s.venue.id);
    expect(computePlan(venues, { ...opts, tasteScores: null }).steps.map((s) => s.venue.id)).toEqual(base);
  });
});
