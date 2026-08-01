import { describe, it, expect } from "vitest";
import {
  alternativesFor,
  computePlan,
  withinWalkOfAny,
  walkMins,
} from "@/lib/plan-engine";
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

  it("🧨 anchors a single-stop night on the stop itself, not on nothing", () => {
    // This used to assert the opposite — that a lone stop has no anchor and so
    // every role match qualifies. That is how a Richmond night's only stop
    // could be replaced by a restaurant in Soho: an empty neighbour list makes
    // the walk rule vacuously true. A one-stop night is a real state (the
    // engine leaves a role unfilled rather than teleport), so the stop being
    // replaced is its own anchor.
    const stops = [
      { venue: at("only", "Restaurant", HERE), role: "Start" as const },
    ];
    const near = at("near-eat", "Restaurant", NEAR);
    const far = at("far-eat", "Restaurant", FAR);
    const [forOnly] = alternativesFor(
      [stops[0].venue, near, far],
      stops,
      EVENING,
    );
    expect(forOnly.map((v) => v.id)).toContain("near-eat");
    expect(forOnly.map((v) => v.id)).not.toContain("far-eat");
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

describe("🧨 sequential replacements stay walkable", () => {
  // The defect this closes: options anchored to the night's ORIGINAL stops
  // measured stop 2's candidates against the original stop 1. Once stop 1 had
  // itself moved up to the radius away, the two could end up roughly twice
  // that apart — and relinkSteps reported it honestly, so a walkable-night
  // product printed "~26 min walk" on its own result screen.
  //
  // These build a chain deliberately: every venue sits 1.2 km from the last,
  // inside the 1.6 km rule pairwise, so anchoring to the base lets a night
  // walk itself off down the line while each individual hop looks legal.
  const KM = 1 / 111; // ~1 degree of latitude per 111 km
  const chain = (n: number, type: Venue["type"], role: string) =>
    Array.from({ length: n }, (_, i) =>
      at(`${role}-${i}`, type, {
        lat: HERE.lat + i * 1.2 * KM,
        lng: HERE.lng,
      }),
    );

  const pool = [
    ...chain(6, "Restaurant", "eat"),
    ...chain(6, "Bar", "bar"),
    ...chain(6, "Live Music", "music"),
  ];

  /** Replace stop `i` with the first option that is not already in the night,
   *  exactly as the UI does: options recomputed against the CURRENT stops. */
  const replace = (
    stops: { venue: Venue; role: Venue extends never ? never : any }[],
    i: number,
  ) => {
    const opts = alternativesFor(pool, stops, EVENING)[i];
    if (!opts?.length) return null;
    return stops.map((s, j) => (j === i ? { ...s, venue: opts[0] } : s));
  };

  const walkable = (stops: { venue: Venue }[]) =>
    stops.every((s, i) => {
      const others = stops.filter((_, j) => j !== i).map((x) => x.venue);
      return withinWalkOfAny(s.venue, others);
    });

  it("no replacement in a long sequence drifts outside the walking rule", () => {
    let stops: { venue: Venue; role: "Start" | "Then" | "Finish" }[] = [
      { venue: at("s0", "Restaurant", HERE), role: "Start" },
      { venue: at("s1", "Bar", HERE), role: "Then" },
      { venue: at("s2", "Live Music", HERE), role: "Finish" },
    ];
    expect(walkable(stops)).toBe(true);

    // Twelve replacements, cycling across all three stops.
    for (let n = 0; n < 12; n++) {
      const i = n % 3;
      const next = replace(stops, i);
      if (!next) continue;
      stops = next as typeof stops;
      // The invariant, checked after EVERY step rather than only at the end:
      // each stop is within a short walk of at least one other.
      expect(walkable(stops), `broke after replacement ${n + 1}`).toBe(true);
    }
  });

  it("🧨 the adjacent hop never blows out, which is what the user sees", () => {
    // withinWalkOfAny only requires ONE near neighbour, so it alone cannot
    // catch a middle stop stranded between two far ones. This asserts the
    // thing the screen actually prints: the walk between consecutive stops.
    let stops: { venue: Venue; role: "Start" | "Then" | "Finish" }[] = [
      { venue: at("s0", "Restaurant", HERE), role: "Start" },
      { venue: at("s1", "Bar", HERE), role: "Then" },
      { venue: at("s2", "Live Music", HERE), role: "Finish" },
    ];
    for (let n = 0; n < 12; n++) {
      const next = replace(stops, n % 3);
      if (!next) continue;
      stops = next as typeof stops;
      for (let i = 0; i < stops.length - 1; i++) {
        expect(
          walkMins(stops[i].venue, stops[i + 1].venue),
          `stop ${i}→${i + 1} after replacement ${n + 1}`,
        ).toBeLessThanOrEqual(45);
      }
    }
  });

  it("🧨 a MIDDLE stop must be walkable with BOTH neighbours, not either one", () => {
    // The rule this pins is `withinWalkOfAll` over the ADJACENT stops. The
    // any-rule looks equivalent and is not, and the first version of this
    // suite could not tell them apart: its fixture scored every candidate
    // identically, so pool order always surfaced the near one and the far one
    // was never reached. Here the far candidate is deliberately the BEST
    // ranked, so an any-rule would put it at the head of the list.
    //
    // s0 --1.2km-- s1 --1.2km-- s2, and a candidate 0.1km from s0, i.e. 2.3km
    // from s2. Near one neighbour, far from the other.
    const KM = 1 / 111;
    const s0 = at("s0", "Restaurant", HERE);
    const s1 = at("s1", "Bar", { lat: HERE.lat + 1.2 * KM, lng: HERE.lng });
    const s2 = at("s2", "Live Music", {
      lat: HERE.lat + 2.4 * KM,
      lng: HERE.lng,
    });
    const nearS0Only = at(
      "near-s0-only",
      "Bar",
      { lat: HERE.lat + 0.1 * KM, lng: HERE.lng },
      { rating: 5 }, // outranks everything, so ordering cannot hide it
    );
    const betweenBoth = at(
      "between-both",
      "Bar",
      { lat: HERE.lat + 1.3 * KM, lng: HERE.lng },
      { rating: 3 },
    );
    const stops = [
      { venue: s0, role: "Start" as const },
      { venue: s1, role: "Then" as const },
      { venue: s2, role: "Finish" as const },
    ];
    const [, forMiddle] = alternativesFor(
      [s0, s1, s2, nearS0Only, betweenBoth],
      stops,
      EVENING,
    );
    // Walkable with both ends: offered.
    expect(forMiddle.map((v) => v.id)).toContain("between-both");
    // Walkable with only ONE end, and top-ranked: must still be refused.
    // Under the any-rule this is `forMiddle[0]`.
    expect(forMiddle.map((v) => v.id)).not.toContain("near-s0-only");
  });

  it("options are measured against the CURRENT neighbours, not the originals", () => {
    // Directly: move stop 0 far along the chain, then ask for stop 1's
    // options. Every one must be walkable with stop 0 WHERE IT NOW IS.
    const stops = [
      { venue: pool.find((v) => v.id === "eat-4")!, role: "Start" as const },
      { venue: at("s1", "Bar", HERE), role: "Then" as const },
    ];
    const opts = alternativesFor(pool, stops, EVENING)[1];
    expect(opts.length).toBeGreaterThan(0);
    for (const v of opts) {
      expect(
        withinWalkOfAny(v, [stops[0].venue]),
        `${v.id} is not walkable with the CURRENT stop 0`,
      ).toBe(true);
    }
  });
});
