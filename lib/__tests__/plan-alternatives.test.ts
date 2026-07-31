import { describe, it, expect } from "vitest";
import { alternativesFor, computePlan } from "@/lib/plan-engine";
import type { Venue, OpeningHours } from "@/lib/types";
import { makeVenue } from "./_fixtures";

/**
 * `alternativesFor` is what lets a RESTORED or REOPENED night offer per-stop
 * replacements at all.
 *
 * 🧨 The bug it exists to make impossible: the UI used to reach for
 * `Plan.alternatives`, which is indexed to the stops the ENGINE last produced.
 * On a night the engine did not produce — one restored from localStorage, or
 * reopened from the saved list — `alternatives[i]` describes some other
 * night's stop i, so "Change" could swap in a venue chosen for a walk that no
 * longer exists and build a route nobody can walk. The previous release hid
 * the control rather than risk it. These tests pin the property that replaces
 * that decision: the options always belong to the stops they are offered for.
 */

// Soho-ish. 1 degree of latitude ≈ 111 km, so +0.005 ≈ 0.55 km (inside the
// engine's widest 1.6 km walk radius) and +0.05 ≈ 5.5 km (far outside it).
const HERE = { lat: 51.5142, lng: -0.1494 };
const NEAR = { lat: HERE.lat + 0.005, lng: HERE.lng };
const FAR = { lat: HERE.lat + 0.05, lng: HERE.lng };

const at = (
  id: string,
  type: Venue["type"],
  where: { lat: number; lng: number },
  extra: Partial<Venue> = {},
) => makeVenue({ id, slug: id, name: id, type, ...where, ...extra });

// An evening night: Start = somewhere to eat, Then = drinks, Finish = music.
const stopsAt = (where: { lat: number; lng: number }) => [
  { venue: at("in-start", "Restaurant", where), role: "Start" as const },
  { venue: at("in-then", "Bar", where), role: "Then" as const },
];

const EVENING = {
  vibe: "Chill" as const,
  budget: "Any" as const,
  daypart: "evening" as const,
};

