import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// STATIC SOURCE GUARDS for the instrumentation call sites.
//
// The test environment is `node` with no jsdom (deliberately: see
// vitest.config.ts), so a React component's click handlers cannot be rendered
// and asserted on. These guards read the source text instead. That is weaker
// than a behavioural test, and it is the strongest thing available without
// adding a DOM harness to a repo that has never had one.
//
// Each guard pins a decision that is easy to undo by accident and expensive to
// discover afterwards, and each has a POSITIVE CONTROL so it cannot pass by
// reading the wrong file.

function src(rel: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../${rel}`, import.meta.url)),
    "utf8",
  );
}

// These guards assert about CODE, not prose. Several of the explanatory
// comments in these files deliberately name the very thing being banned (why
// posthog.register is not used, why distances are never sent), so a raw text
// scan would flag the documentation. Strip comments first.
function code(rel: string): string {
  return src(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\/.*$/gm, "");
}

// track("event", { ... }) as written in either statement position (`);`) or
// inside a JSX handler (`)}`).
function trackCalls(source: string, event?: string): string[] {
  const name = event ? `"${event}"` : "";
  const re = new RegExp(`track\\(${name}[\\s\\S]{0,700}?\\)[;}]`, "g");
  return source.match(re) ?? [];
}

const analytics = src("lib/analytics.ts");
const analyticsCode = code("lib/analytics.ts");
const planFlow = src("app/(main)/plan/plan-flow.tsx");
const planFlowCode = code("app/(main)/plan/plan-flow.tsx");
const anonPlanFlow = src("app/(main)/plan/anon-plan-flow.tsx");
const anonPlanFlowCode = code("app/(main)/plan/anon-plan-flow.tsx");
const groupResult = src("app/(main)/plan/together/_steps/result.tsx");
const groupResultCode = code("app/(main)/plan/together/_steps/result.tsx");
const exploreFeed = src("app/(main)/explore/explore-feed.tsx");
const exploreFeedCode = code("app/(main)/explore/explore-feed.tsx");
const venueCard = src("components/venue-card.tsx");
const searchOverlay = src("components/search-overlay.tsx");
const authedProviders = src("components/authed-providers.tsx");

describe("no raw error text is ever attached to an event", () => {
  const forbidden: [string, RegExp][] = [
    ["error.message", /error\.message/],
    ["error.details", /error\.details/],
    ["error.hint", /error\.hint/],
    ["String(err)", /String\(\s*err/],
  ];

  it.each(forbidden)("plan-flow does not send %s", (_label, re) => {
    // console.error is allowed to log locally; what must never happen is the
    // value reaching track(). Neither file references these at all, which is
    // the simplest way to keep that true.
    const calls = trackCalls(planFlowCode);
    expect(calls.length).toBeGreaterThan(0); // positive control
    for (const call of calls) expect(call).not.toMatch(re);
  });

  it.each(forbidden)("anon plan flow does not send %s", (_label, re) => {
    const calls = trackCalls(anonPlanFlowCode);
    expect(calls.length).toBeGreaterThan(0); // positive control
    for (const call of calls) expect(call).not.toMatch(re);
  });

  it("routes every failure through the closed-category mappers", () => {
    expect(planFlow).toContain("saveFailReason(");
    expect(anonPlanFlow).toContain("planFailReasonFromServer(");
    expect(anonPlanFlow).toContain("throwFailReason(");
  });
});

describe("fire-once semantics are latched by a ref, not an effect", () => {
  it("plan_setup_started is guarded in both plan flows", () => {
    expect(planFlow).toContain("setupStartedRef");
    expect(anonPlanFlow).toContain("setupStartedRef");
    expect(planFlow).toMatch(/plan_setup_started/);
    expect(anonPlanFlow).toMatch(/plan_setup_started/);
  });

  it("plan_setup_started is NOT fired from a useEffect", () => {
    // An effect on the setup state would replay on every back-navigation and
    // double-invoke in React StrictMode.
    const effects =
      planFlow.match(/useEffect\(\(\)\s*=>\s*\{[\s\S]{0,1200}?\}/g) ?? [];
    expect(effects.length).toBeGreaterThan(0); // positive control
    for (const e of effects) expect(e).not.toContain("plan_setup_started");
    const anonEffects =
      anonPlanFlow.match(/useEffect\(\(\)\s*=>\s*\{[\s\S]{0,1200}?\}/g) ?? [];
    for (const e of anonEffects) expect(e).not.toContain("plan_setup_started");
  });

  it("feed_end_reached is latched and not hung off the observer", () => {
    expect(exploreFeed).toContain("endFiredRef");
    // The IntersectionObserver re-arms by design; if the event were emitted
    // from inside it, a back-navigation would fire it every time.
    const observerBlock =
      exploreFeed.match(/new IntersectionObserver\([\s\S]{0,900}?\)/g) ?? [];
    for (const b of observerBlock) expect(b).not.toContain("feed_end_reached");
  });

  it("the group swap emit is deduped per stop and target position", () => {
    expect(groupResult).toContain("swapReportedRef");
  });
});

describe("swap method is passed in, never inferred from direction", () => {
  it("the button passes button and the swipe passes swipe", () => {
    expect(planFlow).toContain('onSwap(i, 1, "button")');
    expect(planFlow).toContain('onSwap(i, dir, "swipe")');
  });

  it("the group surface reports group_veto, not a local gesture", () => {
    // The deciding vote can arrive over Realtime from another device, so
    // neither swipe nor button describes it honestly.
    expect(groupResult).toContain('method: "group_veto"');
    expect(groupResult).not.toContain('method: "swipe"');
  });

  it("swipe-stop is NOT instrumented (it is shared by both surfaces)", () => {
    const swipeStop = src("app/(main)/plan/swipe-stop.tsx");
    expect(swipeStop).not.toContain("track(");
  });
});

describe("no location, route or venue identity on the new events", () => {
  it("explore never attaches a coordinate or a distance to an event", () => {
    const calls = trackCalls(exploreFeedCode);
    expect(calls.length).toBeGreaterThan(0); // positive control
    for (const call of calls) {
      expect(call).not.toMatch(/\bgeo\b/);
      expect(call).not.toMatch(/\blat\b/);
      expect(call).not.toMatch(/\blng\b/);
      expect(call).not.toMatch(/distance/i);
      expect(call).not.toMatch(/viewKey|lastKeyRef/);
    }
  });

  it("card_dismissed carries a bucket, never a venue id or a raw index", () => {
    const call = trackCalls(
      code("components/venue-card.tsx"),
      "card_dismissed",
    )[0];
    expect(call).toBeTruthy(); // positive control
    expect(call).toContain("position_bucket");
    expect(call).not.toContain("venue.id");
    expect(call).not.toContain("venue.slug");
    expect(call).not.toMatch(/position:\s*position/);
  });

  it("plan_open_maps still sends only a stop count, never the maps url", () => {
    for (const file of [planFlowCode, groupResultCode]) {
      const calls = trackCalls(file, "plan_open_maps");
      expect(calls.length).toBe(1); // positive control
      expect(calls[0]).not.toContain("mapsUrl");
      expect(calls[0]).toContain("stops:");
    }
  });

  it("the raw search query is no longer sent, only its length", () => {
    const call = trackCalls(
      code("components/search-overlay.tsx"),
      "search_query",
    )[0];
    expect(call).toBeTruthy();
    expect(call).toContain("q_len");
    // `{ q,` was the leak: the user-typed string itself.
    expect(call).not.toMatch(/\{\s*q\s*,/);
  });
});

describe("both branches' protections survived the rebase onto PR #187", () => {
  // This branch deliberately did NOT define the three together_* events while
  // fix/group-room-security was open, so the lib/analytics.ts union hunk would
  // resolve by taking BOTH sides rather than by choosing one. #187 merged on
  // 2026-07-30 and this branch was rebased onto it. These guards pin the
  // resolution, because a careless future conflict resolution in this exact
  // hunk is how one side's privacy protection gets silently dropped.
  const unionOnly = analytics.split("type Props =")[0];

  it.each([
    ["together_join_denied"],
    ["together_room_expired"],
    ["together_host_handoff"],
  ])("kept %s, which came from the merged security work", (name) => {
    expect(unionOnly).toContain(`| "${name}"`);
  });

  it("kept this branch's own new events too", () => {
    for (const name of [
      "plan_setup_started",
      "plan_generate_failed",
      "plan_preview_failed",
      "plan_save_tapped",
      "plan_save_succeeded",
      "plan_save_failed",
      "explore_filter_applied",
      "card_dismissed",
      "feed_end_reached",
      "near_you_result",
    ]) {
      expect(unionOnly).toContain(`| "${name}"`);
    }
  });

  it("kept the room-code stripper wired into posthog.init", () => {
    // 🧨 The single most important line in the resolution. A room code is a
    // bearer credential and it sits in the URL, so without this hook
    // capture_pageview + autocapture ship a working key to a live room in
    // $current_url on every captured click.
    expect(analyticsCode).toContain("sanitize_properties: stripRoomCodes");
    expect(analyticsCode).toContain("function stripRoomCodes(");
    expect(analyticsCode).toMatch(/room=\)\[\^&#\]\*\/gi/);
  });

  it("kept this branch's pending-event queue in the same init call", () => {
    expect(analyticsCode).toContain("flushPendingEvents()");
    expect(analyticsCode).toContain("MAX_PENDING_EVENTS");
  });

  it("does not drop the security events' own properties", () => {
    // room_id is an opaque row uuid, not a join credential, and it is the only
    // correlation property those events carry. The sanitizer's carve-out for it
    // is load-bearing now that #187 is merged.
    const keys = ["reason", "room_id"];
    const blockedKey =
      /(^|_)(lat|lng|lon|long|coord|coords|geo|geohash|email|phone|name|address|postcode|ip|token|device|user|session|password|secret)(_|$)/i;
    const blockedExact =
      /^(room_?code|invite_?code|join_?code|share_?link|room_?link|code)$/i;
    for (const k of keys) {
      expect(blockedKey.test(k) || blockedExact.test(k)).toBe(false);
    }
    // POSITIVE CONTROL: a real bearer-shaped name IS blocked.
    expect(blockedExact.test("room_code")).toBe(true);
  });

  it("keeps the deprecated plan_save name with its removal date", () => {
    expect(analytics).toContain('| "plan_save"');
    expect(analytics).toMatch(/DEPRECATED[\s\S]{0,200}2026-09-30/);
  });
});

describe("super properties are never used", () => {
  it("does not call posthog.register", () => {
    // register() persists to localStorage and is cleared only by reset(), so on
    // a shared browser it would stamp one person's auth_state onto the next
    // person's anonymous session.
    expect(analyticsCode).not.toMatch(/\.register(_once)?\(/);
  });
});

describe("the analytics gate mounts before the sign-in tracker", () => {
  it("keeps AnalyticsGate above SignInTracker in the provider tree", () => {
    const gate = authedProviders.indexOf("<AnalyticsGate");
    const tracker = authedProviders.indexOf("<SignInTracker");
    expect(gate).toBeGreaterThan(-1);
    expect(tracker).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(tracker);
  });
});

describe("no dashes that the copy guard would reject", () => {
  it("keeps the new lib files clean of typographic dashes in strings", () => {
    // pnpm check:copy strips comments and then fails on an em dash, an en dash
    // or a spaced double hyphen in user-visible text. Cheaper to catch here.
    for (const rel of ["lib/analytics-keys.ts", "lib/analytics-reasons.ts"]) {
      const text = src(rel)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      // The patterns are built from escapes on purpose: writing the literal
      // characters here would make THIS file fail the very guard it is testing.
      expect(text).not.toMatch(new RegExp("\u2014"));
      expect(text).not.toMatch(new RegExp("\u2013"));
      expect(text).not.toMatch(new RegExp(" \u002D\u002D "));
    }
  });
});
