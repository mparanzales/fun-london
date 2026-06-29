// Stage 1.2 — embed each venue's Google reviews into a 384-d vector and store
// it in public.venue_embeddings. Reviews carry the *feel* of a place that tags
// alone can't: two venues that share no tags but read the same end up as
// neighbours. Runs locally on CPU via all-MiniLM-L6-v2 (~$0, no API/vendor).
//
// Each review is embedded separately — the model truncates at 256 tokens, so
// concatenating 5 reviews would drop most of them — then the per-review unit
// vectors are mean-pooled and re-normalised into one venue vector.
//
//   pnpm embed-reviews:dry      # smoke-test on a few venues (dims/norm), no write
//   pnpm embed-reviews          # embed every visible venue, upsert venue_embeddings
//   pnpm embed-reviews --stale  # only (re)embed venues whose reviews changed
//
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { pipeline } from "@xenova/transformers";

const MODEL = "Xenova/all-MiniLM-L6-v2";
const DIM = 384;
const DRY = process.argv.includes("--dry-run");
const STALE_ONLY = process.argv.includes("--stale");
const DRY_LIMIT = 8;
const UPSERT_BATCH = 100;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE, {
  auth: { persistSession: false },
});

type Review = { text?: string };
type VenueRow = {
  id: string;
  name: string;
  reviews: Review[] | null;
  reviews_synced_at: string | null;
};

// Minimal structural type so we don't couple to @xenova's exported generics.
type Extractor = (
  texts: string[],
  opts: { pooling: "mean"; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

let _extractor: Extractor | null = null;
async function getExtractor(): Promise<Extractor> {
  if (!_extractor) {
    _extractor = (await pipeline(
      "feature-extraction",
      MODEL,
    )) as unknown as Extractor;
  }
  return _extractor;
}

function reviewTexts(reviews: Review[] | null): string[] {
  if (!Array.isArray(reviews)) return [];
  return reviews
    .map((r) => (typeof r?.text === "string" ? r.text.trim() : ""))
    .filter((t) => t.length > 0);
}

function meanPoolUnit(vectors: number[][]): number[] {
  const out = new Array<number>(DIM).fill(0);
  for (const v of vectors) for (let i = 0; i < DIM; i++) out[i] += v[i];
  let mag = 0;
  for (let i = 0; i < DIM; i++) {
    out[i] /= vectors.length;
    mag += out[i] * out[i];
  }
  mag = Math.sqrt(mag) || 1;
  for (let i = 0; i < DIM; i++) out[i] /= mag;
  return out;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < DIM; i++) dot += a[i] * b[i];
  return dot; // both unit-norm → dot == cosine
}

// Embed a venue's review texts → one unit 384-d vector (null if no usable text).
async function embedReviews(texts: string[]): Promise<number[] | null> {
  if (texts.length === 0) return null;
  const extractor = await getExtractor();
  const out = await extractor(texts, { pooling: "mean", normalize: true });
  const perReview = out.tolist(); // [n, 384] unit vectors
  if (!perReview.length || perReview[0].length !== DIM) {
    throw new Error(`unexpected embedding shape ${perReview.length}x${perReview[0]?.length}`);
  }
  return meanPoolUnit(perReview);
}

const toVectorLiteral = (v: number[]) => `[${v.map((x) => x.toFixed(6)).join(",")}]`;

async function loadVenues(): Promise<VenueRow[]> {
  const rows: VenueRow[] = [];
  const PAGE = 500;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("venues")
      .select("id, name, reviews, reviews_synced_at")
      .is("hidden_at", null)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error(`read failed: ${error.message}`);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    rows.push(...(data as VenueRow[]));
    if (data.length < PAGE) break;
  }
  return rows;
}

