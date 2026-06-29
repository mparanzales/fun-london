// Stage 2.1 generalisation test — does the taste vector work for tastes OTHER
// than the founder's own account? For each launch persona we seed a plausible
// set of "saves" (top-rated real venues carrying that persona's signature
// vibe-tags), build their taste vector, and show what "For You" would surface.
//
// Honest scope: this tests TASTE (vibe/cuisine) generalisation + that distinct
// personas get distinct feeds. It does NOT test hard constraints (budget,
// walk-radius, group-size) — those are Stage 3 filters, not the taste vector.
// Claire (B2B probe, no taste use case) is intentionally excluded.
//
//   pnpm verify-personas
//
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { type Tag, cosineSimilarity } from "@/lib/tag-vocabulary";
import { buildHybridVector, REVIEW_DIM } from "@/lib/hybrid-vector";
import { buildTasteVector, type TasteSignal } from "@/lib/taste-vector";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE) {
  console.error("Missing env");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

const SEED_N = 4;
const TOP_N = 10;

// Persona → signature vibe-tags (drawn from personas.md). Seeds are the
// top-rated real venues carrying these; recs show whether the engine extends
// the taste coherently.
const PERSONAS: { key: string; label: string; tags: Tag[] }[] = [
  { key: "priya", label: "Priya — premium, distinctive, anti-'everyone gets Padella'", tags: ["fine-dining", "cocktail-connoisseur", "tasting-menu", "iconic"] },
  { key: "tom", label: "Tom — relief / approachable neighbourhood gems (Soho-anchored)", tags: ["hidden-gem", "neighbourhood", "cosy"] },
  { key: "sofia", label: "Sofia — social organiser, lively group nights", tags: ["good-for-groups", "buzzy", "lively"] },
  { key: "mateo", label: "Mateo — budget postgrad, casual-but-special, building a social life", tags: ["cheap-cheerful", "casual", "small-plates"] },
  { key: "romantic", label: "Date-night (extra corner) — intimate & candlelit", tags: ["romantic", "candlelit", "date-night"] },
];

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

type Venue = { id: string; name: string; type: string; rating: number; tags: Tag[]; hybrid: number[] };

async function load(): Promise<Venue[]> {
  const meta = new Map<string, { name: string; type: string; rating: number; tags: Tag[] }>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("venues").select("id, name, type, rating, canonical_tags")
      .is("hidden_at", null).range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    for (const r of data as { id: string; name: string; type: string; rating: number | null; canonical_tags: string[] | null }[])
      meta.set(r.id, { name: r.name, type: r.type, rating: r.rating ?? 0, tags: (r.canonical_tags ?? []) as Tag[] });
    if (data.length < 1000) break;
  }
  const emb = new Map<string, number[]>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("venue_embeddings").select("venue_id, review_embedding").range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    for (const r of data as { venue_id: string; review_embedding: unknown }[]) {
      const v = parseVector(r.review_embedding);
      if (v) emb.set(r.venue_id, v);
    }
    if (data.length < 1000) break;
  }
  const out: Venue[] = [];
  for (const [id, m] of meta)
    out.push({ id, ...m, hybrid: buildHybridVector(m.tags, emb.get(id) ?? null) });
  return out;
}

// L2-normalise a copy.
function unit(v: number[]): number[] {
  let m = 0;
  for (const x of v) m += x * x;
  m = Math.sqrt(m) || 1;
  return v.map((x) => x / m);
}

async function main() {
  const venues = await load();
  console.log(`Loaded ${venues.length} venues\n`);

  // Optional mean-centering: subtract the catalogue centroid so cosine reflects
  // DISTINCTIVE taste, not the shared "all venues read nice" baseline (attacks
  // the popularity/centroid bias). Toggle with FL_CENTER=1.
  const CENTER = process.env.FL_CENTER === "1";
  if (CENTER) {
    const dim = venues[0].hybrid.length;
    const mean = new Array<number>(dim).fill(0);
    for (const v of venues) for (let i = 0; i < dim; i++) mean[i] += v.hybrid[i];
    for (let i = 0; i < dim; i++) mean[i] /= venues.length;
    for (const v of venues) v.hybrid = unit(v.hybrid.map((x, i) => x - mean[i]));
    console.log("(mean-centred: catalogue centroid subtracted)\n");
  }

  const personaTop = new Map<string, Set<string>>();

  for (const p of PERSONAS) {
    // Seeds: venues carrying the most of this persona's signature tags, then by rating.
    const seeds = venues
      .map((v) => ({ v, hits: p.tags.filter((t) => v.tags.includes(t)).length }))
      .filter((x) => x.hits > 0)
      .sort((a, b) => b.hits - a.hits || b.v.rating - a.v.rating)
      .slice(0, SEED_N)
      .map((x) => x.v);
    const seedIds = new Set(seeds.map((s) => s.id));
    const signals: TasteSignal[] = seeds.map((s) => ({ vector: s.hybrid, eventType: "save" }));
    const taste = buildTasteVector(signals);

    const recs = venues
      .filter((v) => !seedIds.has(v.id))
      .map((v) => ({ v, sim: cosineSimilarity(taste, v.hybrid) }))
      .sort((a, b) => b.sim - a.sim)
      .slice(0, TOP_N);
    personaTop.set(p.key, new Set(recs.map((r) => r.v.name)));

    console.log(`■ ${p.label}`);
    console.log(`   seeds: ${seeds.map((s) => s.name).join(", ")}`);
    console.log(`   FOR YOU:`);
    for (const r of recs) console.log(`     ${r.sim.toFixed(3)}  ${r.v.name} (${r.v.type})`);
    console.log("");
  }

  // Distinctness: how much do personas' top-10 feeds overlap? Low = good.
  console.log("── feed overlap (shared of top-10; low = distinct tastes) ──");
  const keys = [...personaTop.keys()];
  for (let i = 0; i < keys.length; i++)
    for (let j = i + 1; j < keys.length; j++) {
      const a = personaTop.get(keys[i])!, b = personaTop.get(keys[j])!;
      const shared = [...a].filter((x) => b.has(x)).length;
      console.log(`   ${keys[i].padEnd(9)} vs ${keys[j].padEnd(9)}: ${shared}/10 shared`);
    }
}

main().catch((e) => {
  console.error("\nFATAL:", e);
  process.exit(1);
});
