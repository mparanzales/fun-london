// Lightweight in-process, fixed-window rate limiter. Keyed by an arbitrary
// string (e.g. an IP). Per serverless INSTANCE only — not shared across
// instances — so it's a speed bump against bursty single-source abuse, not a
// global guarantee. A Redis/Upstash backend is the production upgrade when a
// hard, cross-instance limit is needed. Good enough to blunt naive bulk
// catalogue harvesting via the public search endpoint (#25).

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const MAX_TRACKED_KEYS = 10_000;

function purgeExpired(now: number) {
  for (const [k, b] of buckets) {
    if (now >= b.resetAt) buckets.delete(k);
  }
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; remaining: number } {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    // Opportunistic cleanup so a long-lived instance doesn't accumulate stale
    // buckets for IPs that have gone quiet.
    if (buckets.size > MAX_TRACKED_KEYS) purgeExpired(now);
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1 };
  }
  b.count += 1;
  return { ok: b.count <= limit, remaining: Math.max(0, limit - b.count) };
}
