import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
  clearAnonPlanKeys,
  anonPlanKeys,
  readUndoStack,
  writeUndoStack,
  clearUndoStack,
  undoStackKey,
  ANON_PLAN_STASH_KEY,
  ANON_RESULT_KEY,
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
  offset: 0,
  tracksClock: false,
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

describe("parseNightPlan · startsAt must be usable, not merely a string", () => {
  it("🧨 rejects an unparseable startsAt", () => {
    // `new Date("last tuesday")` is an Invalid Date, so every card renders
    // "arrive ~invalid date" — and because `NaN < Date.now()` is false, the
    // has-this-night-finished check can never fire to hide them. A string
    // typecheck alone let that straight through to the screen.
    expect(parseNightPlan({ ...plan(), startsAt: "last tuesday" })).toBeNull();
    expect(parseNightPlan({ ...plan(), startsAt: "" })).toBeNull();
  });

  it("accepts a real ISO instant, and null", () => {
    const iso = new Date("2026-07-30T19:30:00.000Z").toISOString();
    expect(parseNightPlan({ ...plan(), startsAt: iso })?.startsAt).toBe(iso);
    expect(parseNightPlan({ ...plan(), startsAt: null })?.startsAt).toBeNull();
  });
});

describe("🧨 the anon-key clear is wired to the sign-out TRANSITION", () => {
  // The unit tests above prove clearAnonPlanKeys WIPES the keys. They cannot
  // see WHERE IT IS CALLED FROM, and that is what was wrong: it was wired to
  // the two profile sign-out buttons, which a session expiry, a sign-out in
  // another tab, cleared cookies and a deleted account all bypass -- leaving
  // one person's night on the browser for the next one. A green unit test and
  // a live bleed at the same time, so the call site gets pinned too.
  const code = (rel: string) =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

  it("calls clearAnonPlanKeys INSIDE the isSignOutTransition block", () => {
    const src = code("../../components/auth-user-context.tsx");
    const block = src.match(
      /if\s*\(isSignOutTransition\([^)]*\)\)\s*\{([\s\S]*?)\n\s*\}/,
    );
    expect(
      block,
      "no isSignOutTransition block in auth-user-context",
    ).not.toBeNull();
    expect(block![1]).toContain("clearAnonPlanKeys()");
    // The departing account's OWN slot too. Without this line the fix for it
    // could be refactored away with the suite green — the same "green test,
    // live data left behind" shape this describe block exists for.
    expect(block![1]).toContain("clearActivePlan(prevIdRef.current)");
  });

  it("does not depend on the profile sign-out buttons", () => {
    // If this ever needs to come back, the transition above is still the
    // authority; a button is a convenience, never the guarantee.
    expect(code("../../app/(main)/profile/profile-body.tsx")).not.toContain(
      "clearAnonPlanKeys",
    );
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

  it("🧨 never looks a LEGACY empty slug up, it drops the stop", () => {
    // Rows written before `slug` was added to plans.steps adapt to slug: "".
    // Without the guard in hydrateStops that empty string reaches bySlug, and
    // a Map seeded from a catalogue where any venue has an empty slug — or any
    // lookup that treats "" as "first match" — resolves the WRONG VENUE into
    // someone's saved night, silently and with dropped === 0 so nothing warns.
    const calls: string[] = [];
    const { stops, dropped } = hydrateStops(
      plan({
        stops: [
          {
            venueId: "long-gone",
            slug: "",
            role: "Start",
            dwellMins: 30,
            walkToNextMins: null,
          },
        ],
      }),
      {
        byId: (id: string) => catalogue.get(id),
        bySlug: (slug: string) => {
          calls.push(slug);
          return { id: "wrong", name: "Wrong Venue" };
        },
      },
    );
    expect(calls).toEqual([]);
    expect(stops).toHaveLength(0);
    expect(dropped).toBe(1);
  });
});

describe("isFresh · a night is stale when it is OVER, not 12h after it was thought of", () => {
  const H = 60 * 60 * 1000;
  // The fixture's two stops are 60 + 8 + 90 mins = 158 mins of night.
  const NIGHT_MS = 158 * 60 * 1000;

  it("🧨 a RIGHT-NOW night is measured from createdAt, not from its stamp", () => {
    // Its `startsAt` is just when Build was tapped, and the UI re-anchors such
    // a night to the live clock on restore. Measuring staleness against the
    // stamp used a different clock from the one on screen: a night built at
    // 13:00 rendered "arrive ~4:50 pm" at 16:50 and was then deleted at 17:01
    // for having "ended". Freshness and the display must agree.
    const built = new Date("2026-07-30T13:00:00.000Z");
    const rightNow = plan({
      createdAt: built.toISOString(),
      startsAt: built.toISOString(),
      tracksClock: true,
    });
    // 3h58m later: past the stored start + the night's length, well inside 12h.
    const after = built.getTime() + NIGHT_MS + 60 * 60 * 1000;
    expect(isFresh(rightNow, after)).toBe(true);
    // ...and the 12h fallback still bounds it.
    expect(isFresh(rightNow, built.getTime() + 13 * H)).toBe(false);
  });

  it("a CHOSEN time is still measured from the stamp", () => {
    // The other half of the same rule: a night the user picked a time for goes
    // stale when that night is over, whatever the TTL says.
    const start = new Date("2026-07-30T19:00:00.000Z");
    const chosen = plan({
      createdAt: new Date(start.getTime() - H).toISOString(),
      startsAt: start.toISOString(),
      tracksClock: false,
    });
    expect(isFresh(chosen, start.getTime() + NIGHT_MS - 60_000)).toBe(true);
    expect(isFresh(chosen, start.getTime() + NIGHT_MS + 60_000)).toBe(false);
  });

  it("🧨 a night planned for LATER stays fresh, however long ago it was built", () => {
    // "Pick a day" invites planning ahead. Anchored only to createdAt, a night
    // made on Thursday for next Saturday was deleted on Friday morning —
    // before the night it was made for — and the claim refused it, so the
    // anon-to-account conversion this branch exists for could not happen.
    const nextSaturday = new Date(Date.now() + 3 * 24 * H).toISOString();
    const builtThreeDaysAgo = new Date(Date.now() - 3 * 24 * H).toISOString();
    expect(
      isFresh(plan({ startsAt: nextSaturday, createdAt: builtThreeDaysAgo })),
    ).toBe(true);
  });

  it("🧨 rejects an absurd future start rather than living forever", () => {
    // localStorage is editable by hand, so the server's now+7d clamp says
    // nothing about what is on disk. Unbounded, `now < start + duration`
    // would make a stamp of the year 3000 permanently fresh.
    const yearsAway = new Date(Date.now() + 400 * 24 * H).toISOString();
    expect(isFresh(plan({ startsAt: yearsAway }))).toBe(false);
    // ...but a legitimate week-ahead plan is still fine.
    const nextWeek = new Date(Date.now() + 6 * 24 * H).toISOString();
    expect(isFresh(plan({ startsAt: nextWeek }))).toBe(true);
  });

  it("tracksClock is off unless the writer asks for it", () => {
    // Older entries have no such field. `false` keeps their behaviour (pin the
    // stored start) instead of silently re-dating them to now.
    const legacy = parseNightPlan({ ...plan(), tracksClock: undefined });
    expect(legacy?.tracksClock).toBe(false);
    expect(parseNightPlan({ ...plan(), tracksClock: "yes" })?.tracksClock).toBe(
      false,
    );
    expect(parseNightPlan({ ...plan(), tracksClock: true })?.tracksClock).toBe(
      true,
    );
  });

  it("a night in progress keeps its remaining stops", () => {
    const anHourIn = new Date(Date.now() - 1 * H).toISOString();
    expect(isFresh(plan({ startsAt: anHourIn }))).toBe(true);
  });

  it("🧨 rejects a night that has already finished, however recently built", () => {
    // Build a day out at 13:00; it ends at 17:00. At 19:00 you open Plan to
    // sort the EVENING — and used to land on this afternoon's finished day out
    // under "Today, the plan:", because it was only six hours old.
    const over = new Date(Date.now() - NIGHT_MS - 1 * H).toISOString();
    expect(
      isFresh(plan({ startsAt: over, createdAt: new Date().toISOString() })),
    ).toBe(false);
  });

  describe("with no start time, createdAt is the fallback", () => {
    const noClock = (over = {}) => plan({ startsAt: null, ...over });

    it("accepts a night from this evening", () => {
      expect(isFresh(noClock({ createdAt: new Date().toISOString() }))).toBe(
        true,
      );
      expect(
        isFresh(
          noClock({ createdAt: new Date(Date.now() - 2 * H).toISOString() }),
        ),
      ).toBe(true);
    });

    it("🧨 rejects last week's night", () => {
      // The legacy anon stash had a 1h TTL; the first draft of this model
      // dropped it, which would have rendered a three-week-old night under
      // "Tonight, the plan:" with stale opening hours.
      const lastWeek = new Date(Date.now() - 7 * 24 * H).toISOString();
      expect(isFresh(noClock({ createdAt: lastWeek }))).toBe(false);
    });

    it("rejects a night from the future and an unparseable stamp", () => {
      // A device clock that has gone backwards must not make a night immortal.
      expect(
        isFresh(noClock({ createdAt: new Date(Date.now() + H).toISOString() })),
      ).toBe(false);
      expect(isFresh(noClock({ createdAt: "not a date" }))).toBe(false);
    });
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

  it("🧨 anonPlanKeys() lists EVERY anon key the module defines", () => {
    // 🧨 The behavioural tests below derive from anonPlanKeys(), so they cannot
    // notice a key that was never added to it — delete an entry and they stay
    // green, because the check shrinks with the code. Measured: dropping the
    // undo key from the list left all 39 passing. This reads the module's
    // source instead, so the two cannot shrink together.
    const src = readFileSync(
      fileURLToPath(new URL("../active-plan.ts", import.meta.url)),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    // Every anon-scoped storage key this module defines, by its literal.
    const defined = [...src.matchAll(/=\s*"(fl[.:][^"]+)"/g)].map((m) => m[1]);
    expect(defined.length).toBeGreaterThan(2);
    const listed = anonPlanKeys().join("|");
    for (const key of defined) {
      expect(
        listed,
        `"${key}" is defined in active-plan.ts but is not in anonPlanKeys(). The next person on this browser inherits it`,
      ).toContain(key);
    }
  });

  it("🧨 leaves NO copy behind for the next person on this browser", () => {
    // Asserted over EVERY anon-scoped key, not just the store's own slot.
    // The narrow version of this test passed while a second anon key — added
    // elsewhere, for the signed-out result screen — survived the claim, the
    // sign-out, and was rehydrated onto the next visitor. A guard that only
    // checks the key it owns cannot see the key it does not.
    // 🧨 Over anonPlanKeys(), not over a list this test maintains. The
    // hand-written version stayed green when a fourth anon key was added and
    // not swept — the same class of miss it was written to prevent.
    writeActivePlan(null, plan(), store);
    for (const k of anonPlanKeys()) store.setItem(k, '{"seeded":true}');
    writeActivePlan(null, plan(), store); // real entry in the canonical slot
    claimAnonPlan("user-a", store);
    expect(readActivePlan(null, store)).toBeNull();
    for (const k of anonPlanKeys()) {
      expect(store.getItem(k), `${k} survived the claim`).toBeNull();
    }
  });

  it("🧨 clearAnonPlanKeys wipes every anon key, for sign-out", () => {
    for (const k of anonPlanKeys()) store.setItem(k, '{"seeded":true}');
    writeActivePlan(null, plan(), store);
    clearAnonPlanKeys(store);
    expect(readActivePlan(null, store)).toBeNull();
    for (const k of anonPlanKeys()) {
      expect(store.getItem(k), `${k} survived sign-out`).toBeNull();
    }
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

describe("the undo store", () => {
  let store: ReturnType<typeof memoryStorage>;
  beforeEach(() => {
    store = memoryStorage();
  });
  const entry = (ids: string[]) => ({
    stops: ids.map((id) => ({ venueId: id, slug: id, role: "Start" })),
    cycle: {},
  });

  it("🧨 round-trips: written under a signature, read back under the same one", () => {
    // This is the test whose absence let the whole feature ship as a no-op.
    // The signature was derived from the night's CURRENT stops, which move
    // when a stop is replaced, so nothing written was ever readable again —
    // and the failed read then deleted it. Green the entire time, because
    // nothing exercised the round trip.
    writeUndoStack("user-a", "night-1", [entry(["v1", "v2"])], store);
    const back = readUndoStack("user-a", "night-1", store);
    expect(back).toHaveLength(1);
    expect(back[0].stops.map((s) => s.venueId)).toEqual(["v1", "v2"]);
  });

  it("🧨 refuses a history belonging to a different night", () => {
    writeUndoStack("user-a", "night-1", [entry(["v1"])], store);
    expect(readUndoStack("user-a", "night-2", store)).toEqual([]);
  });

  it("🧨 does not hand one owner's history to another", () => {
    writeUndoStack("user-a", "night-1", [entry(["v1"])], store);
    expect(readUndoStack("user-b", "night-1", store)).toEqual([]);
    expect(readUndoStack(null, "night-1", store)).toEqual([]);
  });

  it("an empty stack clears the key rather than storing nothing", () => {
    writeUndoStack("user-a", "night-1", [entry(["v1"])], store);
    writeUndoStack("user-a", "night-1", [], store);
    expect(store.getItem(undoStackKey("user-a"))).toBeNull();
  });

  it("drops entries with an unusable stop rather than restoring a hole", () => {
    store.setItem(
      undoStackKey("user-a"),
      JSON.stringify({
        v: 1,
        sig: "night-1",
        entries: [
          entry(["v1"]),
          { stops: [{ venueId: "", slug: "", role: "Start" }], cycle: {} },
        ],
      }),
    );
    const back = readUndoStack("user-a", "night-1", store);
    expect(back).toHaveLength(1);
  });

  it("🧨 refuses an unknown role and a malformed cycle", () => {
    // localStorage is a trust boundary. An unknown role was cast straight to
    // PlanRole; a non-array cycle throws inside the rotation and kills Change.
    store.setItem(
      undoStackKey("user-a"),
      JSON.stringify({
        v: 1,
        sig: "night-1",
        entries: [
          {
            stops: [{ venueId: "v1", slug: "v1", role: "Nonsense" }],
            cycle: {},
          },
          { stops: [{ venueId: "v2", slug: "v2", role: "Start" }], cycle: 7 },
          { stops: [{ venueId: "v3", slug: "v3", role: "Start" }], cycle: {} },
        ],
      }),
    );
    const back = readUndoStack("user-a", "night-1", store);
    expect(back).toHaveLength(1);
    expect(back[0].stops[0].venueId).toBe("v3");
  });

  it("survives corrupt or foreign-version JSON without throwing", () => {
    store.setItem(undoStackKey("user-a"), "{not json");
    expect(readUndoStack("user-a", "night-1", store)).toEqual([]);
    store.setItem(
      undoStackKey("user-a"),
      JSON.stringify({ v: 99, sig: "night-1", entries: [] }),
    );
    expect(readUndoStack("user-a", "night-1", store)).toEqual([]);
  });

  it("🧨 clearUndoStack takes the departing owner's history with them", () => {
    writeUndoStack("user-a", "night-1", [entry(["v1"])], store);
    clearUndoStack("user-a", store);
    expect(readUndoStack("user-a", "night-1", store)).toEqual([]);
  });
});
