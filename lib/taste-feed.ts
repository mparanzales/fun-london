// Stage 3 (pt B) — taste-rank the signed-in For You feed.
//
// Server-only: builds the centred hybrid catalogue (service-role, since
// venue_embeddings is RLS-locked to service_role), derives the user's taste
// vector from their signals, and reorders the feed rows by centred-cosine
// relevance with an MMR diversity pass over the head.
//
// FAILS OPEN: any missing piece (no service key, the embeddings table absent on
// a preview DB, no embeddings yet, or the user has no usable signal) returns
// null, and the caller keeps the default feed order. The feed never breaks and
// never errors on personalisation.

import { createServiceClient } from "@/lib/supabase/admin";
import { buildHybridVector } from "@/lib/hybrid-vector";
import {
  buildTasteVector,
  DELIBERATE_SIGNAL_TYPES,
  type TasteSignal,
} from "@/lib/taste-vector";
import {
  centroidOf,
  centerVector,
  coldStartRelevance,
  mmrRerank,
  QUALITY_PRIOR_WEIGHT,
  type RankItem,
} from "@/lib/ranker";
import { cosineSimilarity, type Tag } from "@/lib/tag-vocabulary";
import type { SignalType } from "@/lib/signals";

const TTL_MS = 10 * 60 * 1000;
const POOL_HEAD = 36; // top-relevance head of the diversified pool
const POOL_PER_CAT = 8; // guarantee the best N of EACH category reach the pool, so a
// restaurant-heavy taste still surfaces its best bars/cafés/culture to interleave.
const MMR_LAMBDA = 0.78; // relevance-leaning; the category penalty does the spreading
const CATEGORY_PENALTY = 0.06;

// Coarse category for diversity (groups micro-types: all bars count as one).
const BAR_TYPES = new Set(["Bar", "Wine Bar", "Pub", "Listening Bar"]);
function categoryOf(type: string): string {
  if (type === "Restaurant") return "eats";
  if (BAR_TYPES.has(type)) return "bars";
  if (type === "Cafe") return "cafes";
  if (type === "Live Music") return "music";
  if (type === "Culture") return "culture";
  return "other";
}

let indexCache: { at: number; idx: Map<string, number[]> } | null = null;

