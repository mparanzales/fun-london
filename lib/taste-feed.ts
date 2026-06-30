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
import { buildTasteVector, type TasteSignal } from "@/lib/taste-vector";
import { centroidOf, centerVector, mmrRerank, type RankItem } from "@/lib/ranker";
import { cosineSimilarity, type Tag } from "@/lib/tag-vocabulary";
import type { SignalType } from "@/lib/signals";

const TTL_MS = 10 * 60 * 1000;
const MMR_POOL = 60; // diversify the top N; deeper pages stay relevance-sorted (bounds MMR cost)
const MMR_LAMBDA = 0.7;

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
    const { data, error } = await sb.from("venue_embeddings").select("venue_id, review_embedding").range(from, from + 999);
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
    const { data, error } = await sb.from("venues").select("id, canonical_tags").is("hidden_at", null).range(from, from + 999);
    if (error) return null;
    if (!data?.length) break;
    for (const r of data as { id: string; canonical_tags: string[] | null }[]) tags.set(r.id, r.canonical_tags ?? []);
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

/** The user's taste vector in the centred space, or null if no usable signal. */
async function loadUserTaste(userId: string, idx: Map<string, number[]>): Promise<number[] | null> {
  const sb = createServiceClient();
  if (!sb) return null;
  const { data, error } = await sb
    .from("user_events")
    .select("venue_id, event_type, context, created_at")
    .eq("user_id", userId);
  if (error || !data?.length) return null;
  const now = Date.now();
  const signals: TasteSignal[] = [];
  for (const e of data as { venue_id: string | null; event_type: string; context: Record<string, unknown> | null; created_at: string }[]) {
    const v = e.venue_id ? idx.get(e.venue_id) : null;
    if (!v) continue;
    signals.push({
      vector: v,
      eventType: e.event_type as SignalType,
      context: e.context,
      ageDays: (now - Date.parse(e.created_at)) / 86_400_000,
    });
  }
  if (signals.length === 0) return null;
  const taste = buildTasteVector(signals);
  return taste.some((x) => x !== 0) ? taste : null;
}

/**
 * Reorder feed rows by the user's taste (centred cosine + MMR over the head).
 * Returns null to fall back to the default order. Rows without a vector keep
 * their original relative order at the tail.
 */
export async function rankRowsByTaste<T extends { id: string }>(
  userId: string,
  rows: T[],
): Promise<T[] | null> {
  const idx = await getTasteIndex();
  if (!idx) return null;
  const taste = await loadUserTaste(userId, idx);
  if (!taste) return null;

  const withVec: { row: T; vec: number[]; rel: number }[] = [];
  const noVec: T[] = [];
  for (const row of rows) {
    const vec = idx.get(row.id);
    if (vec) withVec.push({ row, vec, rel: cosineSimilarity(taste, vec) });
    else noVec.push(row);
  }
  withVec.sort((a, b) => b.rel - a.rel);

  const poolN = Math.min(MMR_POOL, withVec.length);
  const pool = withVec.slice(0, poolN).map((x) => ({ id: x.row.id, vec: x.vec, rel: x.rel, row: x.row }));
  const diversified = mmrRerank<RankItem & { row: T }>(pool, poolN, MMR_LAMBDA);

  return [...diversified.map((d) => d.row), ...withVec.slice(poolN).map((x) => x.row), ...noVec];
}
