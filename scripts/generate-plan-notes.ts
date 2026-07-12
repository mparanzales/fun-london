// Stage 4.3 (zero-AI edition): store a grounded "why this stop" note for each
// venue in public.venues.plan_note. The plan UI renders it under each stop; a
// venue with no note simply shows none (fail-open).
//
// No LLM anywhere. The note IS a real reviewer's words, quoted verbatim:
//   pick the best real Google review (lib/plan-note.ts pickReviewSnippet)  ->
//   quote its best-fitting sentence, truncated at a word boundary if needed  ->
//   run the same deterministic groundedness gate (a verbatim quote passes by
//   construction; the gate stays as a belt-and-braces guard).
//
//   pnpm generate-plan-notes:dry             # print a few notes, no writes
//   pnpm generate-plan-notes                 # write notes for venues missing one
//   pnpm generate-plan-notes -- --stale      # also refresh venues whose reviews changed
//   pnpm generate-plan-notes -- --limit=20   # cap how many venues are processed
//
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import type { VenueReview } from "@/lib/types";
import { pickReviewSnippet, isGrounded, MAX_NOTE_CHARS } from "@/lib/plan-note";

const DRY = process.argv.includes("--dry-run");
const STALE_ONLY = process.argv.includes("--stale");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : DRY ? 10 : Infinity;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
  );
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

// Typographic marks so the quote reads as a quote on the stop card.
const OPEN_Q = "“"; // left double quotation mark
const CLOSE_Q = "”"; // right double quotation mark
const ELLIPSIS = "…";
// Room inside the note cap for the two quote marks.
const BODY_BUDGET = MAX_NOTE_CHARS - 2;
// A sentence shorter than this says nothing worth quoting on its own.
const MIN_SENTENCE_CHARS = 25;

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function splitSentences(text: string): string[] {
  return collapse(text)
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Cut verbatim text down to `max` chars at a word boundary, marking the cut
// with a single ellipsis so we never misquote by ending mid-word.
function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max - 1);
  const cut = slice.lastIndexOf(" ");
  const head = (cut > 0 ? slice.slice(0, cut) : slice).replace(
    /[\s,;:.!?'-]+$/,
    "",
  );
  return head + ELLIPSIS;
}

// Build the note for one venue, or null when there is nothing quotable.
// The body is ALWAYS a verbatim substring of the chosen review (a whole
// sentence when one fits, otherwise the review's opening truncated cleanly),
// so the reviewer is never misquoted.
function noteFor(v: VenueRow): { note: string; source: VenueReview } | null {
  const snippet = pickReviewSnippet(v.reviews);
  if (!snippet) return null;
  const sentences = splitSentences(snippet.text);
  // Reviews open with the verdict ("Amazing meal at Padella", "great service
  // and nice place to drink"), so the FIRST complete sentence that fits the
  // budget makes the best "why go" line; later sentences drift into logistics
  // and quibbles. When none fits, quote the review from the top, truncated at
  // a word boundary.
  const fitting = sentences.find(
    (s) => s.length >= MIN_SENTENCE_CHARS && s.length <= BODY_BUDGET,
  );
  const body = fitting ?? truncateAtWord(collapse(snippet.text), BODY_BUDGET);
  const clean = body.replace(/^["'“”]+|["'“”]+$/g, "").trim();
  if (!clean) return null;
  const note = `${OPEN_Q}${clean}${CLOSE_Q}`;
  const venue = {
    name: v.name,
    type: v.type,
    neighbourhood: v.neighbourhood ?? "London",
  };
  // Belt and braces: a verbatim quote is grounded by construction, but keep
  // the same gate the LLM pipeline had, and skip rather than store anything
  // the review cannot back up (also enforces the length window).
  if (!isGrounded(note, snippet, venue)) return null;
  return { note, source: snippet };
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
    `generate-plan-notes · verbatim review quotes (zero AI) · ${DRY ? "DRY-RUN (no write)" : "WRITE"}${STALE_ONLY ? " · stale-only" : ""}\n`,
  );

  const venues = await loadVenues();
  let candidates = venues.filter((v) => pickReviewSnippet(v.reviews) !== null);
  console.log(
    `${venues.length} visible venues · ${candidates.length} with a usable review snippet`,
  );

  // Default target: venues that have no note yet. --stale also refreshes
  // venues whose reviews changed since their note was generated.
  candidates = candidates.filter((v) => {
    if (!v.plan_note || !v.plan_note_synced_at) return true; // never generated
    if (!STALE_ONLY) return false;
    if (!v.reviews_synced_at) return false;
    return new Date(v.reviews_synced_at) > new Date(v.plan_note_synced_at);
  });
  console.log(
    `${candidates.length} need a note${STALE_ONLY ? " (missing or stale)" : " (missing)"}`,
  );

  if (Number.isFinite(LIMIT)) {
    candidates = candidates.slice(0, LIMIT as number);
    console.log(`--limit → processing ${candidates.length}`);
  }

  let written = 0;
  let skipped = 0;
  for (const v of candidates) {
    const built = noteFor(v);
    if (!built) {
      skipped++;
      if (DRY)
        console.log(`  ${v.name.padEnd(30)} → (nothing quotable, skipped)`);
      continue;
    }
    if (DRY) {
      console.log(`  ${v.name}`);
      console.log(`    note   → ${built.note}`);
      console.log(
        `    source → ${built.source.rating}/5 by ${built.source.author}: "${collapse(built.source.text)}"`,
      );
      written++;
      continue;
    }
    const { error } = await supabase
      .from("venues")
      .update({
        plan_note: built.note,
        // Stamp with the reviews snapshot the note came from; fall back to
        // now when reviews_synced_at is null, otherwise the venue would be
        // re-selected as "never generated" on every run.
        plan_note_synced_at: v.reviews_synced_at ?? new Date().toISOString(),
      })
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
    `\n${DRY ? "DRY-RUN complete, nothing written." : "Done."} ${written} note(s) ${DRY ? "would be written" : "written"}, ${skipped} skipped (nothing quotable).`,
  );
}

main().catch((e) => {
  console.error("\nFATAL:", e);
  process.exit(1);
});
