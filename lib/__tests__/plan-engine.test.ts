import { describe, it, expect } from "vitest";
import {
  withinBudget,
  walkMins,
  isOpenAt,
  computePlan,
  relinkSteps,
  isDaytimeHour,
  computeWalkablePlan,
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
      area: { kind: "neighbourhood" as const, name: "Soho" },
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
      area: { kind: "neighbourhood" as const, name: "Soho" },
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
      area: { kind: "neighbourhood" as const, name: "Notting Hill" },
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
      area: { kind: "neighbourhood" as const, name: "Soho" },
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

describe("computePlan · taste-aware (Stage 4.1)", () => {
  const venues: Venue[] = [
    makeVenue({
      id: "r-meh",
      type: "Restaurant",
      neighbourhood: "Soho",
      price: "££",
      rating: 4.6,
    }),
    makeVenue({
      id: "r-fav",
      type: "Restaurant",
      neighbourhood: "Soho",
      price: "££",
      rating: 4.5,
    }),
    makeVenue({
      id: "bar",
      type: "Bar",
      neighbourhood: "Soho",
      price: "££",
      rating: 4.5,
    }),
    makeVenue({
      id: "music",
      type: "Live Music",
      neighbourhood: "Soho",
      price: "££",
      rating: 4.5,
    }),
  ];
  const opts = {
    area: { kind: "neighbourhood" as const, name: "Soho" },
    vibe: "Fancy" as const,
    budget: "Any" as const,
  };
  const startId = (p: ReturnType<typeof computePlan>) =>
    p.steps.find((s) => s.role === "Start")?.venue.id;

  it("taste promotes the on-brief venue the user actually likes", () => {
    // Without taste the slightly higher-rated 'r-meh' starts the night…
    expect(startId(computePlan(venues, opts))).toBe("r-meh");
    // …with taste, the favourite wins the Start slot.
    expect(
      startId(
        computePlan(venues, {
          ...opts,
          tasteScores: { "r-fav": 0.6, "r-meh": 0 },
        }),
      ),
    ).toBe("r-fav");
  });

  it("no taste scores → identical to the non-personalised plan (backward compatible)", () => {
    const base = computePlan(venues, opts).steps.map((s) => s.venue.id);
    expect(
      computePlan(venues, { ...opts, tasteScores: null }).steps.map(
        (s) => s.venue.id,
      ),
    ).toEqual(base);
  });
});

describe("computePlan · time-window orienteering (Stage 4.2)", () => {
  // Each stop is checked open at its ARRIVAL time, not the plan start. With no
  // coordinates walkMins falls back to 8 min, so from a 20:30 start the slots
  // arrive at ~20:30 (Start), ~21:53 (Then), ~23:01 (Finish).
  const day = new Date(2026, 5, 10, 20, 30).getDay();
  const hours = (oh: { o: number; c: number }): OpeningHours => ({
    periods: [
      {
        open: { day, hour: oh.o, minute: 0 },
        close: { day, hour: oh.c, minute: 0 },
      },
    ],
  });
  const when = new Date(2026, 5, 10, 20, 30);

  const venues: Venue[] = [
    // Start: open all evening (unknown hours → fail-open).
    makeVenue({
      id: "restaurant",
      neighbourhood: "Soho",
      type: "Restaurant",
      openingHours: null,
    }),
    // Then: an early bar OPEN at 20:30 but SHUT (closes 21:00) by the ~21:53
    // arrival — must be dropped despite being open at the plan start.
    makeVenue({
      id: "early-bar",
      neighbourhood: "Soho",
      type: "Bar",
      openingHours: hours({ o: 17, c: 21 }),
    }),
    // …and a bar that's open late, to fill Then cleanly.
    makeVenue({
      id: "late-bar",
      neighbourhood: "Soho",
      type: "Bar",
      openingHours: null,
    }),
    // Finish: a club CLOSED now (opens 22:00) but OPEN by the ~23:01 arrival —
    // must be eligible even though it's shut at the plan start.
    makeVenue({
      id: "late-club",
      neighbourhood: "Soho",
      type: "Live Music",
      openingHours: hours({ o: 22, c: 3 }),
    }),
  ];
  const opts = {
    area: { kind: "neighbourhood" as const, name: "Soho" },
    vibe: "Lively" as const,
    budget: "Any" as const,
    when,
  };

  const stepFor = (
    p: ReturnType<typeof computePlan>,
    role: "Start" | "Then" | "Finish",
  ) => p.steps.find((s) => s.role === role)?.venue.id;

  it("drops a venue open at the start but shut by its arrival time", () => {
    const plan = computePlan(venues, opts);
    expect(stepFor(plan, "Then")).toBe("late-bar");
    expect(plan.steps.map((s) => s.venue.id)).not.toContain("early-bar");
  });

  it("keeps a venue shut at the start but open by its arrival time (late club)", () => {
    const plan = computePlan(venues, opts);
    expect(stepFor(plan, "Finish")).toBe("late-club");
  });

  it("populates arriveAt for each stop in increasing order", () => {
    const plan = computePlan(venues, opts);
    const times = plan.steps.map((s) => s.arriveAt);
    expect(times.every((t) => t instanceof Date)).toBe(true);
    expect(times[0]!.getTime()).toBe(when.getTime()); // first stop arrives at `when`
    for (let i = 1; i < times.length; i++) {
      expect(times[i]!.getTime()).toBeGreaterThan(times[i - 1]!.getTime());
    }
  });

  it("leaves arriveAt null when no start time is supplied (server render)", () => {
    const plan = computePlan(venues, {
      area: { kind: "neighbourhood" as const, name: "Soho" },
      vibe: "Lively",
      budget: "Any",
    });
    expect(plan.steps.every((s) => s.arriveAt === null)).toBe(true);
  });
});

describe("computePlan · day vs evening + dwell-by-type (day/night spine)", () => {
  const venues: Venue[] = [
    makeVenue({ id: "cafe", type: "Cafe", neighbourhood: "Soho" }),
    makeVenue({ id: "rest", type: "Restaurant", neighbourhood: "Soho" }),
    makeVenue({ id: "culture", type: "Culture", neighbourhood: "Soho" }),
    makeVenue({ id: "market", type: "Market", neighbourhood: "Soho" }),
    makeVenue({ id: "wine", type: "Wine Bar", neighbourhood: "Soho" }),
    makeVenue({ id: "bar", type: "Bar", neighbourhood: "Soho" }),
    makeVenue({ id: "music", type: "Live Music", neighbourhood: "Soho" }),
  ];
  const base = {
    area: { kind: "neighbourhood" as const, name: "Soho" },
    vibe: "Chill" as const,
    budget: "Any" as const,
  };

  it("a DAY plan can place daytime activities (Culture/Market); an EVENING plan can't", () => {
    const dayTypes = computePlan(venues, { ...base, daypart: "day" }).steps.map(
      (s) => s.venue.type,
    );
    expect(dayTypes.some((t) => t === "Culture" || t === "Market")).toBe(true);
    expect(dayTypes).not.toContain("Live Music"); // no club in a daytime plan

    const eveTypes = computePlan(venues, {
      ...base,
      daypart: "evening",
    }).steps.map((s) => s.venue.type);
    expect(eveTypes).not.toContain("Culture");
    expect(eveTypes).not.toContain("Market"); // markets aren't a night stop
  });

  it("isDaytimeHour: 05:00–16:59 is day; the small hours read as night", () => {
    expect(isDaytimeHour(5)).toBe(true); // 5am — day begins
    expect(isDaytimeHour(12)).toBe(true); // noon
    expect(isDaytimeHour(16)).toBe(true); // 4pm — last day hour
    expect(isDaytimeHour(17)).toBe(false); // 5pm — evening
    expect(isDaytimeHour(23)).toBe(false); // 11pm — night
    expect(isDaytimeHour(0)).toBe(false); // midnight — still the night before
    expect(isDaytimeHour(1)).toBe(false); // 1am — the bug case
    expect(isDaytimeHour(4)).toBe(false); // 4:xx am — still night
  });

  it("infers evening for a plan built in the small hours (no explicit daypart)", () => {
    // ~1am with no explicit daypart used to read as a DAY plan (hour < 17);
    // it must now build an evening/night plan — no Culture/Market stop.
    const oneAm = new Date(2026, 5, 10, 1, 0);
    const eveTypes = computePlan(venues, { ...base, when: oneAm }).steps.map(
      (s) => s.venue.type,
    );
    expect(eveTypes).not.toContain("Culture");
    expect(eveTypes).not.toContain("Market");

    // Sanity: midday with no explicit daypart still reads as a day plan.
    const noon = new Date(2026, 5, 10, 12, 0);
    const dayTypes = computePlan(venues, { ...base, when: noon }).steps.map(
      (s) => s.venue.type,
    );
    expect(dayTypes.some((t) => t === "Culture" || t === "Market")).toBe(true);
  });

  it("dwell time depends on venue type (coffee ≠ dinner ≠ club), not the slot", () => {
    const plan = computePlan(venues, { ...base, daypart: "evening" });
    for (const s of plan.steps) {
      if (s.venue.type === "Restaurant") expect(s.dwellMins).toBe(90);
      if (s.venue.type === "Cafe") expect(s.dwellMins).toBe(40);
      if (s.venue.type === "Live Music") expect(s.dwellMins).toBe(105);
    }
    // The old bug was a flat per-slot dwell; now a night has varied dwells.
    expect(new Set(plan.steps.map((s) => s.dwellMins)).size).toBeGreaterThan(1);
  });

  it("'Anywhere' clusters to a WALKABLE pocket, not a city-wide scatter", () => {
    // Two tight clusters far apart: a complete night in Soho (~central) and a
    // lone far-east bar. Anywhere must keep the night inside ONE walkable pocket
    // rather than stitch Soho → far-east.
    const soho = { lat: 51.5135, lng: -0.1336 };
    const venues = [
      makeVenue({
        id: "soho-r",
        type: "Restaurant",
        neighbourhood: "Soho",
        lat: soho.lat,
        lng: soho.lng,
      }),
      makeVenue({
        id: "soho-b",
        type: "Bar",
        neighbourhood: "Soho",
        lat: 51.5138,
        lng: -0.134,
      }),
      makeVenue({
        id: "soho-m",
        type: "Live Music",
        neighbourhood: "Soho",
        lat: 51.5132,
        lng: -0.1331,
      }),
      // ~12 km east — must never join the Soho cluster.
      makeVenue({
        id: "far-b",
        type: "Bar",
        neighbourhood: "Walthamstow",
        lat: 51.583,
        lng: 0.02,
      }),
    ];
    const plan = computePlan(venues, {
      area: { kind: "anywhere" },
      vibe: "Lively",
      budget: "Any",
      daypart: "evening",
    });
    expect(plan.steps.length).toBeGreaterThanOrEqual(2);
    expect(plan.steps.map((s) => s.venue.id)).not.toContain("far-b");
    // Every hop is a short walk, and the resolved pocket is named.
    expect(
      Math.max(...plan.steps.map((s) => s.walkToNextMins ?? 0)),
    ).toBeLessThanOrEqual(20);
    expect(plan.area).toBe("Soho");
  });

  it("a region scope clusters within a walkable pocket of that region", () => {
    // East spans Shoreditch (central-east) to Walthamstow (far NE). A region pick
    // should settle on a walkable pocket, not span the whole region.
    const venues = [
      makeVenue({
        id: "sh-r",
        type: "Restaurant",
        neighbourhood: "Shoreditch",
        lat: 51.5265,
        lng: -0.0784,
      }),
      makeVenue({
        id: "sh-b",
        type: "Bar",
        neighbourhood: "Shoreditch",
        lat: 51.5258,
        lng: -0.0772,
      }),
      makeVenue({
        id: "sh-m",
        type: "Live Music",
        neighbourhood: "Shoreditch",
        lat: 51.527,
        lng: -0.079,
      }),
      makeVenue({
        id: "wow-b",
        type: "Bar",
        neighbourhood: "Walthamstow",
        lat: 51.583,
        lng: -0.02,
      }), // ~7 km NE
    ];
    const plan = computePlan(venues, {
      area: { kind: "region", region: "East" },
      vibe: "Lively",
      budget: "Any",
      daypart: "evening",
    });
    expect(plan.steps.length).toBeGreaterThanOrEqual(2);
    expect(plan.steps.map((s) => s.venue.id)).not.toContain("wow-b");
    expect(plan.area).toBe("Shoreditch"); // the resolved pocket
  });

  it("a 'near me' centre restricts the plan to its radius", () => {
    const here = { lat: 51.5141, lng: -0.1494 };
    const venuesGeo = [
      makeVenue({
        id: "near-r",
        type: "Restaurant",
        neighbourhood: "X",
        lat: 51.5141,
        lng: -0.1494,
      }),
      makeVenue({
        id: "near-b",
        type: "Bar",
        neighbourhood: "X",
        lat: 51.5145,
        lng: -0.1496,
      }),
      makeVenue({
        id: "near-m",
        type: "Live Music",
        neighbourhood: "X",
        lat: 51.5139,
        lng: -0.1492,
      }),
      makeVenue({
        id: "far",
        type: "Restaurant",
        neighbourhood: "X",
        lat: 51.62,
        lng: -0.32,
      }), // ~20 km
    ];
    const ids = computePlan(venuesGeo, {
      area: { kind: "neighbourhood", name: "X" },
      vibe: "Lively",
      budget: "Any",
      daypart: "evening",
      center: here,
      radiusKm: 1,
    }).steps.map((s) => s.venue.id);
    expect(ids).not.toContain("far");
  });
});

describe("computePlan · per-stop swap (alternatives + relinkSteps)", () => {
  const venues: Venue[] = [
    makeVenue({
      id: "rest",
      type: "Restaurant",
      neighbourhood: "Soho",
      rating: 4.6,
    }),
    makeVenue({ id: "bar1", type: "Bar", neighbourhood: "Soho", rating: 4.6 }),
    makeVenue({ id: "bar2", type: "Bar", neighbourhood: "Soho", rating: 4.4 }),
    makeVenue({
      id: "music",
      type: "Live Music",
      neighbourhood: "Soho",
      rating: 4.5,
    }),
  ];

  it("offers per-stop alternatives that aren't already in the plan", () => {
    const plan = computePlan(venues, {
      area: { kind: "neighbourhood" as const, name: "Soho" },
      vibe: "Lively",
      budget: "Any",
      daypart: "evening",
    });
    expect(plan.alternatives).toHaveLength(plan.steps.length);
    const chosen = new Set(plan.steps.map((s) => s.venue.id));
    for (const alts of plan.alternatives)
      for (const a of alts) expect(chosen.has(a.id)).toBe(false);
    // the unused second bar is a real swap option somewhere in the plan
    expect(plan.alternatives.flat().map((a) => a.id)).toContain("bar2");
  });

  it("relinkSteps recomputes dwell + walk + the arrival clock for a swap", () => {
    const when = new Date(2026, 5, 10, 19, 0);
    const steps = relinkSteps(
      [
        { venue: makeVenue({ type: "Restaurant" }), role: "Start" },
        { venue: makeVenue({ type: "Bar" }), role: "Then" },
      ],
      when,
    );
    expect(steps[0].dwellMins).toBe(90); // Restaurant
    expect(steps[1].dwellMins).toBe(60); // Bar
    expect(steps[0].walkToNextMins).toBe(8); // no coords → fallback
    expect(steps[1].walkToNextMins).toBeNull(); // last stop
    expect(steps[0].arriveAt?.getTime()).toBe(when.getTime());
    // stop 2 arrives after stop 1's dwell (90) + walk (8) = 98 min later
    expect(steps[1].arriveAt?.getTime()).toBe(when.getTime() + 98 * 60_000);
  });

  it("relinkSteps leaves arrivals null with no clock (server render)", () => {
    const steps = relinkSteps([
      { venue: makeVenue({ type: "Cafe" }), role: "Start" },
    ]);
    expect(steps[0].arriveAt).toBeNull();
  });
});

describe("computeWalkablePlan · group taste (Stage 5)", () => {
  const settings = {
    area: { kind: "anywhere" as const },
    budget: "Any" as const,
    when: new Date(2026, 5, 10, 20, 0),
    groupSize: 3,
  };
  const venues: Venue[] = [
    makeVenue({
      id: "rest-hi",
      type: "Restaurant",
      neighbourhood: "Soho",
      rating: 4.7,
      lat: 51.5135,
      lng: -0.1336,
    }),
    makeVenue({
      id: "rest-lo",
      type: "Restaurant",
      neighbourhood: "Soho",
      rating: 4.3,
      lat: 51.5138,
      lng: -0.134,
    }),
  ];

  it("without taste, the higher-rated venue leads", () => {
    const plan = computeWalkablePlan(venues, settings, ["Start"]);
    expect(plan.steps[0]?.venue.id).toBe("rest-hi");
  });

  it("a strong group-taste match beats a higher rating", () => {
    // 4.3 + GROUP_TASTE_WEIGHT(4) * 0.7 = 7.1 > 4.7 → the group's pick wins.
    const plan = computeWalkablePlan(
      venues,
      settings,
      ["Start"],
      [],
      0,
      undefined,
      { "rest-lo": 0.7 },
    );
    expect(plan.steps[0]?.venue.id).toBe("rest-lo");
  });

  it("null taste is identical to no taste (backward compatible)", () => {
    const a = computeWalkablePlan(venues, settings, ["Start"]).steps.map(
      (s) => s.venue.id,
    );
    const b = computeWalkablePlan(
      venues,
      settings,
      ["Start"],
      [],
      0,
      undefined,
      null,
    ).steps.map((s) => s.venue.id);
    expect(b).toEqual(a);
  });
});