function parseVec(v: unknown): number[] | null {
  if (Array.isArray(v)) return v as number[];
  if (typeof v === "string") {
    try {
      const a = JSON.parse(v) as number[];
      return Array.isArray(a) ? a : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Centred hybrid vector per venue, cached 10 min. null = fail open. */
async function getTasteIndex(): Promise<Map<string, number[]> | null> {
  if (indexCache && Date.now() - indexCache.at < TTL_MS) return indexCache.idx;
  const sb = createServiceClient();
  if (!sb) return null;

  const emb = new Map<string, number[]>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("venue_embeddings")
      .select("venue_id, review_embedding")
      .range(from, from + 999);
    if (error) return null; // table absent (e.g. a preview DB) → fall back
    if (!data?.length) break;
    for (const r of data as { venue_id: string; review_embedding: unknown }[]) {
      const v = parseVec(r.review_embedding);
      if (v) emb.set(r.venue_id, v);
    }
    if (data.length < 1000) break;
  }
  if (emb.size === 0) return null;

  const tags = new Map<string, string[]>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("venues")
      .select("id, canonical_tags")
      .is("hidden_at", null)
      .range(from, from + 999);
    if (error) return null;
    if (!data?.length) break;
    for (const r of data as { id: string; canonical_tags: string[] | null }[])
      tags.set(r.id, r.canonical_tags ?? []);
    if (data.length < 1000) break;
  }

  const ids: string[] = [];
  const hybrids: number[][] = [];
  for (const [id, t] of tags) {
    ids.push(id);
    hybrids.push(buildHybridVector(t as Tag[], emb.get(id) ?? null));
  }
  const centroid = centroidOf(hybrids);
  const idx = new Map<string, number[]>();
  ids.forEach((id, i) => idx.set(id, centerVector(hybrids[i], centroid)));
  indexCache = { at: Date.now(), idx };
  return idx;
}

// Fetch budgets for the two signal families. PostgREST silently caps an
// unbounded select at 1,000 rows, and impressions dominate event volume — so a
// single unordered query let "seen-but-scrolled-past" rows CROWD OUT the saves
// and dismisses that actually carry taste (and in arbitrary order, so taste
// degraded as a user got MORE active). Fetching the two families separately,
// newest first, guarantees deliberate signals are never truncated by exposure
// volume; with the 45-day half-life, the most recent N are the right N.
const MAX_DELIBERATE_EVENTS = 1000;
const MAX_IMPRESSION_EVENTS = 2000;

/** The user's taste vector in the centred space, or null if no usable signal. */
async function loadUserTaste(
  userId: string,
  idx: Map<string, number[]>,
): Promise<number[] | null> {
  const sb = createServiceClient();
  if (!sb) return null;
  const [deliberate, impressions] = await Promise.all([
    sb
      .from("user_events")
      .select("venue_id, event_type, context, created_at")
      .eq("user_id", userId)
      .in("event_type", DELIBERATE_SIGNAL_TYPES)
      .not("venue_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(MAX_DELIBERATE_EVENTS),
    sb
      .from("user_events")
      .select("venue_id, event_type, context, created_at")
      .eq("user_id", userId)
      .eq("event_type", "impression")
      .not("venue_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(MAX_IMPRESSION_EVENTS),
  ]);
  // No deliberate signals → no basis for taste (impressions alone stay
  // cold-start by design, Stage 6). An impressions read error only drops the
  // exposure penalty — a refinement — so it fails open to an empty list.
  if (deliberate.error || !deliberate.data?.length) return null;
  const data = [...deliberate.data, ...(impressions.data ?? [])];
  const now = Date.now();
  const signals: TasteSignal[] = [];
  for (const e of data as {
    venue_id: string | null;
    event_type: string;
    context: Record<string, unknown> | null;
    created_at: string;
  }[]) {
    const v = e.venue_id ? idx.get(e.venue_id) : null;
    if (!v) continue;
    signals.push({
      vector: v,
      eventType: e.event_type as SignalType,
      context: e.context,
      ageDays: (now - Date.parse(e.created_at)) / 86_400_000,
      venueId: e.venue_id ?? undefined,
    });
  }
  if (signals.length === 0) return null;
  const taste = buildTasteVector(signals);
  return taste.some((x) => x !== 0) ? taste : null;
}

/**
 * Reorder feed rows by the user's taste: centred cosine plus a small quality
 * prior (QUALITY_PRIOR_WEIGHT · coldStartRelevance — reorders near-ties so a
 * well-loved venue beats a taste-adjacent mediocre one, never overrides a real
 * taste gap), then MMR over the head. Returns null to fall back to the default
 * order. Rows without a vector keep their original relative order at the tail.
 */
export async function rankRowsByTaste<
  T extends {
    id: string;
    type: string;
    rating?: number | string | null;
    review_count?: number | null;
    curation_tier?: string | null;
  },
>(userId: string, rows: T[]): Promise<T[] | null> {
  const idx = await getTasteIndex();
  if (!idx) return null;
  const taste = await loadUserTaste(userId, idx);
  if (!taste) return null;

  const withVec: { row: T; vec: number[]; rel: number; cat: string }[] = [];
  const noVec: T[] = [];
  for (const row of rows) {
    const vec = idx.get(row.id);
    if (vec)
      withVec.push({
        row,
        vec,
        rel:
          cosineSimilarity(taste, vec) +
          QUALITY_PRIOR_WEIGHT *
            coldStartRelevance(
              Number(row.rating ?? 0),
              row.review_count ?? 0,
              row.curation_tier === "curated",
            ),
        cat: categoryOf(row.type),
      });
    else noVec.push(row);
  }
  withVec.sort((a, b) => b.rel - a.rel);

  // Category-balanced pool: the top-relevance head PLUS the best few of EACH
  // category — so an all-one-type taste still has cross-category candidates.
  // Then re-rank with a category-spread penalty so the feed interleaves.
  const poolMap = new Map<string, (typeof withVec)[number]>();
  for (const x of withVec.slice(0, POOL_HEAD)) poolMap.set(x.row.id, x);
  const perCat: Record<string, number> = {};
  for (const x of withVec) {
    if ((perCat[x.cat] ?? 0) >= POOL_PER_CAT) continue;
    poolMap.set(x.row.id, x);
    perCat[x.cat] = (perCat[x.cat] ?? 0) + 1;
  }
  const pool = [...poolMap.values()].map((x) => ({
    id: x.row.id,
    vec: x.vec,
    rel: x.rel,
    category: x.cat,
    row: x.row,
  }));
  const diversified = mmrRerank<RankItem & { row: T }>(
    pool,
    pool.length,
    MMR_LAMBDA,
    CATEGORY_PENALTY,
  );

  const headIds = new Set(diversified.map((d) => d.id));
  return [
    ...diversified.map((d) => d.row),
    ...withVec.filter((x) => !headIds.has(x.row.id)).map((x) => x.row),
    ...noVec,
  ];
}

// Serialisation guard: the scores map crosses the server→client RSC boundary
// on /plan (and the my-taste server action), and uuid keys + full-precision
// floats for the whole catalogue cost ~100KB+ of payload. In centred space
// most venues sit near 0 and contribute nothing the plan's taste blend can
// feel (|s| < 0.05 at taste-weight 8 → under 0.4 of a ~8-point vibe scale),
// so drop them (consumers read missing keys as 0) and round the rest to 3 dp.
export const TASTE_SCORE_MIN = 0.05;

/** Drop near-zero scores and round to 3 dp, purely to shrink the JSON. */
export function compactTasteScores(
  scores: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, s] of Object.entries(scores)) {
    if (Math.abs(s) < TASTE_SCORE_MIN) continue;
    out[id] = Math.round(s * 1000) / 1000;
  }
  return out;
}

/**
 * Per-venue taste relevance (centred cosine) for a user as a JSON-serialisable
 * map — so the server can compute it and hand it to the CLIENT plan engine
 * (which can't read the service-role embeddings itself). Compacted for the
 * wire (see compactTasteScores); consumers treat missing keys as 0. null = no
 * signal / no embeddings → the planner runs without personalisation.
 */
export async function tasteScoresForUser(
  userId: string,
): Promise<Record<string, number> | null> {
  const idx = await getTasteIndex();
  if (!idx) return null;
  const taste = await loadUserTaste(userId, idx);
  if (!taste) return null;
  const out: Record<string, number> = {};
  for (const [id, vec] of idx) out[id] = cosineSimilarity(taste, vec);
  return compactTasteScores(out);
}
