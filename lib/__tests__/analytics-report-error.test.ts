import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The one invariant that actually matters for reportError: IT MUST NEVER THROW.
//
// It is called from inside every error boundary. If it threw, the boundary
// would fail while rendering its own fallback and React would escalate to a
// hard crash — turning a handled error into a white screen. A reporting bug
// must never be worse than no reporting.
//
// PostHog is mocked so these run without a browser or a project key.

const captureException = vi.fn();

vi.mock("posthog-js", () => ({
  default: {
    init: vi.fn(),
    capture: vi.fn(),
    identify: vi.fn(),
    reset: vi.fn(),
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
    captureException: (...args: unknown[]) => captureException(...args),
  },
}));
vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));

const CONSENT_KEY = "fl.consent.v1";

// A module instance with PostHog ACTUALLY initialised, so reportError gets
// past its `!posthogReady` early return and reaches captureException. Without
// this the throw-safety assertions below are vacuous — they pass because
// nothing is ever called. (Verified by mutation: removing the try/catch must
// make "survives PostHog itself blowing up" fail.)
async function initedAnalytics() {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test_key");
  const mod = await import("@/lib/analytics");
  mod.initAnalytics();
  return mod;
}

// A module instance where PostHog was never initialised (no key configured).
async function freshAnalytics() {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");
  return await import("@/lib/analytics");
}

beforeEach(() => {
  captureException.mockClear();
  vi.unstubAllGlobals();
  const store = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("reportError actually reports", () => {
  it("forwards the error and tags the surface", async () => {
    const { reportError } = await initedAnalytics();
    reportError(new Error("boom"), "venue");
    expect(captureException).toHaveBeenCalledTimes(1);
    const [err, props] = captureException.mock.calls[0];
    expect((err as Error).message).toBe("boom");
    expect(props).toMatchObject({ surface: "venue" });
  });

  it("passes Next's server `digest` through when present", async () => {
    const { reportError } = await initedAnalytics();
    const e = Object.assign(new Error("boom"), { digest: "abc123" });
    reportError(e, "main-shell");
    expect(captureException.mock.calls[0][1]).toMatchObject({
      digest: "abc123",
    });
  });

  it("coerces a non-Error into an Error before sending", async () => {
    const { reportError } = await initedAnalytics();
    reportError("just a string", "component");
    expect(captureException.mock.calls[0][0]).toBeInstanceOf(Error);
  });
});

describe("reportError never throws", () => {
  it("survives a thrown Error", async () => {
    const { reportError } = await initedAnalytics();
    expect(() => reportError(new Error("boom"), "venue")).not.toThrow();
  });

  it("survives non-Error values", async () => {
    const { reportError } = await initedAnalytics();
    for (const v of ["a string", 42, null, undefined, { odd: true }, []]) {
      expect(() => reportError(v, "component")).not.toThrow();
    }
  });

  // The load-bearing one. PostHog is initialised here, so this genuinely
  // exercises the try/catch: remove it and this test fails.
  it("survives PostHog itself blowing up", async () => {
    captureException.mockImplementation(() => {
      throw new Error("posthog exploded");
    });
    const { reportError } = await initedAnalytics();
    expect(() => reportError(new Error("boom"), "global")).not.toThrow();
    expect(captureException).toHaveBeenCalled(); // proves we reached it
  });

  it("survives a missing window (server render)", async () => {
    const { reportError } = await initedAnalytics();
    vi.unstubAllGlobals(); // no window at all
    expect(() => reportError(new Error("boom"), "main-shell")).not.toThrow();
  });
});

describe("reportError respects the consent gate", () => {
  it("stays silent when the visitor declined", async () => {
    const { reportError } = await freshAnalytics();
    window.localStorage.setItem(CONSENT_KEY, "denied");
    reportError(new Error("boom"), "venue");
    expect(captureException).not.toHaveBeenCalled();
  });

  it("stays silent before PostHog has initialised", async () => {
    // No initAnalytics() call and no key configured, so posthogReady is false.
    const { reportError } = await freshAnalytics();
    reportError(new Error("boom"), "venue");
    expect(captureException).not.toHaveBeenCalled();
  });
});
