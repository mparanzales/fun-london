import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Consent, identity reset, and the pending-event queue.
//
// Three properties are load-bearing and each one has been wrong at some point:
//   1. a declined visitor must reach NEITHER provider. There is a single gate
//      at the top of track(), so a regression here silently leaks to two third
//      parties at once.
//   2. sign-out must drop the PostHog person AND any state this module holds,
//      or on a shared browser one account's history attaches to the next.
//   3. an event fired before PostHog finished initialising must be QUEUED, not
//      dropped. It was dropped, which is why sign_in_complete reached Vercel and
//      never reached PostHog.

const capture = vi.fn();
const vercel = vi.fn();
const reset = vi.fn();
const optIn = vi.fn();
const optOut = vi.fn();
const identify = vi.fn();

const phMock = {
  init: (_key: string, opts?: Record<string, unknown>) => {
    const loaded = opts?.loaded as ((ph: unknown) => void) | undefined;
    if (loaded) loaded(phMock);
  },
  capture: (...args: unknown[]) => capture(...args),
  identify: (...args: unknown[]) => identify(...args),
  reset: (...args: unknown[]) => reset(...args),
  opt_in_capturing: (...args: unknown[]) => optIn(...args),
  opt_out_capturing: (...args: unknown[]) => optOut(...args),
  captureException: vi.fn(),
};

vi.mock("posthog-js", () => ({ default: phMock }));
vi.mock("@vercel/analytics", () => ({
  track: (...args: unknown[]) => vercel(...args),
}));

const CONSENT_KEY = "fl.consent.v1";
let localStore: Map<string, string>;

function stubWindow() {
  localStore = new Map<string, string>();
  const sessionStore = new Map<string, string>();
  vi.stubGlobal("window", {
    // A production host: initAnalytics refuses to send from anywhere else.
    location: { hostname: "www.funldn.com" },
    innerWidth: 375,
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

// PostHog initialised: track() reaches capture directly.
async function initedAnalytics() {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test_key");
  const mod = await import("@/lib/analytics");
  mod.initAnalytics();
  return mod;
}

// PostHog NOT initialised yet, but a key IS configured, so a later
// initAnalytics() will succeed and flush. This is the real race window.
async function preInitAnalytics() {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test_key");
  return await import("@/lib/analytics");
}

beforeEach(() => {
  for (const m of [capture, vercel, reset, optIn, optOut, identify]) {
    m.mockReset();
  }
  vi.unstubAllGlobals();
  stubWindow();
});

afterEach(() => vi.unstubAllGlobals());

describe("the consent gate blocks BOTH providers", () => {
  it("sends nothing at all once the visitor has declined", async () => {
    const { track } = await initedAnalytics();
    localStore.set(CONSENT_KEY, "denied");
    track("venue_save", { venue: "padella" });
    expect(capture).not.toHaveBeenCalled();
    expect(vercel).not.toHaveBeenCalled();
  });

  it("POSITIVE CONTROL: the same call transmits when not declined", async () => {
    const { track } = await initedAnalytics();
    track("venue_save", { venue: "padella" });
    expect(capture).toHaveBeenCalledTimes(1);
    expect(vercel).toHaveBeenCalledTimes(1);
  });

  it("is opt-OUT: an absent choice still transmits", async () => {
    const { track } = await initedAnalytics();
    expect(localStore.get(CONSENT_KEY)).toBeUndefined();
    track("venue_save");
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("treats an unrecognised stored value as not-declined", async () => {
    const { track } = await initedAnalytics();
    localStore.set(CONSENT_KEY, "garbage");
    track("venue_save");
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("opts PostHog out when the banner revokes consent", async () => {
    const { setAnalyticsConsent } = await initedAnalytics();
    setAnalyticsConsent(false);
    expect(optOut).toHaveBeenCalled();
  });

  it("opts back in when consent is granted", async () => {
    const { setAnalyticsConsent } = await initedAnalytics();
    setAnalyticsConsent(true);
    expect(optIn).toHaveBeenCalled();
  });

  it("sends nothing on the server, where there is no window", async () => {
    const { track } = await initedAnalytics();
    vi.unstubAllGlobals(); // no window at all
    expect(() => track("venue_save")).not.toThrow();
    expect(capture).not.toHaveBeenCalled();
  });
});

describe("sign-out resets the analytics identity", () => {
  it("calls posthog.reset on an initialised module", async () => {
    const { resetAnalyticsIdentity } = await initedAnalytics();
    resetAnalyticsIdentity();
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("puts auth_state back to anon, so the next event is not mislabelled", async () => {
    const { track, setAnalyticsAuthState, resetAnalyticsIdentity } =
      await initedAnalytics();
    setAnalyticsAuthState("signed_in");
    resetAnalyticsIdentity();
    track("venue_save");
    expect(capture.mock.calls[0][1]).toMatchObject({ auth_state: "anon" });
  });

  it("never throws when PostHog was never initialised", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");
    const mod = await import("@/lib/analytics");
    expect(() => mod.resetAnalyticsIdentity()).not.toThrow();
    expect(reset).not.toHaveBeenCalled();
  });
});

describe("events fired before init are queued, not dropped", () => {
  it("delivers an event that was fired pre-init once init runs", async () => {
    const mod = await preInitAnalytics();
    mod.track("sign_in_complete", { trigger: "plan_save" });
    // Vercel got it immediately; PostHog cannot have, it does not exist yet.
    expect(vercel).toHaveBeenCalledTimes(1);
    expect(capture).not.toHaveBeenCalled();

    mod.initAnalytics(); // AnalyticsGate mounts a few ms later

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0][0]).toBe("sign_in_complete");
    expect(capture.mock.calls[0][1]).toMatchObject({ trigger: "plan_save" });
  });

  it("identifies BEFORE flushing, so queued events land on the person", async () => {
    const mod = await preInitAnalytics();
    mod.identifyUser("user-uuid-1");
    mod.track("sign_in_complete", { trigger: "plan_save" });
    mod.initAnalytics();
    expect(identify).toHaveBeenCalledTimes(1);
    const identifyOrder = identify.mock.invocationCallOrder[0];
    const captureOrder = capture.mock.invocationCallOrder[0];
    expect(identifyOrder).toBeLessThan(captureOrder);
  });

  it("discards the queue when consent is revoked during the window", async () => {
    const mod = await preInitAnalytics();
    mod.track("venue_save");
    localStore.set(CONSENT_KEY, "denied");
    mod.initAnalytics();
    expect(capture).not.toHaveBeenCalled();
    expect(optOut).toHaveBeenCalled();
  });

  it("is bounded, so a loop cannot grow it without limit", async () => {
    const mod = await preInitAnalytics();
    for (let i = 0; i < 200; i++) mod.track("venue_save");
    mod.initAnalytics();
    expect(capture.mock.calls.length).toBeLessThanOrEqual(20);
    // POSITIVE CONTROL: it queued something rather than nothing.
    expect(capture.mock.calls.length).toBeGreaterThan(0);
  });

  it("does not replay the previous account's queue after a reset", async () => {
    const mod = await preInitAnalytics();
    mod.track("plan_save_succeeded");
    mod.resetAnalyticsIdentity();
    mod.initAnalytics();
    expect(capture).not.toHaveBeenCalled();
  });
});
