// Stage 1.3 proof — show that the HYBRID vector (tags + reviews) gives better
// "you'll also like…" neighbours than tags ALONE, and read out the review-only
// neighbours too (Stage 1.2) for contrast. Read-only; no API, no writes.
//
//   pnpm verify-hybrid                 # default seed venues
//   pnpm verify-hybrid "Ronnie,Bao"    # comma-separated name substrings
//
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import {
  type Tag,
  tagsToWeightedVector,
  cosineSimilarity,
} from "@/lib/tag-vocabulary";
import { buildHybridVector, REVIEW_DIM, HYBRID_WEIGHTS } from "@/lib/hybrid-vector";

// Optional weight override for calibration: HYBRID_W="tag,review" (e.g. "0.5,1").
const W = process.env.HYBRID_W
  ? (() => {
      const [t, r] = process.env.HYBRID_W!.split(",").map(Number);
      return { tag: t, review: r };
    })()
  : HYBRID_WEIGHTS;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE, {
  auth: { persistSession: false },
});

const SEEDS = (process.argv[2] ?? "Ronnie Scott,Bao Soho,Lighterman,Artesian,Spiritland")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

type Item = {
  id: string;
  name: string;
  type: string;
  tagVec: number[];
  reviewVec: number[] | null;
  hybridVec: number[];
};

function parseVector(v: unknown): number[] | null {
  if (Array.isArray(v)) return v as number[];
  if (typeof v === "string") {
    try {
      const arr = JSON.parse(v) as number[];
      return Array.isArray(arr) && arr.length === REVIEW_DIM ? arr : null;
    } catch {
      return null;
    }
  }
  return null;
}

async function loadVenues(): Promise<Map<string, { name: string; type: string; tags: string[] }>> {
  const map = new Map<string, { name: string; type: string; tags: string[] }>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("venues")
      .select("id, name, type, canonical_tags")
      .is("hidden_at", null)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const r of data as { id: string; name: string; type: string; canonical_tags: string[] | null }[]) {
      map.set(r.id, { name: r.name, type: r.type, tags: r.canonical_tags ?? [] });
    }
    if (data.length < PAGE) break;
  }
  return map;
}

async function loadEmbeddings(): Promise<Map<string, number[]>> {
  const map = new Map<string, number[]>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("venue_embeddings")
      .select("venue_id, review_embedding")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const r of data as { venue_id: string; review_embedding: unknown }[]) {
      const vec = parseVector(r.review_embedding);
      if (vec) map.set(r.venue_id, vec);
    }
    if (data.length < PAGE) break;
  }
  return map;
}

function topN(
  seed: Item,
  all: Item[],
  key: (i: Item) => number[] | null,
  n = 5,
): { name: string; type: string; sim: number }[] {
  const sv = key(seed);
  if (!sv) return [];
  return all
    .filter((i) => i.id !== seed.id)
    .map((i) => {
      const v = key(i);
      return v ? { name: i.name, type: i.type, sim: cosineSimilarity(sv, v) } : null;
    })
    .filter((x): x is { name: string; type: string; sim: number } => x !== null)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, n);
}

async function main() {
  const [venues, embeddings] = await Promise.all([loadVenues(), loadEmbeddings()]);
  console.log(`Loaded ${venues.size} venues, ${embeddings.size} review embeddings · weights tag=${W.tag} review=${W.review}\n`);

  const items: Item[] = [];
  for (const [id, v] of venues) {
    const reviewVec = embeddings.get(id) ?? null;
    const tagVec = tagsToWeightedVector(v.tags as Tag[]);
    items.push({
      id,
      name: v.name,
      type: v.type,
      tagVec,
      reviewVec,
      hybridVec: buildHybridVector(v.tags as Tag[], reviewVec, W),
    });
  }

  const fmt = (rows: { name: string; type: string; sim: number }[]) =>
    rows.map((r) => `      ${r.sim.toFixed(3)}  ${r.name} (${r.type})`).join("\n");

  for (const needle of SEEDS) {
    const seed = items.find((i) => i.name.toLowerCase().includes(needle));
    if (!seed) {
      console.log(`(no venue matching "${needle}")\n`);
      continue;
    }
    console.log(`■ ${seed.name} (${seed.type})`);
    console.log(`   TAGS-ALONE (1.1):\n${fmt(topN(seed, items, (i) => i.tagVec))}`);
    console.log(`   REVIEWS-ALONE (1.2):\n${fmt(topN(seed, items, (i) => i.reviewVec))}`);
    console.log(`   HYBRID (1.3):\n${fmt(topN(seed, items, (i) => i.hybridVec))}`);
    console.log("");
  }
}

main().catch((e) => {
  console.error("\nFATAL:", e);
  process.exit(1);
});
