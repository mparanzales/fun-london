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
let redis: Redis | null | undefined; // undefined = not yet resolved
function getRedis(): Redis | null {
  if (redis === undefined) {
    redis =
      process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
        ? Redis.fromEnv()
        : null;
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
    l = new Ratelimit({
      redis: r,
      limiter: Ratelimit.slidingWindow(
        limit,
        `${Math.round(windowMs / 1000)} s`,
      ),
      prefix: `fl-rl:${k}`,
      analytics: false,
    });
    limiters.set(k, l);
  }
  return l;
}

export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  const limiter = getLimiter(limit, windowMs);
  if (limiter) {
    try {
      const { success } = await limiter.limit(key);
      return success;
    } catch {
      // Redis unreachable → degrade to the in-memory limiter rather than
      // failing the request. (Fails open to in-process, never hard-errors.)
      return memoryRateLimit(key, limit, windowMs);
    }
  }
  return memoryRateLimit(key, limit, windowMs);
}
