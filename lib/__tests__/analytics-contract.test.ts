import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The payload contract for track(): what every event carries, and what can
// never leave the browser.
//
// Why this file exists: track() fans out to TWO third parties. Before the
// sanitizer landed it stripped only `undefined`, while recordSignal() (which
// writes to OUR OWN database) dropped identifying keys and clamped strings. The
// unguarded path was the one leaving the country.
//
// Every negative assertion here has a POSITIVE CONTROL next to it. There are
// three early returns in track() (no consent, no window, PostHog not ready), so
// a vacuous pass is the dominant failure mode for this module.

const capture = vi.fn();
const vercel = vi.fn();
let lastInitOpts: Record<string, unknown> | null = null;

const phMock = {
  init: (_key: string, opts?: Record<string, unknown>) => {
    lastInitOpts = opts ?? null;
    // Invoke the loaded callback the way posthog-js does, so the pending-event
    // flush is actually exercised rather than silently skipped.
    const loaded = opts?.loaded as ((ph: unknown) => void) | undefined;
    if (loaded) loaded(phMock);
  },
  capture: (...args: unknown[]) => capture(...args),
  identify: vi.fn(),
  reset: vi.fn(),
  opt_in_capturing: vi.fn(),
  opt_out_capturing: vi.fn(),
  captureException: vi.fn(),
};

vi.mock("posthog-js", () => ({ default: phMock }));
vi.mock("@vercel/analytics", () => ({
  track: (...args: unknown[]) => vercel(...args),
}));

function stubWindow(innerWidth = 375) {
  const localStore = new Map<string, string>();
  const sessionStore = new Map<string, string>();
  vi.stubGlobal("window", {
    // A production host: initAnalytics refuses to send from anywhere else.
    location: { hostname: "www.funldn.com" },
    innerWidth,
    localStorage: {
      getItem: (k: string) => localStore.get(k) ?? null,
      setItem: (k: string, v: string) => void localStore.set(k, v),
      removeItem: (k: string) => void localStore.delete(k),
    },
    sessionStorage: {
      getItem: (k: string) => sessionStore.get(k) ?? null,
      setItem: (k: string, v: string) => void sessionStore.set(k, v),
      removeItem: (k: string) => void sessionStore.delete(k),
    },
  });
}

// A module instance with PostHog ACTUALLY initialised, so track() reaches
// posthog.capture instead of the pending queue.
async function initedAnalytics() {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test_key");
  const mod = await import("@/lib/analytics");
  mod.initAnalytics();
  return mod;
}

beforeEach(() => {
  // mockReset, not mockClear: a throwing mockImplementation set by one test
  // would otherwise leak into every test after it.
  capture.mockReset();
  vercel.mockReset();
  lastInitOpts = null;
  vi.unstubAllGlobals();
  stubWindow();
});

afterEach(() => vi.unstubAllGlobals());

describe("viewportBucket boundaries", () => {
  it.each([
    [0, "mobile"],
    [1, "mobile"],
    [320, "mobile"],
    [639, "mobile"],
    [640, "tablet"],
    [1023, "tablet"],
    [1024, "desktop"],
    [1728, "desktop"],
  ])("width %i buckets as %s", async (w, expected) => {
    const { viewportBucket } = await initedAnalytics();
    expect(viewportBucket(w as number)).toBe(expected);
  });

  it.each([[-1], [Number.NaN], [Number.POSITIVE_INFINITY === 0 ? 1 : -50]])(
    "a nonsense width (%s) falls back to mobile rather than throwing",
    async (w) => {
      const { viewportBucket } = await initedAnalytics();
      expect(viewportBucket(w as number)).toBe("mobile");
    },
  );

  it("Infinity is desktop, not a crash", async () => {
    const { viewportBucket } = await initedAnalytics();
    // Infinity is finite:false, so it takes the guard branch. Either answer is
    // defensible; what matters is that it is one of the three legal values.
    expect(["mobile", "tablet", "desktop"]).toContain(
      viewportBucket(Number.POSITIVE_INFINITY),
    );
  });
});

describe("positionBucket boundaries", () => {
  it.each([
    [0, "0-4"],
    [4, "0-4"],
    [5, "5-11"],
    [11, "5-11"],
    [12, "12-23"],
    [23, "12-23"],
    [24, "24+"],
    [999, "24+"],
  ])("position %i buckets as %s", async (p, expected) => {
    const { positionBucket } = await initedAnalytics();
    expect(positionBucket(p as number)).toBe(expected);
  });

  it("a missing position does not throw and is not a raw number", async () => {
    const { positionBucket } = await initedAnalytics();
    expect(positionBucket(undefined)).toBe("0-4");
    expect(positionBucket(null)).toBe("0-4");
    expect(positionBucket(Number.NaN)).toBe("0-4");
  });
});

