import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Only production may talk to the production PostHog project.
//
// 🧨 WHAT THIS PROTECTS. There is ONE PostHog project and its key is a
// NEXT_PUBLIC_ var, so the dev server and every Vercel preview build ship it to
// the browser exactly like production does. Without this gate, a reviewer
// clicking through a preview and a developer reloading localhost land in the
// same funnels the roadmap is read from — and nothing anywhere says so, because
// polluted analytics look identical to real analytics.
//
// The property under test is an ALLOWLIST: an origin nobody listed sends
// nothing. The tests below therefore care much more about the hosts that must
// be REFUSED than the one that must be allowed, and one of them deliberately
// checks a host that did not exist when this was written.

const init = vi.fn();
const capture = vi.fn();
const vercel = vi.fn();

const phMock = {
  init: (key: string, opts?: Record<string, unknown>) => {
    init(key, opts);
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

function stubHost(hostname: string) {
  const store = new Map<string, string>();
  vi.stubGlobal("window", {
    innerWidth: 375,
    location: { hostname },
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    sessionStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
  });
}

async function loadOn(hostname: string) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test_key");
  stubHost(hostname);
  return await import("@/lib/analytics");
}

beforeEach(() => {
  for (const m of [init, capture, vercel]) m.mockReset();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("production initialises normally", () => {
  it("inits on www.funldn.com", async () => {
    const mod = await loadOn("www.funldn.com");
    mod.initAnalytics();
    expect(init).toHaveBeenCalledTimes(1);
  });

  it("inits on the apex funldn.com too", async () => {
    // The apex redirects to www in production, but a redirect still executes a
    // document on the apex host first.
    const mod = await loadOn("funldn.com");
    mod.initAnalytics();
    expect(init).toHaveBeenCalledTimes(1);
  });

  it("still captures events there", async () => {
    const mod = await loadOn("www.funldn.com");
    mod.initAnalytics();
    mod.track("venue_save");
    expect(capture).toHaveBeenCalled();
  });
});

describe("everywhere else is refused", () => {
  // Each of these is a real origin this app has actually been served from.
  const refused = [
    "localhost", // pnpm dev
    "127.0.0.1", // ditto, by IP
    "192.168.1.42", // phone testing over the LAN
    "fun-london-app-git-fix-abc123.vercel.app", // a PR preview
    "fun-london-app.vercel.app", // the project's own vercel domain
  ];

  for (const host of refused) {
    it(`does not init on ${host}`, async () => {
      const mod = await loadOn(host);
      mod.initAnalytics();
      expect(init).not.toHaveBeenCalled();
    });
  }

  it("refuses a host nobody has thought of yet", async () => {
    // The point of an allowlist. A denylist of localhost/*.vercel.app would
    // have let this through, and this is what a tunnel, a staging alias or a
    // future preview domain looks like.
    const mod = await loadOn("fun-london-staging.fly.dev");
    mod.initAnalytics();
    expect(init).not.toHaveBeenCalled();
  });

  it("sends NOTHING to PostHog from a refused host, even after track()", async () => {
    // The gate is at init, so this is the assertion that actually matters:
    // posthogReady never flips, so capture is unreachable.
    const mod = await loadOn("localhost");
    mod.initAnalytics();
    mod.track("venue_save");
    mod.track("together_room_create");
    expect(init).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it("does not silently hold a queue waiting for an init that never comes", async () => {
    // Events fired before the gate mounts are queued on purpose. On a refused
    // host that queue has no future, and keeping it would mean a later
    // navigation to a production host replayed localhost's events.
    const mod = await loadOn("localhost");
    mod.track("venue_save"); // queued: posthog not ready
    mod.initAnalytics(); // refused: must drop the queue
    mod.initAnalytics(); // and a second call must not flush it either
    expect(capture).not.toHaveBeenCalled();
  });

  it("says so once, so a missing event is diagnosable", async () => {
    // The repo's own landmine: automation fails by going quiet. A developer
    // whose event never arrives must not have to re-run the 2026-07-29
    // "PostHog is broken" investigation to find out why.
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const mod = await loadOn("localhost");
    mod.initAnalytics();
    mod.initAnalytics();
    mod.initAnalytics();
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0]?.[0])).toContain("localhost");
  });
});

describe("the escape hatch is explicit and exact", () => {
  it("sends from localhost when forced on", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test_key");
    vi.stubEnv("NEXT_PUBLIC_ANALYTICS_FORCE_ENABLE", "1");
    stubHost("localhost");
    const mod = await import("@/lib/analytics");
    mod.initAnalytics();
    expect(init).toHaveBeenCalledTimes(1);
  });

  it('requires exactly "1", so a truthy-looking value is not enough', async () => {
    // "true"/"yes"/"" are the values a hurried env edit produces. Only the
    // documented one opens the gate, so a typo fails closed.
    for (const v of ["true", "yes", "0", "", "TRUE"]) {
      vi.resetModules();
      init.mockReset();
      vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test_key");
      vi.stubEnv("NEXT_PUBLIC_ANALYTICS_FORCE_ENABLE", v);
      stubHost("localhost");
      const mod = await import("@/lib/analytics");
      mod.initAnalytics();
      expect(
        init,
        `value ${JSON.stringify(v)} must not enable`,
      ).not.toHaveBeenCalled();
    }
  });
});

describe("the gate itself", () => {
  it("never throws when window has no location", async () => {
    // It runs inside initAnalytics, which must never throw into the provider
    // tree. An embedded webview or a test double is enough to hit this.
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test_key");
    vi.stubGlobal("window", {
      innerWidth: 375,
      localStorage: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
      },
    });
    const mod = await import("@/lib/analytics");
    expect(() => mod.initAnalytics()).not.toThrow();
    expect(mod.analyticsEnvironmentAllowed()).toBe(false); // and fails CLOSED
  });

  it("is false on the server, where there is no host to check", async () => {
    vi.resetModules();
    vi.stubGlobal("window", undefined);
    const mod = await import("@/lib/analytics");
    expect(mod.analyticsEnvironmentAllowed()).toBe(false);
  });
});

