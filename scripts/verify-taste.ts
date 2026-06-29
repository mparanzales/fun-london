// Stage 2.1 proof — build a real user's taste vector from their user_events and
// show what "For You" would surface. Read-only; no API, no writes.
//
//   pnpm verify-taste            # the user with the most signals (default)
//   pnpm verify-taste <user_id>  # a specific user
//
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { type Tag, tagsToWeightedVector, cosineSimilarity } from "@/lib/tag-vocabulary";
import { buildHybridVector, REVIEW_DIM } from "@/lib/hybrid-vector";
import {
  buildTasteVector,
  signalWeight,
  type TasteSignal,
} from "@/lib/taste-vector";
import type { SignalType } from "@/lib/signals";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
const NOW = Date.now();

function parseVector(v: unknown): number[] | null {
  if (Array.isArray(v)) return v as number[];
  if (typeof v === "string") {
    try {
      const a = JSON.parse(v) as number[];
      return Array.isArray(a) && a.length === REVIEW_DIM ? a : null;
    } catch {
      return null;
    }
  }
  return null;
}

type Venue = { name: string; type: string; hybrid: number[] };

async function loadVenues(): Promise<Map<string, { name: string; type: string; tags: string[] }>> {
  const m = new Map<string, { name: string; type: string; tags: string[] }>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("venues")
      .select("id, name, type, canonical_tags")
      .is("hidden_at", null)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    for (const r of data as { id: string; name: string; type: string; canonical_tags: string[] | null }[])
      m.set(r.id, { name: r.name, type: r.type, tags: r.canonical_tags ?? [] });
    if (data.length < 1000) break;
  }
  return m;
}

async function loadEmbeddings(): Promise<Map<string, number[]>> {
  const m = new Map<string, number[]>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("venue_embeddings")
      .select("venue_id, review_embedding")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    for (const r of data as { venue_id: string; review_embedding: unknown }[]) {
      const v = parseVector(r.review_embedding);
      if (v) m.set(r.venue_id, v);
    }
    if (data.length < 1000) break;
  }
  return m;
}

type EventRow = {
  user_id: string;
  venue_id: string | null;
  event_type: SignalType;
  context: Record<string, unknown> | null;
  created_at: string;
};

async function loadEvents(): Promise<EventRow[]> {
  const rows: EventRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("user_events")
      .select("user_id, venue_id, event_type, context, created_at")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    rows.push(...(data as EventRow[]));
    if (data.length < 1000) break;
  }
  return rows;
}

async function main() {
  const [venueMeta, embeddings, events] = await Promise.all([
    loadVenues(),
    loadEmbeddings(),
    loadEvents(),
  ]);

  // Hybrid vector per venue.
  const venues = new Map<string, Venue>();
  for (const [id, v] of venueMeta) {
    venues.set(id, {
      name: v.name,
      type: v.type,
      hybrid: buildHybridVector(v.tags as Tag[], embeddings.get(id) ?? null),
    });
  }

  // Pick the target user (arg, else the most active).
  const argUser = process.argv[2];
  const byUser = new Map<string, number>();
  for (const e of events) byUser.set(e.user_id, (byUser.get(e.user_id) ?? 0) + 1);
  const userId = argUser ?? [...byUser.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!userId) {
    console.log("No user_events yet.");
    return;
  }
  const mine = events.filter((e) => e.user_id === userId);
  console.log(`User ${userId.slice(0, 8)}… · ${mine.length} signals · ${byUser.size} user(s) total\n`);

  // Build taste signals from events that map to a venue we have a vector for.
  const signals: TasteSignal[] = [];
  const engaged = new Set<string>(); // venues she actively engaged (exclude from recs)
  const savedNames: string[] = [];
  for (const e of mine) {
    if (!e.venue_id) continue;
    const v = venues.get(e.venue_id);
    if (!v) continue;
    const ageDays = (NOW - Date.parse(e.created_at)) / 86_400_000;
    signals.push({ vector: v.hybrid, eventType: e.event_type, context: e.context, ageDays });
    if (signalWeight(e.event_type, e.context) > 0.25) engaged.add(e.venue_id);
    if (e.event_type === "save") savedNames.push(v.name);
  }

  const taste = buildTasteVector(signals);
  if (taste.every((x) => x === 0)) {
    console.log("Taste vector is all-zero (no net signal) → cold-start fallback would kick in.");
    return;
  }

  console.log(`Saved: ${[...new Set(savedNames)].join(", ") || "(none)"}\n`);
  console.log("── TOP 15 'For You' (taste neighbours, excluding venues already engaged) ──");
  const ranked = [...venues.entries()]
    .filter(([id]) => !engaged.has(id))
    .map(([, v]) => ({ name: v.name, type: v.type, sim: cosineSimilarity(taste, v.hybrid) }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, 15);
  for (const r of ranked) console.log(`   ${r.sim.toFixed(3)}  ${r.name} (${r.type})`);
}

main().catch((e) => {
  console.error("\nFATAL:", e);
  process.exit(1);
});