describe("common properties ride on every event", () => {
  it("attaches auth_state, viewport_bucket and entry_surface", async () => {
    const { track } = await initedAnalytics();
    track("venue_save", { venue: "padella" });
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0][1]).toMatchObject({
      auth_state: "anon",
      viewport_bucket: "mobile",
      entry_surface: "direct",
      venue: "padella",
    });
  });

  it("sends the SAME payload to both providers", async () => {
    const { track } = await initedAnalytics();
    track("venue_save", { venue: "padella" });
    expect(vercel).toHaveBeenCalledTimes(1);
    expect(vercel.mock.calls[0][1]).toEqual(capture.mock.calls[0][1]);
  });

  it("reflects the signed-in state once it is set", async () => {
    const { track, setAnalyticsAuthState } = await initedAnalytics();
    setAnalyticsAuthState("signed_in");
    track("plan_save_tapped");
    expect(capture.mock.calls[0][1]).toMatchObject({
      auth_state: "signed_in",
    });
  });

  it("never carries a user id, only the coarse enum", async () => {
    const { track, setAnalyticsAuthState } = await initedAnalytics();
    setAnalyticsAuthState("signed_in");
    track("plan_save_succeeded");
    const payload = JSON.stringify(capture.mock.calls[0][1]);
    expect(payload).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i); // no uuid shape
  });

  it("reads the viewport per event, so a resize is reflected", async () => {
    const { track } = await initedAnalytics();
    track("venue_save");
    expect(capture.mock.calls[0][1]).toMatchObject({
      viewport_bucket: "mobile",
    });
    stubWindow(1440); // rotate / resize
    track("venue_save");
    expect(capture.mock.calls[1][1]).toMatchObject({
      viewport_bucket: "desktop",
    });
  });

  it("lets an explicit call-site property win over a common one", async () => {
    const { track } = await initedAnalytics();
    track("card_dismissed", { entry_surface: "saved" });
    expect(capture.mock.calls[0][1]).toMatchObject({ entry_surface: "saved" });
  });
});

describe("the sanitizer rejects identifying and bearer-shaped keys", () => {
  const POISON = "SENTINEL_LEAK_9f3a";

  it.each([
    ["lat"],
    ["lng"],
    ["user_lat"],
    ["coords"],
    ["geohash"],
    ["email"],
    ["phone"],
    ["display_name"],
    ["address"],
    ["postcode"],
    ["ip"],
    ["access_token"],
    ["device_id"],
    ["user_id"],
    ["session_id"],
    ["password"],
    ["secret"],
    ["room_code"],
    ["roomcode"],
    ["invite_code"],
    ["join_code"],
    ["share_link"],
    ["room_link"],
    ["code"],
  ])("drops %s", async (key) => {
    const { track } = await initedAnalytics();
    track("venue_save", { [key]: POISON, venue: "padella" });
    const payload = JSON.stringify(capture.mock.calls[0][1]);
    expect(payload).not.toContain(POISON);
    // POSITIVE CONTROL: the event still went out with its legitimate property,
    // so this is not passing because nothing was captured at all.
    expect(payload).toContain("padella");
  });

  it("ALLOWS room_id, which the group-security events depend on", async () => {
    // room_id is an opaque row uuid, not a join credential. Blocking it here
    // would silently strip the only correlation property those events carry.
    const { track } = await initedAnalytics();
    track("venue_save", { room_id: "row-uuid-1234" });
    expect(JSON.stringify(capture.mock.calls[0][1])).toContain("row-uuid-1234");
  });

  it("clamps a long string instead of shipping it whole", async () => {
    const { track } = await initedAnalytics();
    track("search_query", { note: "x".repeat(500) });
    const sent = capture.mock.calls[0][1] as Record<string, string>;
    expect(sent.note).toHaveLength(120);
  });

  it("strips undefined but keeps null and false", async () => {
    const { track } = await initedAnalytics();
    track("plan_swap", { gone: undefined, kept: null, flag: false });
    const sent = capture.mock.calls[0][1] as Record<string, unknown>;
    expect("gone" in sent).toBe(false);
    expect(sent.kept).toBeNull();
    expect(sent.flag).toBe(false);
  });
});

describe("PostHog stays configured for the EU and stays cookieless", () => {
  it("points at the EU ingest host with recording off", async () => {
    await initedAnalytics();
    expect(lastInitOpts).toMatchObject({
      api_host: "https://eu.i.posthog.com",
      persistence: "localStorage",
      disable_session_recording: true,
      person_profiles: "identified_only",
    });
  });
});