// venue_id → { reviews_synced_at, model } of the already-stored embedding.
async function loadExisting(): Promise<Map<string, { syncedAt: string | null; model: string }>> {
  const map = new Map<string, { syncedAt: string | null; model: string }>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("venue_embeddings")
      .select("venue_id, reviews_synced_at, model")
      .range(from, from + PAGE - 1);
    if (error) {
      console.error(`read venue_embeddings failed: ${error.message}`);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    for (const r of data as { venue_id: string; reviews_synced_at: string | null; model: string }[]) {
      map.set(r.venue_id, { syncedAt: r.reviews_synced_at, model: r.model });
    }
    if (data.length < PAGE) break;
  }
  return map;
}

async function main() {
  console.log(
    `embed-reviews · model=${MODEL} · ${DRY ? "DRY-RUN (no write)" : "WRITE"}${STALE_ONLY ? " · stale-only" : ""}\n`,
  );

  const venues = await loadVenues();
  let candidates = venues
    .map((v) => ({ v, texts: reviewTexts(v.reviews) }))
    .filter((c) => c.texts.length > 0);
  console.log(`${venues.length} visible venues · ${candidates.length} with usable reviews`);

  if (STALE_ONLY) {
    const existing = await loadExisting();
    candidates = candidates.filter(({ v }) => {
      const e = existing.get(v.id);
      if (!e || e.model !== MODEL) return true; // never embedded / different model
      if (!e.syncedAt) return true;
      if (!v.reviews_synced_at) return false;
      return new Date(v.reviews_synced_at) > new Date(e.syncedAt); // reviews refreshed since
    });
    console.log(`stale-only → ${candidates.length} need (re)embedding`);
  }

  if (DRY) {
    const sample = candidates.slice(0, DRY_LIMIT);
    const vecs: { name: string; vec: number[]; n: number }[] = [];
    for (const { v, texts } of sample) {
      const vec = await embedReviews(texts);
      if (!vec) continue;
      const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
      vecs.push({ name: v.name, vec, n: texts.length });
      console.log(`  ${v.name.padEnd(34)} dim=${vec.length} norm=${norm.toFixed(4)} reviews=${texts.length}`);
    }
    // nearest neighbour within the tiny sample — just proves cosine ordering works
    if (vecs.length >= 2) {
      console.log("\nClosest pair in sample (sanity only — real check is post-write):");
      let best = { a: "", b: "", c: -2 };
      for (let i = 0; i < vecs.length; i++)
        for (let j = i + 1; j < vecs.length; j++) {
          const c = cosine(vecs[i].vec, vecs[j].vec);
          if (c > best.c) best = { a: vecs[i].name, b: vecs[j].name, c };
        }
      console.log(`  ${best.a} ~ ${best.b}  cos=${best.c.toFixed(3)}`);
    }
    console.log("\nDRY-RUN complete — nothing written.");
    return;
  }

  let done = 0;
  let batch: Record<string, unknown>[] = [];
  const flush = async () => {
    if (batch.length === 0) return;
    const { error } = await supabase
      .from("venue_embeddings")
      .upsert(batch, { onConflict: "venue_id" });
    if (error) {
      console.error(`\nupsert failed: ${error.message}`);
      process.exit(1);
    }
    batch = [];
  };

  const nowIso = new Date().toISOString();
  for (const { v, texts } of candidates) {
    const vec = await embedReviews(texts);
    if (!vec) continue;
    batch.push({
      venue_id: v.id,
      review_embedding: toVectorLiteral(vec),
      model: MODEL,
      source_reviews_count: texts.length,
      reviews_synced_at: v.reviews_synced_at,
      updated_at: nowIso,
    });
    done++;
    if (batch.length >= UPSERT_BATCH) await flush();
    if (done % 200 === 0) console.log(`  embedded ${done}/${candidates.length}`);
  }
  await flush();
  console.log(`\nDone — embedded ${done} venues into venue_embeddings.`);
}

main().catch((e) => {
  console.error("\nFATAL:", e);
  process.exit(1);
});
