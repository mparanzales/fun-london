// Fix the events feed: (1) dedupe events that are the same thing ingested under
// name variants, then (2) give every survivor a REAL photo by resolving its
// venue through Google Places and mirroring a Places photo to keyless Storage —
// replacing brand logos / blanks with the actual venue's photo.
//
// Reuses the exact Places + storage pipeline that filled the 476 venue
// galleries. Keyed places.googleapis.com URLs are used server-side ONLY; the DB
// only ever gets the keyless `event-<id>.jpg` Storage URL (the standing invariant).
//
//   pnpm fix-events:dry     # show the dedupe + photo plan, write nothing
//   pnpm fix-events         # apply (deletes dupes, writes real photos)

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { mirrorPhotoToStorage, photoStorageEnabled } from "./photo-storage";

const WRITE = process.argv.includes("--write");
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PLACES_KEY = process.env.GOOGLE_PLACES_API_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!PLACES_KEY) {
  console.error("Missing GOOGLE_PLACES_API_KEY in .env.local");
  process.exit(1);
}
if (!photoStorageEnabled()) {
  console.error("FL_PHOTO_BUCKET not set — nothing to mirror into.");
  process.exit(1);
}

const supabase = createSupabaseClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

// ── Google Places (same shape as ingest-venues.ts) ────────────────────────
const PLACES_BASE = "https://places.googleapis.com/v1/places";

