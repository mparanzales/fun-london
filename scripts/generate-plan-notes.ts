// Stage 4.3 — generate a grounded "why this stop" note for each venue and store
// it in public.venues.plan_note. The plan UI renders it under each stop; a venue
// with no note simply shows none (fail-open).
//
// Pipeline (honest end-to-end — see lib/plan-note.ts):
//   pick a real Google review snippet  →  Gemini writes ONE line grounded only
//   in that snippet  →  a groundedness gate REJECTS any line that makes a claim
//   the snippet doesn't (then we retry once, then skip rather than fabricate).
//
//   pnpm generate-plan-notes:dry     # smoke-test a few venues, print lines, no write
//   pnpm generate-plan-notes         # generate for every visible venue with reviews
//   pnpm generate-plan-notes --stale # only venues whose reviews changed since last run
//
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import type { VenueReview } from "@/lib/types";
import {
  pickReviewSnippet,
  buildPlanNotePrompt,
  isGrounded,
  MAX_NOTE_CHARS,
} from "@/lib/plan-note";

const DRY = process.argv.includes("--dry-run");
const STALE_ONLY = process.argv.includes("--stale");
const DRY_LIMIT = 10;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!SUPABASE_URL || !SERVICE) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
  );
  process.exit(1);
}
if (!GEMINI_API_KEY) {
  console.error("Missing GEMINI_API_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE, {
  auth: { persistSession: false },
});

type VenueRow = {
  id: string;
  name: string;
  type: string;
  neighbourhood: string | null;
  reviews: VenueReview[] | null;
  reviews_synced_at: string | null;
  plan_note: string | null;
  plan_note_synced_at: string | null;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Gemini (same paced, retrying choke-point as scripts/discover-venues.ts) ──
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
const GEMINI_MIN_GAP_MS = 4500; // ~13 calls/min, under the free-tier ceiling
const GEMINI_MAX_RETRIES = 4;
let lastGeminiAt = 0;

async function geminiText(prompt: string): Promise<string> {
  let attempt = 0;
  for (;;) {
    const since = Date.now() - lastGeminiAt;
    if (since < GEMINI_MIN_GAP_MS) await sleep(GEMINI_MIN_GAP_MS - since);
    lastGeminiAt = Date.now();
    const res = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    if (
      (res.status === 429 || res.status === 503) &&
      attempt < GEMINI_MAX_RETRIES
    ) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const backoff =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : GEMINI_MIN_GAP_MS * Math.pow(2, attempt);
      console.log(
        `    ⏳ Gemini ${res.status} — backing off ${Math.round(backoff / 1000)}s (retry ${attempt + 1}/${GEMINI_MAX_RETRIES})`,
      );
      await sleep(backoff);
      attempt++;
      continue;
    }
    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    return (
      data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ??
      ""
    );
  }
}

// Normalise Gemini's reply to a single clean line: first non-empty line, no
// surrounding quotes, collapsed whitespace, clipped to the cap.
function cleanLine(raw: string): string {
  const line = (raw.split("\n").find((l) => l.trim().length > 0) ?? "").trim();
  return line
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, MAX_NOTE_CHARS)
    .trim();
}

// Generate a grounded note for one venue, or null if it can't be grounded.
async function noteFor(v: VenueRow): Promise<string | null> {
  const snippet = pickReviewSnippet(v.reviews);
  if (!snippet) return null;
  const venue = {
    name: v.name,
    type: v.type,
    neighbourhood: v.neighbourhood ?? "London",
  };
  const prompt = buildPlanNotePrompt(venue, snippet);
  // Up to two attempts: a clean line that passes the groundedness gate wins;
  // otherwise we skip rather than store something the review can't back up.
  for (let attempt = 0; attempt < 2; attempt++) {
    const line = cleanLine(await geminiText(prompt));
    if (line && isGrounded(line, snippet, venue)) return line;
  }
  return null;
}

async function loadVenues(): Promise<VenueRow[]> {
  const rows: VenueRow[] = [];
  const PAGE = 500;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("venues")
      .select(
        "id, name, type, neighbourhood, reviews, reviews_synced_at, plan_note, plan_note_synced_at",
      )
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

async function main() {
  console.log(
    `generate-plan-notes · gemini-2.5-flash · ${DRY ? "DRY-RUN (no write)" : "WRITE"}${STALE_ONLY ? " · stale-only" : ""}\n`,
  );

  const venues = await loadVenues();
  let candidates = venues.filter((v) => pickReviewSnippet(v.reviews) !== null);
  console.log(
    `${venues.length} visible venues · ${candidates.length} with a usable review snippet`,
  );

  if (STALE_ONLY) {
    candidates = candidates.filter((v) => {
      if (!v.plan_note || !v.plan_note_synced_at) return true; // never generated
      if (!v.reviews_synced_at) return false;
      return new Date(v.reviews_synced_at) > new Date(v.plan_note_synced_at);
    });
    console.log(`stale-only → ${candidates.length} need (re)generation`);
  }

  if (DRY) {
    for (const v of candidates.slice(0, DRY_LIMIT)) {
      const note = await noteFor(v);
      console.log(
        `  ${v.name.padEnd(30)} ${note ? `→ "${note}"` : "→ (ungrounded, skipped)"}`,
      );
    }
    console.log("\nDRY-RUN complete — nothing written.");
    return;
  }

  let written = 0;
  let skipped = 0;
  for (const v of candidates) {
    const note = await noteFor(v);
    if (!note) {
      skipped++;
      continue;
    }
    const { error } = await supabase
      .from("venues")
      .update({ plan_note: note, plan_note_synced_at: v.reviews_synced_at })
      .eq("id", v.id);
    if (error) {
      console.error(`\nupdate failed for ${v.name}: ${error.message}`);
      process.exit(1);
    }
    written++;
    if ((written + skipped) % 50 === 0) {
      console.log(
        `  ${written} written · ${skipped} skipped / ${candidates.length}`,
      );
    }
  }
  console.log(
    `\nDone — wrote ${written} plan notes, skipped ${skipped} (ungrounded / no snippet).`,
  );
}

main().catch((e) => {
  console.error("\nFATAL:", e);
  process.exit(1);
});