describe("the escape hatch cannot be left on by accident", () => {
  it("is not turned on in any committed env file", async () => {
    // 🧨 NEXT_PUBLIC_* is INLINED AT BUILD TIME. A committed "=1" bakes the
    // hatch into every build, and the resulting preview is indistinguishable
    // from production in the data. The env var is also the one thing here that
    // no unit test would otherwise cover, because it is read at compile time.
    const { readFileSync, existsSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const root = fileURLToPath(new URL("../../", import.meta.url));
    const committed = [".env.example", ".env", ".env.production"];
    let checked = 0;
    for (const f of committed) {
      if (!existsSync(root + f)) continue;
      checked++;
      const body = readFileSync(root + f, "utf8");
      expect(body, `${f} enables the analytics force hatch`).not.toMatch(
        /^\s*NEXT_PUBLIC_ANALYTICS_FORCE_ENABLE\s*=\s*["']?1/m,
      );
    }
    expect(checked).toBeGreaterThan(0); // positive control: it read something
  });

  it("is documented in .env.example, so the option is discoverable", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { fileURLToPath } = require("node:url") as typeof import("node:url");
    const body = readFileSync(
      fileURLToPath(new URL("../../.env.example", import.meta.url)),
      "utf8",
    );
    expect(body).toContain("NEXT_PUBLIC_ANALYTICS_FORCE_ENABLE");
  });
});

describe("the guard is an allowlist in the source, not a denylist", () => {
  it("names production hosts, and does not enumerate what to block", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    // Comments are stripped first: the comments there deliberately DISCUSS
    // localhost and vercel.app while explaining why they are not enumerated,
    // so a raw scan would flag the documentation for the very property it is
    // documenting.
    //
    // LINE COMMENTS FIRST, then blocks — not the other way round, which is what
    // this was and why it failed. The prose being stripped contains the literal
    // sequence "localhost/*.vercel.app", and a leading block-comment pass reads
    // that `/*` as an opener and eats 6KB of real code up to the next `*/`
    // (which arrives inside a regex literal). The file then "contains no
    // denylist" because it contains almost nothing.
    const code = readFileSync(
      fileURLToPath(new URL("../analytics.ts", import.meta.url)),
      "utf8",
    )
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");

    expect(code).toContain("PRODUCTION_HOSTS");
    expect(code).toMatch(/PRODUCTION_HOSTS[^;]*funldn\.com/);
    // A denylist would name the things to exclude. If one of these ever
    // appears in real code, the guard has been inverted and every unlisted
    // origin silently starts reporting again.
    expect(code).not.toMatch(/["'`]localhost["'`]/);
    expect(code).not.toMatch(/vercel\.app/);
    // And the decision must be made BEFORE init, with a return between them —
    // asserted by position rather than by character distance, which only
    // measured how long the comments in between happened to be.
    const body = code.slice(code.indexOf("export function initAnalytics"));
    const gate = body.indexOf("analyticsEnvironmentAllowed()");
    const bail = body.indexOf("return;", gate);
    const init = body.indexOf("posthog.init");
    expect(gate).toBeGreaterThan(-1);
    expect(init).toBeGreaterThan(gate); // checked first
    expect(bail).toBeGreaterThan(gate); // and it actually leaves
    expect(bail).toBeLessThan(init); // before reaching init
  });
});
