import { describe, it, expect, beforeEach } from "vitest";
import {
  NIGHT_PLAN_VERSION,
  fromEnginePlan,
  fromSavedRow,
  toSavedSteps,
  hydrateStops,
  parseNightPlan,
  totalMins,
  isFresh,
  type NightPlan,
} from "@/lib/night-plan";
import {
  activePlanKey,
  readActivePlan,
  writeActivePlan,
  clearActivePlan,
  claimAnonPlan,
  memoryStorage,
  type StorageLike,
} from "@/lib/active-plan";

const plan = (over: Partial<NightPlan> = {}): NightPlan => ({
  version: NIGHT_PLAN_VERSION,
  createdAt: new Date().toISOString(),
  title: "A Chill Soho Night",
  area: "Soho",
  vibe: "Chill",
  budget: "££",
  daypart: "evening",
  startsAt: "2026-08-01T19:00:00.000Z",
  stops: [
    {
      venueId: "v1",
      slug: "one",
      role: "Start",
      dwellMins: 60,
      walkToNextMins: 8,
    },
    {
      venueId: "v2",
      slug: "two",
      role: "Finish",
      dwellMins: 90,
      walkToNextMins: null,
    },
  ],
  source: "generated",
  savedRowId: null,
  ...over,
});

describe("NightPlan · the canonical shape", () => {
  it("🧨 the ADAPTER strips venue data, not just the fixture (the anon moat)", () => {
    // The first version of this test stringified a hand-written fixture and
    // inspected its keys, so it asserted nothing about adapter output: it
    // would have stayed green while fromEnginePlan started embedding whole
    // catalogue rows into a structure a signed-OUT browser persists.
    // Poison a real engine venue and check what survives the adapter.
    const poisoned = {
      id: "v1",
      slug: "one",
      name: "The Venue",
      vibeTags: ["SECRET-TAG"],
      long_description: "SECRET-DESCRIPTION",
      reviews: ["SECRET-REVIEW"],
      phone: "SECRET-PHONE",
      openingHours: { mon: "SECRET-HOURS" },
    };
    const np = fromEnginePlan(
      {
        area: "Soho",
        vibe: "Chill",
        budget: "££",
        daypart: "evening",
        steps: [
          {
            venue: poisoned as unknown as { id: string; slug: string },
            role: "Start",
            dwellMins: 60,
            walkToNextMins: null,
            arriveAt: null,
          },
        ],
      },
      { title: "t" },
    );
    const json = JSON.stringify(np);
    for (const secret of [
      "SECRET-TAG",
      "SECRET-DESCRIPTION",
      "SECRET-REVIEW",
      "SECRET-PHONE",
      "SECRET-HOURS",
      "The Venue",
    ]) {
      expect(json).not.toContain(secret);
    }
    // …and the same for what goes to the database.
    expect(JSON.stringify(toSavedSteps(np))).not.toContain("SECRET");
    expect(Object.keys(np.stops[0]).sort()).toEqual([
      "dwellMins",
      "role",
      "slug",
      "venueId",
      "walkToNextMins",
    ]);
  });

  it("survives a JSON round trip unchanged", () => {
    const p = plan();
    expect(parseNightPlan(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  it("totals dwell plus walking", () => {
    expect(totalMins(plan())).toBe(60 + 8 + 90);
  });
});

describe("parseNightPlan · the trust boundary", () => {
  it("rejects anything structurally wrong rather than throwing", () => {
    // localStorage is user-writable and jsonb was written by older code, so
    // both are untrusted input. A corrupt night must degrade to "no active
    // plan", never to a crashed /plan route.
    for (const bad of [
      null,
      undefined,
      42,
      "a string",
      {},
      { ...plan(), version: 99 },
      { ...plan(), createdAt: undefined },
      { ...plan(), createdAt: 12345 },
      { ...plan(), stops: [] },
      { ...plan(), stops: "not an array" },
      { ...plan(), vibe: "Rowdy" },
      { ...plan(), budget: "£££" },
      { ...plan(), daypart: "afternoon" },
      { ...plan(), startsAt: 1234 },
      { ...plan(), source: "imported" },
      {
        ...plan(),
        stops: [
          {
            venueId: "v1",
            slug: "one",
            role: "Middle",
            dwellMins: 1,
            walkToNextMins: null,
          },
        ],
      },
      {
        ...plan(),
        stops: [
          {
            venueId: "",
            slug: "one",
            role: "Start",
            dwellMins: 1,
            walkToNextMins: null,
          },
        ],
      },
    ]) {
      expect(parseNightPlan(bad)).toBeNull();
    }
  });

  it("accepts a valid night", () => {
    expect(parseNightPlan(plan())).not.toBeNull();
  });
});

describe("adapters", () => {
  it("engine plan -> canonical, taking the start time from the first arrival", () => {
    const np = fromEnginePlan(
      {
        area: "Shoreditch",
        vibe: "Lively",
        budget: "£",
        daypart: "evening",
        steps: [
          {
            venue: { id: "a", slug: "alpha" },
            role: "Start",
            dwellMins: 45,
            walkToNextMins: 5,
            arriveAt: new Date("2026-08-01T18:30:00.000Z"),
          },
          {
            venue: { id: "b", slug: "beta" },
            role: "Finish",
            dwellMins: 60,
            walkToNextMins: null,
            arriveAt: new Date("2026-08-01T19:20:00.000Z"),
          },
        ],
      },
      { title: "Big Night" },
    );
    expect(np.startsAt).toBe("2026-08-01T18:30:00.000Z");
    expect(np.stops.map((s) => s.slug)).toEqual(["alpha", "beta"]);
    expect(np.source).toBe("generated");
    expect(parseNightPlan(np)).not.toBeNull();
  });

  it("a server render with no clock yields startsAt null, not a crash", () => {
    const np = fromEnginePlan(
      {
        area: "Soho",
        vibe: "Chill",
        budget: "Any",
        daypart: "day",
        steps: [
          {
            venue: { id: "a", slug: "alpha" },
            role: "Start",
            dwellMins: 30,
            walkToNextMins: null,
            arriveAt: null,
          },
        ],
      },
      { title: "Quiet one" },
    );
    expect(np.startsAt).toBeNull();
    expect(parseNightPlan(np)).not.toBeNull();
  });

  it("🧨 reads a LEGACY saved row · the six already in production", () => {
    // Written before this model: no slug, no vibe, no budget, no daypart.
    const np = fromSavedRow(
      {
        id: "row-1",
        title: "A Lively Soho Night",
        neighbourhood: "Soho",
        steps: [
          { venueId: "v1", role: "Start", dwellMins: 60, walkToNextMins: 10 },
          {
            venueId: "v2",
            role: "Finish",
            dwellMins: 75,
            walkToNextMins: null,
          },
        ],
      },
      { vibe: "Chill", budget: "Any" },
    );
    expect(np).not.toBeNull();
    expect(np!.stops).toHaveLength(2);
    expect(np!.stops[0].slug).toBe(""); // honest about what is missing
    expect(np!.vibe).toBe("Chill"); // supplied default, not invented
    expect(np!.savedRowId).toBe("row-1");
    expect(np!.source).toBe("saved");
    expect(parseNightPlan(np)).not.toBeNull();
  });

  it("keeps the daypart inference openSaved has always used", () => {
    const day = fromSavedRow(
      {
        id: "r",
        title: "A Chill Soho Day Out",
        neighbourhood: "Soho",
        steps: [
          { venueId: "v", role: "Start", dwellMins: 1, walkToNextMins: null },
        ],
      },
      { vibe: "Chill", budget: "Any" },
    );
    const night = fromSavedRow(
      {
        id: "r",
        title: "A Chill Soho Night",
        neighbourhood: "Soho",
        steps: [
          { venueId: "v", role: "Start", dwellMins: 1, walkToNextMins: null },
        ],
      },
      { vibe: "Chill", budget: "Any" },
    );
    expect(day!.daypart).toBe("day");
    expect(night!.daypart).toBe("evening");
  });

  it("returns null for a row with no usable stops instead of an empty night", () => {
    for (const steps of [
      [],
      "nonsense",
      null,
      [{ venueId: 5, role: "Start" }],
    ]) {
      expect(
        fromSavedRow(
          { id: "r", title: "t", neighbourhood: "n", steps },
          { vibe: "Chill", budget: "Any" },
        ),
      ).toBeNull();
    }
  });

  it("🧨 toSavedSteps stays an ARRAY with the four legacy keys intact", () => {
    // A row written today must still be readable by code that predates this
    // model, and by the account-data export. `slug` is additive only.
    const steps = toSavedSteps(plan());
    expect(Array.isArray(steps)).toBe(true);
    for (const s of steps) {
      expect(s).toHaveProperty("venueId");
      expect(s).toHaveProperty("role");
      expect(s).toHaveProperty("dwellMins");
      expect(s).toHaveProperty("walkToNextMins");
    }
    // and it round-trips back through the legacy reader
    const back = fromSavedRow(
      { id: "r", title: plan().title, neighbourhood: plan().area, steps },
      { vibe: "Chill", budget: "££" },
    );
    expect(back!.stops.map((s) => s.venueId)).toEqual(["v1", "v2"]);
    expect(back!.stops[0].slug).toBe("one"); // the new key survives
  });
});

describe("hydrateStops", () => {
  const catalogue = new Map([
    ["v1", { id: "v1", name: "One" }],
    ["v2", { id: "v2", name: "Two" }],
  ]);
  const bySlugMap = new Map([["two", { id: "v2", name: "Two" }]]);
  const lookup = {
    byId: (id: string) => catalogue.get(id),
    bySlug: (slug: string) => bySlugMap.get(slug),
  };

  it("resolves by id", () => {
    const { stops, dropped } = hydrateStops(plan(), lookup);
    expect(stops.map((s) => s.venue.name)).toEqual(["One", "Two"]);
    expect(dropped).toBe(0);
  });

  it("falls back to slug when the id has gone stale", () => {
    // Ingest crons rebuild the catalogue; a night stored for weeks is exactly
    // where an id goes missing.
    const stale = plan({
      stops: [
        {
          venueId: "gone",
          slug: "two",
          role: "Start",
          dwellMins: 30,
          walkToNextMins: null,
        },
      ],
    });
    const { stops, dropped } = hydrateStops(stale, lookup);
    expect(stops).toHaveLength(1);
    expect(dropped).toBe(0);
  });

  it("🧨 REPORTS dropped stops rather than rendering a night with holes", () => {
    const partial = plan({
      stops: [
        {
          venueId: "v1",
          slug: "one",
          role: "Start",
          dwellMins: 30,
          walkToNextMins: 5,
        },
        {
          venueId: "vanished",
          slug: "also-gone",
          role: "Finish",
          dwellMins: 30,
          walkToNextMins: null,
        },
      ],
    });
    const { stops, dropped } = hydrateStops(partial, lookup);
    expect(stops).toHaveLength(1);
    expect(dropped).toBe(1);
  });
});

describe("isFresh · a stale night must not be presented as tonight", () => {
  it("accepts a night from this evening", () => {
    expect(isFresh(plan({ createdAt: new Date().toISOString() }))).toBe(true);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    expect(isFresh(plan({ createdAt: twoHoursAgo }))).toBe(true);
  });

  it("🧨 rejects last week's night", () => {
    // The legacy anon stash had a 1h TTL; the first draft of this model
    // dropped it, which would have rendered a three-week-old night under
    // "Tonight, the plan:" with stale opening hours.
    const lastWeek = new Date(
      Date.now() - 7 * 24 * 60 * 60 * 1000,
    ).toISOString();
    expect(isFresh(plan({ createdAt: lastWeek }))).toBe(false);
  });

  it("rejects a night from the future and an unparseable stamp", () => {
    // A device clock that has gone backwards must not make a night immortal.
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    expect(isFresh(plan({ createdAt: future }))).toBe(false);
    expect(isFresh(plan({ createdAt: "not a date" }))).toBe(false);
  });
});

describe("the active-plan store", () => {
  let store: StorageLike;
  beforeEach(() => {
    store = memoryStorage();
  });

  it("survives a round trip", () => {
    // One instance, not two: the fixture stamps `createdAt` at call time, so
    // comparing plan() to plan() is a millisecond race.
    const p = plan();
    writeActivePlan("user-a", p, store);
    expect(readActivePlan("user-a", store)).toEqual(p);
  });

  it("🧨 one owner CANNOT read another's night (the shared-browser bleed)", () => {
    // PR #129's lesson: a context that does not reset on uuid -> null lets one
    // account's data show up for the next person on the same browser. Here the
    // owner is in the KEY, so the bleed is impossible rather than prevented.
    writeActivePlan("user-a", plan({ title: "A's night" }), store);
    expect(readActivePlan("user-b", store)).toBeNull();
    expect(readActivePlan(null, store)).toBeNull();
    expect(activePlanKey("user-a")).not.toBe(activePlanKey("user-b"));
    expect(activePlanKey(null)).not.toBe(activePlanKey("user-a"));
  });

  it("drops a corrupt or future-version entry instead of failing forever", () => {
    store.setItem(activePlanKey(null), "{not json");
    expect(readActivePlan(null, store)).toBeNull();
    expect(store.getItem(activePlanKey(null))).toBeNull();

    store.setItem(
      activePlanKey(null),
      JSON.stringify({ ...plan(), version: 99 }),
    );
    expect(readActivePlan(null, store)).toBeNull();
    expect(store.getItem(activePlanKey(null))).toBeNull();
  });

  it("clears", () => {
    writeActivePlan(null, plan(), store);
    clearActivePlan(null, store);
    expect(readActivePlan(null, store)).toBeNull();
  });
});

describe("claimAnonPlan · sign in and keep the night you just built", () => {
  let store: StorageLike;
  beforeEach(() => {
    store = memoryStorage();
  });

  it("moves the anonymous night to the signed-in owner", () => {
    writeActivePlan(null, plan({ title: "Built signed out" }), store);
    const claimed = claimAnonPlan("user-a", store);
    expect(claimed?.title).toBe("Built signed out");
    expect(readActivePlan("user-a", store)?.title).toBe("Built signed out");
  });

  it("🧨 leaves NO copy behind for the next person on this browser", () => {
    writeActivePlan(null, plan(), store);
    claimAnonPlan("user-a", store);
    expect(readActivePlan(null, store)).toBeNull();
  });

  it("🧨 the anonymous night WINS over an older one in the owner slot", () => {
    // The user just built this and tapped Save. The owner slot can only have
    // been written before the sign-out that led here, so the anonymous night
    // is provably the newer one — and the one they made an account to keep.
    writeActivePlan(
      "user-a",
      plan({ title: "From before the sign-out" }),
      store,
    );
    writeActivePlan(
      null,
      plan({ title: "Just built, about to be saved" }),
      store,
    );
    expect(claimAnonPlan("user-a", store)?.title).toBe(
      "Just built, about to be saved",
    );
    expect(readActivePlan("user-a", store)?.title).toBe(
      "Just built, about to be saved",
    );
    expect(readActivePlan(null, store)).toBeNull();
  });

  it("is a no-op when there is nothing to claim", () => {
    expect(claimAnonPlan("user-a", store)).toBeNull();
  });

  it("marks the claimed night's source so the transfer is measurable", () => {
    writeActivePlan(null, plan({ source: "generated" }), store);
    expect(claimAnonPlan("user-a", store)?.source).toBe("anon");
  });
});
