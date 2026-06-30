// Stage 3 proof — run the REAL ranker (centre → taste → MMR) end-to-end against
// prod data: a personalised feed (the founder's signals), a cold-start feed
// (no taste), and an MMR-on vs MMR-off diversity comparison. Read-only.
//
//   pnpm verify-ranker
//
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { type Tag } from "@/lib/tag-vocabulary";
import { buildHybridVector, REVIEW_DIM } from "@/lib/hybrid-vector";
import { buildTasteVector, type TasteSignal } from "@/lib/taste-vector";
import { centroidOf, centerVector, rankForTaste, type Candidate } from "@/lib/ranker";
import type { SignalType } from "@/lib/signals";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPABASE_URL || !SERVICE) { console.error("Missing env"); process.exit(1); }
const supabase = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
const NOW = Date.now();

function parseVec(v: unknown): number[] | null {
  if (Array.isArray(v)) return v as number[];
  if (typeof v === "string") { try { const a = JSON.parse(v) as number[]; return a.length === REVIEW_DIM ? a : null; } catch { return null; } }
  return null;
}

type V = { id: string; name: string; type: string; rating: number; reviewCount: number; curated: boolean; centered: number[] };

async function page<T>(table: string, cols: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase.from(table).select(cols).range(from, from + 999);
    if (table === "venues") q = q.is("hidden_at", null);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    out.push(...(data as T[]));
    if (data.length < 1000) break;
  }
  return out;
}

async function main() {
  const vrows = await page<{ id: string; name: string; type: string; rating: number | null; review_count: number | null; curation_tier: string | null; canonical_tags: string[] | null }>(
    "venues", "id, name, type, rating, review_count, curation_tier, canonical_tags");
  const erows = await page<{ venue_id: string; review_embedding: unknown }>("venue_embeddings", "venue_id, review_embedding");
  const emb = new Map(erows.map((r) => [r.venue_id, parseVec(r.review_embedding)]).filter(([, v]) => v) as [string, number[]][]);

  // Build hybrid, then CENTRE the whole catalogue (the validated fix).
  const hybrids = vrows.map((r) => buildHybridVector((r.canonical_tags ?? []) as Tag[], emb.get(r.id) ?? null));
  const centroid = centroidOf(hybrids);
  const venues: V[] = vrows.map((r, i) => ({
    id: r.id, name: r.name, type: r.type, rating: r.rating ?? 0, reviewCount: r.review_count ?? 0,
    curated: r.curation_tier === "curated", centered: centerVector(hybrids[i], centroid),
  }));
  const byId = new Map(venues.map((v) => [v.id, v]));
  const candidates: Candidate[] = venues.map((v) => ({ id: v.id, vec: v.centered, rating: v.rating, reviewCount: v.reviewCount, curated: v.curated }));
  console.log(`Catalogue: ${venues.length} venues (centred)\n`);

  // ── Personalised feed (founder's real signals) ──
  const events = await page<{ user_id: string; venue_id: string | null; event_type: SignalType; context: Record<string, unknown> | null; created_at: string }>(
    "user_events", "user_id, venue_id, event_type, context, created_at");
  const topUser = [...events.reduce((m, e) => m.set(e.user_id, (m.get(e.user_id) ?? 0) + 1), new Map<string, number>())]
    .sort((a, b) => b[1] - a[1])[0]?.[0];
  const mine = events.filter((e) => e.user_id === topUser);
  const signals: TasteSignal[] = [];
  const engaged = new Set<string>();
  for (const e of mine) {
    const v = e.venue_id ? byId.get(e.venue_id) : null;
    if (!v) continue;
    signals.push({ vector: v.centered, eventType: e.event_type, context: e.context, ageDays: (NOW - Date.parse(e.created_at)) / 86_400_000 });
    if (["save", "open", "outbound_click"].includes(e.event_type)) engaged.add(e.venue_id!);
  }
  const taste = buildTasteVector(signals);
  const pool = candidates.filter((c) => !engaged.has(c.id));

  const show = (label: string, ranked: { id: string; rel: number }[]) => {
    console.log(label);
    for (const r of ranked.slice(0, 12)) { const v = byId.get(r.id)!; console.log(`   ${r.rel.toFixed(3)}  ${v.name} (${v.type})`); }
    console.log("");
  };

  show(`■ PERSONALISED — user ${topUser?.slice(0, 8)}… (${signals.length} signals), MMR on:`,
    rankForTaste(taste, pool, { limit: 12 }));

  // ── MMR on vs off (diversity) ──
  const mmrOff = rankForTaste(taste, pool, { limit: 12, diversify: false }).map((r) => byId.get(r.id)!.type);
  const mmrOn = rankForTaste(taste, pool, { limit: 12 }).map((r) => byId.get(r.id)!.type);
  console.log(`MMR diversity — venue-type spread in top 12:`);
  console.log(`   off: ${[...new Set(mmrOff)].length} types  ${JSON.stringify(tally(mmrOff))}`);
  console.log(`   on : ${[...new Set(mmrOn)].length} types  ${JSON.stringify(tally(mmrOn))}\n`);

  // ── Cold-start (no taste) ──
  show("■ COLD-START — zero taste → quality + diversity:",
    rankForTaste(new Array(taste.length).fill(0), candidates, { limit: 12 }));
}

function tally(xs: string[]): Record<string, number> {
  return xs.reduce((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {} as Record<string, number>);
}

main().catch((e) => { console.error("\nFATAL:", e); process.exit(1); });
