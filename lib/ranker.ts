// Stage 3 — the ranker (pure core).
//
// Given a user's taste vector (Stage 2.1) and the catalogue's centred hybrid
// vectors (Stage 1.3), produce the For You order:
//   1. CENTRE — subtract the catalogue centroid so cosine reflects DISTINCTIVE
//      taste, not the shared "all venues read nice" baseline. Validated in
//      scripts/verify-personas.ts: this kills the popularity bias (glossy venues
//      leaking into every feed).
//   2. SCORE — relevance = cosine(centred taste, centred venue). Cold-start
//      (no taste yet) falls back to a quality score so a new user still gets a
//      sensible, non-random feed.
//   3. DIVERSIFY — MMR re-rank so the feed isn't 10 near-identical wine bars.
//
// All pure + framework-free so it's unit-testable; the server data layer
// (cached catalogue load + hard filters) wires these together.

import { cosineSimilarity, normalise } from "./tag-vocabulary";
import { HYBRID_DIM } from "./hybrid-vector";

// ── Centering ──────────────────────────────────────────────────────────────

/** Mean of a set of vectors (the catalogue centroid). */
export function centroidOf(vectors: number[][]): number[] {
  const dim = vectors[0]?.length ?? HYBRID_DIM;
  const m = new Array<number>(dim).fill(0);
  if (vectors.length === 0) return m;
  for (const v of vectors) for (let i = 0; i < dim; i++) m[i] += v[i];
  for (let i = 0; i < dim; i++) m[i] /= vectors.length;
  return m;
}

/** Subtract the centroid and re-normalise (the centred unit vector). */
export function centerVector(v: number[], centroid: number[]): number[] {
  return normalise(v.map((x, i) => x - (centroid[i] ?? 0)));
}

// ── Cold-start quality score ────────────────────────────────────────────────

// Bayesian shrink so a 5.0 from 10 reviews doesn't beat a 4.7 from 5,000:
// pull each rating toward the catalogue prior by its review count.
const BAYES_PRIOR_MEAN = 4.5; // London curated ratings skew high
const BAYES_PRIOR_WEIGHT = 50; // ~reviews needed to trust a venue's own rating

/** Neutral quality relevance for users with no taste yet (new / opted-out).
 *  Bayesian-weighted rating (rewards well-reviewed quality, not lucky 5.0s) plus
 *  a small curated bump. Spreads scores so the cold-start feed isn't all ties. */
export function coldStartRelevance(rating: number, reviewCount: number, curated: boolean): number {
  const n = Math.max(0, reviewCount);
  const bayes = (n * rating + BAYES_PRIOR_WEIGHT * BAYES_PRIOR_MEAN) / (n + BAYES_PRIOR_WEIGHT);
  const quality = Math.max(0, Math.min(1, (bayes - 3.8) / (5 - 3.8)));
  return quality + (curated ? 0.1 : 0);
}

// ── MMR diversity re-rank ────────────────────────────────────────────────────

export interface RankItem {
  id: string;
  vec: number[]; // centred hybrid vector (for novelty comparisons)
  rel: number; // relevance to the user (taste cosine, or cold-start quality)
}

/**
 * Maximal Marginal Relevance: greedily pick items that are relevant but NOT
 * near-duplicates of what's already picked.
 *   score'(d) = λ·rel(d) − (1−λ)·max_{p∈picked} cos(d, p)
 * λ=1 → pure relevance; lower λ → more diverse. Default 0.7 leans relevance.
 */
export function mmrRerank<T extends RankItem>(items: T[], k: number, lambda = 0.7): T[] {
  const pool = [...items].sort((a, b) => b.rel - a.rel);
  const picked: T[] = [];
  while (picked.length < k && pool.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      let maxSim = 0;
      for (const p of picked) {
        const s = cosineSimilarity(pool[i].vec, p.vec);
        if (s > maxSim) maxSim = s;
      }
      const score = lambda * pool[i].rel - (1 - lambda) * maxSim;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    picked.push(pool.splice(bestIdx, 1)[0]);
  }
  return picked;
}

// ── Top-level ranking ────────────────────────────────────────────────────────

export interface Candidate {
  id: string;
  vec: number[]; // centred hybrid vector
  rating: number;
  reviewCount: number;
  curated: boolean;
}

export interface RankOptions {
  limit: number;
  lambda?: number; // MMR diversity knob (default 0.7)
  diversify?: boolean; // default true
}

export interface Ranked {
  id: string;
  rel: number;
  personalised: boolean;
}

/**
 * Rank candidates for a user. If the taste vector carries signal, relevance is
 * the centred-cosine taste match; otherwise we fall back to the cold-start
 * quality score (so a brand-new user still gets a good, diverse feed — step 2.2
 * cold-start handoff). MMR diversity is applied by default.
 *
 * Candidates must already be hard-filtered (open / in-area / in-budget) and
 * their `vec` already centred.
 */
export function rankForTaste(
  taste: number[],
  candidates: Candidate[],
  opts: RankOptions,
): Ranked[] {
  const personalised = taste.some((x) => x !== 0);
  const items: RankItem[] = candidates.map((c) => ({
    id: c.id,
    vec: c.vec,
    rel: personalised ? cosineSimilarity(taste, c.vec) : coldStartRelevance(c.rating, c.reviewCount, c.curated),
  }));
  const ordered =
    opts.diversify === false
      ? items.sort((a, b) => b.rel - a.rel).slice(0, opts.limit)
      : mmrRerank(items, opts.limit, opts.lambda);
  return ordered.map((r) => ({ id: r.id, rel: r.rel, personalised }));
}