describe("alternativesFor", () => {
  it("never offers a venue already in the night", () => {
    const stops = stopsAt(HERE);
    const pool = [...stops.map((s) => s.venue), at("spare", "Bar", HERE)];
    const alts = alternativesFor(pool, stops, EVENING);
    for (const list of alts) {
      expect(list.map((v) => v.id)).not.toContain("in-start");
      expect(list.map((v) => v.id)).not.toContain("in-then");
    }
  });

  it("only offers venues that fit that stop's role for the daypart", () => {
    const stops = stopsAt(HERE);
    const pool = [
      ...stops.map((s) => s.venue),
      at("a-restaurant", "Restaurant", HERE),
      at("a-bar", "Bar", HERE),
    ];
    const [forStart, forThen] = alternativesFor(pool, stops, EVENING);
    // Start is a place to eat; Then is drinks. Neither may borrow the other's.
    expect(forStart.map((v) => v.id)).toEqual(["a-restaurant"]);
    expect(forThen.map((v) => v.id)).toEqual(["a-bar"]);
  });

  it("🧨 keeps a replacement within walking distance of the OTHER stops", () => {
    // The whole point of the constraint: swapping a stop must not produce a
    // night that cannot be walked. The far candidate fits the role perfectly.
    const stops = stopsAt(HERE);
    const pool = [
      ...stops.map((s) => s.venue),
      at("near-bar", "Bar", NEAR),
      at("far-bar", "Bar", FAR),
    ];
    const [, forThen] = alternativesFor(pool, stops, EVENING);
    expect(forThen.map((v) => v.id)).toContain("near-bar");
    expect(forThen.map((v) => v.id)).not.toContain("far-bar");
  });

  it("🧨 answers for the stops it is GIVEN, not for some other night", () => {
    // The regression this function exists for. One pool, two nights in
    // different parts of town: each night's options are anchored to its own
    // stops, so an array computed for one is provably wrong for the other.
    const pool = [
      at("here-bar", "Bar", HERE),
      at("far-bar", "Bar", FAR),
      at("here-eat", "Restaurant", HERE),
      at("far-eat", "Restaurant", FAR),
    ];
    const nightHere = [
      { venue: at("h1", "Restaurant", HERE), role: "Start" as const },
      { venue: at("h2", "Bar", HERE), role: "Then" as const },
    ];
    const nightFar = [
      { venue: at("f1", "Restaurant", FAR), role: "Start" as const },
      { venue: at("f2", "Bar", FAR), role: "Then" as const },
    ];
    const [, thenHere] = alternativesFor(pool, nightHere, EVENING);
    const [, thenFar] = alternativesFor(pool, nightFar, EVENING);

    expect(thenHere.map((v) => v.id)).toEqual(["here-bar"]);
    expect(thenFar.map((v) => v.id)).toEqual(["far-bar"]);
    // Stated as the invariant rather than as two coincidences: reusing one
    // night's options for the other would offer an unwalkable swap.
    expect(thenHere).not.toEqual(thenFar);
  });

  it("respects opening hours at that stop's own arrival time", () => {
    const noon = new Date(2026, 5, 10, 12, 0);
    const day = noon.getDay();
    const morningOnly: OpeningHours = {
      periods: [
        {
          open: { day, hour: 9, minute: 0 },
          close: { day, hour: 11, minute: 0 },
        },
      ],
    };
    const stops = [
      { venue: at("in-start", "Restaurant", HERE), role: "Start" as const },
      {
        venue: at("in-then", "Bar", HERE),
        role: "Then" as const,
        arriveAt: noon,
      },
    ];
    const pool = [
      ...stops.map((s) => s.venue),
      at("open-bar", "Bar", HERE),
      at("shut-bar", "Bar", HERE, { openingHours: morningOnly }),
    ];
    const [, forThen] = alternativesFor(pool, stops, {
      ...EVENING,
      when: noon,
    });
    expect(forThen.map((v) => v.id)).toContain("open-bar");
    expect(forThen.map((v) => v.id)).not.toContain("shut-bar");
  });

  it("caps the list so the control stays a short cycle, best first", () => {
    const stops = stopsAt(HERE);
    const pool = [
      ...stops.map((s) => s.venue),
      // 12 candidates, descending rating — more than the cap.
      ...Array.from({ length: 12 }, (_, i) =>
        at(`bar-${i}`, "Bar", HERE, { rating: 5 - i * 0.1 }),
      ),
    ];
    const [, forThen] = alternativesFor(pool, stops, EVENING);
    expect(forThen).toHaveLength(8);
    expect(forThen[0].id).toBe("bar-0"); // highest rated first
  });

  it("offers everything role-matching when the night has a single stop", () => {
    // No other stops means no walkability anchor — the constraint must not
    // collapse to "nothing qualifies".
    const stops = [
      { venue: at("only", "Restaurant", HERE), role: "Start" as const },
    ];
    const pool = [stops[0].venue, at("other-eat", "Restaurant", FAR)];
    const [forOnly] = alternativesFor(pool, stops, EVENING);
    expect(forOnly.map((v) => v.id)).toEqual(["other-eat"]);
  });
});

describe("computePlan delegates to alternativesFor", () => {
  it("its own options obey the same walkability rule", () => {
    // Guards the refactor from the other side: computePlan no longer computes
    // alternatives itself, so this pins that its output still satisfies the
    // property its callers depend on.
    const venues = [
      at("eat-1", "Restaurant", HERE),
      at("bar-1", "Bar", HERE),
      at("music-1", "Live Music", HERE),
      at("bar-2", "Bar", NEAR),
      at("bar-far", "Bar", FAR),
    ];
    const plan = computePlan(venues, {
      area: { kind: "anywhere" as const },
      vibe: "Chill",
      budget: "Any",
      daypart: "evening",
    });
    expect(plan.steps.length).toBeGreaterThan(0);
    const chosen = new Set(plan.steps.map((s) => s.venue.id));
    for (const list of plan.alternatives) {
      for (const v of list) {
        expect(chosen.has(v.id)).toBe(false);
        expect(v.id).not.toBe("bar-far");
      }
    }
  });
});