async function placeIdForVenue(query: string): Promise<string | null> {
  const res = await fetch(`${PLACES_BASE}:searchText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": PLACES_KEY!,
      "X-Goog-FieldMask": "places.id,places.displayName",
    },
    body: JSON.stringify({ textQuery: query, regionCode: "GB" }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { places?: { id: string }[] };
  return json.places?.[0]?.id ?? null;
}

async function firstPhotoName(placeId: string): Promise<string | null> {
  const res = await fetch(`${PLACES_BASE}/${placeId}`, {
    headers: { "X-Goog-Api-Key": PLACES_KEY!, "X-Goog-FieldMask": "photos" },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { photos?: { name: string }[] };
  return json.photos?.[0]?.name ?? null;
}

// ── Dedupe helpers ────────────────────────────────────────────────────────
type EventRow = {
  id: string;
  name: string;
  venue_name: string;
  area: string;
  img_url: string | null;
  source: string | null;
  source_url: string | null;
  starts_at: string | null;
  ends_at: string | null;
  description: string | null;
  price: string | null;
};

const STOP = new Set([
  "the", "a", "an", "at", "by", "of", "in", "on", "for", "and", "popup",
  "pop", "up", "shop", "store", "experience", "official", "summer", "july",
  "2026", "2025", "london", "tour", "edition", "brand",
]);

function nameTokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1 && !STOP.has(t)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function normVenue(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24);
}

function datesOverlap(a: EventRow, b: EventRow): boolean {
  const as = a.starts_at ? Date.parse(a.starts_at) : NaN;
  const ae = a.ends_at ? Date.parse(a.ends_at) : as;
  const bs = b.starts_at ? Date.parse(b.starts_at) : NaN;
  const be = b.ends_at ? Date.parse(b.ends_at) : bs;
  if (isNaN(as) || isNaN(bs)) return true; // missing dates → don't block a merge
  return as <= (isNaN(be) ? bs : be) && bs <= (isNaN(ae) ? as : ae);
}

// Keep the most complete row in a dupe cluster.
function score(e: EventRow): number {
  return (
    (e.source_url ? 2 : 0) +
    (e.description ? 1 : 0) +
    (e.price ? 1 : 0) +
    Math.min(e.name.length, 40) / 40
  );
}

async function main() {
  const { data, error } = await supabase
    .from("events")
    .select(
      "id,name,venue_name,area,img_url,source,source_url,starts_at,ends_at,description,price",
    )
    .order("created_at", { ascending: true });
  if (error) {
    console.error(`read failed: ${error.message}`);
    process.exit(1);
  }
  const events = (data ?? []) as EventRow[];
  console.log(`Loaded ${events.length} events · ${WRITE ? "WRITE" : "DRY RUN"}\n`);

  // ── Phase 1: dedupe ──────────────────────────────────────────────────────
  // Two events are the same when they're at the same venue, their date ranges
  // overlap, and their names share ≥40% of significant tokens.
  const remaining = [...events];
  const clusters: EventRow[][] = [];
  while (remaining.length) {
    const seed = remaining.shift()!;
    const cluster = [seed];
    const seedTok = nameTokens(seed.name);
    const seedVenue = normVenue(seed.venue_name);
    for (let i = remaining.length - 1; i >= 0; i--) {
      const e = remaining[i];
      const j = jaccard(seedTok, nameTokens(e.name));
      // Same thing when dates overlap AND either the names are very similar
      // (catches venue-string variants like "Royal Academy" vs "Royal Academy
      // of Arts, Main Galleries"), or it's the same venue with a moderate match.
      if (
        datesOverlap(seed, e) &&
        (j >= 0.5 || (normVenue(e.venue_name) === seedVenue && j >= 0.34))
      ) {
        cluster.push(e);
        remaining.splice(i, 1);
      }
    }
    clusters.push(cluster);
  }

  const toDelete: EventRow[] = [];
  for (const c of clusters) {
    if (c.length === 1) continue;
    const keep = c.reduce((best, e) => (score(e) > score(best) ? e : best));
    const drop = c.filter((e) => e.id !== keep.id);
    toDelete.push(...drop);
    console.log(
      `DEDUPE @ ${keep.venue_name}: keep "${keep.name}" · drop ${drop
        .map((e) => `"${e.name}"`)
        .join(", ")}`,
    );
  }
  console.log(
    `\nDedupe: ${toDelete.length} duplicate events → ${events.length - toDelete.length} unique\n`,
  );

  if (WRITE && toDelete.length) {
    const { error: delErr } = await supabase
      .from("events")
      .delete()
      .in(
        "id",
        toDelete.map((e) => e.id),
      );
    if (delErr) console.error(`delete failed: ${delErr.message}`);
    else console.log(`Deleted ${toDelete.length} duplicate events.\n`);
  }

  if (process.argv.includes("--dedupe-only")) return;

  // ── Phase 2: real photos for survivors ──────────────────────────────────
  const survivors = events.filter((e) => !toDelete.some((d) => d.id === e.id));
  let imaged = 0;
  let missed = 0;
  for (const e of survivors) {
    const query = `${e.venue_name}, ${e.area}, London`;
    const placeId = await placeIdForVenue(query);
    const photoName = placeId ? await firstPhotoName(placeId) : null;
    if (!photoName) {
      missed++;
      console.log(`  ✗ ${e.name} — no Places photo for "${e.venue_name}"`);
      continue;
    }
    if (!WRITE) {
      imaged++;
      console.log(`  ✅ [dry] ${e.name} ← real photo of ${e.venue_name}`);
      continue;
    }
    const mirrored = await mirrorPhotoToStorage(photoName, `event-${e.id}`, supabase);
    if (!mirrored) {
      missed++;
      console.log(`  ✗ ${e.name} — mirror failed`);
      continue;
    }
    const { error: upErr } = await supabase
      .from("events")
      .update({ img_url: mirrored })
      .eq("id", e.id);
    if (upErr) {
      missed++;
      console.error(`  ✗ ${e.name} — update failed ${upErr.message}`);
      continue;
    }
    imaged++;
    console.log(`  ✅ ${e.name} ← real photo of ${e.venue_name}`);
  }

  console.log(
    `\nPhotos: ${imaged}/${survivors.length} got a real venue photo · ${missed} had no Places match.`,
  );
  console.log(
    missed > 0
      ? `(The ${missed} with no venue match need a decision — hide or placeholder.)`
      : "",
  );
}

main().catch((e) => {
  console.error("\nFATAL:", e);
  process.exit(1);
});
