import { describe, it, expect, vi, beforeEach } from "vitest";

// Regression tests for the 2026-06/07 prod incident: UPSTASH_REDIS_REST_URL
// carried a trailing newline, Redis construction threw a UrlError outside any
// try/catch, and every anonymous search 500'd. The contract under test:
// rateLimit() NEVER throws — any Upstash misconfiguration or outage degrades
// to the in-memory limiter, which still enforces the window.

// Mutable control for the mocked Upstash SDK (set per test).
const ctl = {
  redisCtorThrows: false,
  limitRejects: false,
  lastRedisUrl: "" as string | undefined,
};

vi.mock("@upstash/redis", () => ({
  Redis: class {
    constructor(cfg: { url?: string; token?: string }) {
      ctl.lastRedisUrl = cfg?.url;
      // Mirror the real SDK's UrlError semantics: whitespace or a missing
      // scheme in the URL throws at CONSTRUCTION time.
      if (
        ctl.redisCtorThrows ||
        !cfg?.url ||
        /\s/.test(cfg.url) ||
        !cfg.url.startsWith("https://")
      ) {
        throw new Error(`UrlError: invalid URL ${JSON.stringify(cfg?.url)}`);
      }
    }
  },
}));

vi.mock("@upstash/ratelimit", () => {
  class MockRatelimit {
    static slidingWindow(limit: number, window: string) {
      return { limit, window };
    }
    async limit(_key: string) {
      if (ctl.limitRejects) throw new Error("redis unreachable");
      return { success: true };
    }
  }
  return { Ratelimit: MockRatelimit };
});

// Fresh module state (cached redis client / limiters / memory buckets) each test.
async function freshRateLimit() {
  vi.resetModules();
  const mod = await import("@/lib/rate-limit");
  return mod.rateLimit;
}

beforeEach(() => {
  ctl.redisCtorThrows = false;
  ctl.limitRejects = false;
  ctl.lastRedisUrl = undefined;
  vi.unstubAllEnvs();
});

describe("rateLimit never hard-errors (the Upstash-newline incident)", () => {
  it("trims a trailing-newline URL so the exact prod env value now works", async () => {
    vi.stubEnv(
      "UPSTASH_REDIS_REST_URL",
      "https://large-hamster.upstash.io\n\n",
    );
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "tok\n");
    const rateLimit = await freshRateLimit();
    await expect(rateLimit("ip:1", 5, 60_000)).resolves.toBe(true);
    // The client must have been constructed with the CLEAN url.
    expect(ctl.lastRedisUrl).toBe("https://large-hamster.upstash.io");
  });

  it("falls back to memory (no throw) when construction fails even after trim", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "not a url at all");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "tok");
    const rateLimit = await freshRateLimit();
    // Would have been an uncaught UrlError before the fix.
    await expect(rateLimit("ip:2", 2, 60_000)).resolves.toBe(true);
    await expect(rateLimit("ip:2", 2, 60_000)).resolves.toBe(true);
    // Third call in the window exceeds limit=2 → memory limiter enforces it.
    await expect(rateLimit("ip:2", 2, 60_000)).resolves.toBe(false);
  });

  it("falls back to memory (no throw) when Redis is up but .limit() fails at runtime", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://ok.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "tok");
    ctl.limitRejects = true;
    const rateLimit = await freshRateLimit();
    await expect(rateLimit("ip:3", 1, 60_000)).resolves.toBe(true);
    await expect(rateLimit("ip:3", 1, 60_000)).resolves.toBe(false); // memory enforces
  });

  it("uses the memory limiter when env is absent, enforcing the window", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    const rateLimit = await freshRateLimit();
    const results = [];
    for (let i = 0; i < 4; i++)
      results.push(await rateLimit("ip:4", 3, 60_000));
    expect(results).toEqual([true, true, true, false]);
  });
});
