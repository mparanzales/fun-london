import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Per-key rate limiter for the public search actions (#25). Uses a SHARED
// Upstash Redis counter when configured — one count across all serverless
// instances, so "N per window per IP" is actually enforced globally — and
// otherwise degrades to a per-instance in-memory counter (a speed bump, not a
// guarantee). Same API either way: rateLimit(key, limit, windowMs) → allowed?

// ── In-memory fallback (per serverless instance) ─────────────────────────
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const MAX_TRACKED_KEYS = 10_000;

function purgeExpired(now: number) {
  for (const [k, b] of buckets) {
    if (now >= b.resetAt) buckets.delete(k);
  }
}

function memoryRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    // Opportunistic cleanup so a long-lived instance doesn't accumulate stale
    // buckets for keys that have gone quiet.
    if (buckets.size > MAX_TRACKED_KEYS) purgeExpired(now);
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  b.count += 1;
  return b.count <= limit;
}

// ── Upstash (shared across instances) ────────────────────────────────────
// HARDENED after a real incident: the prod UPSTASH_REDIS_REST_URL carried a
// trailing newline, `Redis.fromEnv()` threw a UrlError OUTSIDE any try/catch,
// and every anonymous search 500'd from ~28 Jun (the limiter never engaged).
// Three defences, in order: TRIM the env values (so that exact value now
// works), guard client/limiter CONSTRUCTION (any env misconfig degrades to the
// in-memory limiter instead of crashing the request), and keep the existing
// runtime catch around `.limit()`.
let redis: Redis | null | undefined; // undefined = not yet resolved
function getRedis(): Redis | null {
  if (redis === undefined) {
    const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
    const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
    if (!url || !token) {
      redis = null;
    } else {
      try {
        redis = new Redis({ url, token });
      } catch (e) {
        console.warn(
          `[rate-limit] Upstash client init failed (${(e as Error).message}), using in-memory fallback`,
        );
        redis = null;
      }
    }
  }
  return redis;
}

// One Ratelimit instance per (limit, window) config; cheap to cache.
const limiters = new Map<string, Ratelimit>();
function getLimiter(limit: number, windowMs: number): Ratelimit | null {
  const r = getRedis();
  if (!r) return null;
  const k = `${limit}:${windowMs}`;
  let l = limiters.get(k);
  if (!l) {
    try {
      l = new Ratelimit({
        redis: r,
        limiter: Ratelimit.slidingWindow(
          limit,
          `${Math.round(windowMs / 1000)} s`,
        ),
        prefix: `fl-rl:${k}`,
        analytics: false,
      });
    } catch (e) {
      console.warn(
        `[rate-limit] limiter init failed (${(e as Error).message}), using in-memory fallback`,
      );
      return null;
    }
    limiters.set(k, l);
  }
  return l;
}

export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  try {
    const limiter = getLimiter(limit, windowMs);
    if (limiter) {
      const { success } = await limiter.limit(key);
      return success;
    }
  } catch {
    // Redis unreachable / misconfigured → degrade to the in-memory limiter
    // rather than failing the request. (Never hard-errors a user request.)
  }
  return memoryRateLimit(key, limit, windowMs);
}
