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
    // A pending-transition map, not a Set of (stop, position) keys: `pos`
    // cycles modulo the alternative count, so a Set is exhausted after a few
    // swaps of the same stop and later genuine swaps go uncounted.
    expect(groupResult).toContain("swapPendingRef");
    expect(groupResult).not.toContain("swapReportedRef");
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
    //
    // The stripper's BEHAVIOUR is tested in analytics-room-code-strip.test.ts,
    // against real percent-encoded URLs, a $elements array and an elements
    // chain. This guard only pins that it is still WIRED. It deliberately does
    // NOT assert the regex literal any more: the previous version did, three
    // real leaks passed it anyway, and pinning the implementation meant fixing
    // the bug broke the test, which invites loosening the test instead.
    expect(analyticsCode).toContain("sanitize_properties: stripRoomCodes");
    expect(analyticsCode).toContain("export function stripRoomCodes(");
  });

  it("flushes the pending queue from INSIDE the loaded callback", () => {
    // Presence alone is not enough. Moving flushPendingEvents() above
    // posthog.init would keep both strings in the file and silently destroy
    // every queued event: capture() early-returns while __loaded is false, and
    // the flush has already emptied the array. Ordering is the invariant.
    const loadedAt = analyticsCode.indexOf("loaded: (ph) =>");
    // The CALL, with its semicolon. Matching "flushPendingEvents()" bare finds
    // the declaration `function flushPendingEvents(): void`, whose empty
    // parameter list contains the same characters.
    const flushAt = analyticsCode.indexOf("flushPendingEvents();");
    const readyAt = analyticsCode.indexOf("posthogReady = true");
    expect(loadedAt).toBeGreaterThan(-1); // positive controls
    expect(flushAt).toBeGreaterThan(-1);
    expect(readyAt).toBeGreaterThan(-1);
    expect(loadedAt).toBeLessThan(flushAt);
    expect(flushAt).toBeLessThan(readyAt);
    expect(analyticsCode).toContain("MAX_PENDING_EVENTS");
  });

  it("keeps the sanitizer's room_id carve-out, which the security events need", () => {
    // room_id is the opaque plan_rooms row uuid, not a join credential, and it
    // is the only correlation property two of the three together_* events have.
    // Pin the SOURCE of the blocked-name list rather than a copy of it: the
    // previous version re-declared both regexes inside the test body and
    // asserted a property of its own copies, so it could not fail for any
    // change to lib/analytics.ts. The real behavioural coverage is in
    // analytics-contract.test.ts ("ALLOWS room_id").
    const blockedExactLine = analyticsCode.match(
      /BLOCKED_EXACT =[\s\S]{0,200}?;/,
    )?.[0];
    expect(blockedExactLine).toBeTruthy(); // positive control
    expect(blockedExactLine).toContain("room_?code");
    expect(blockedExactLine).not.toMatch(/room_\?id|room_id/);
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
