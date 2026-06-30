// Stage 4.3 — grounded "why this stop" notes for Plan My Night.
//
// Each plan stop can carry a one-line editorial reason it's worth going, e.g.
// "Worth it for the robata counter and the buzz." The pipeline is deliberately
// honest end-to-end (same provenance rule as the verbatim reviews and the
// once-fabricated editorial sources):
//
//   real review snippet  →  LLM line (grounded ONLY in that snippet)  →  a
//   groundedness gate that REJECTS any line making a claim the snippet doesn't.
//
// The line is precomputed offline (scripts/generate-plan-notes.ts, Gemini free
// tier) and stored on the venue, so the plan UI just renders it — no per-request
// LLM cost or latency, and a venue with no note simply shows none (fail-open).
//
// Everything in THIS file is pure + deterministic so it can be unit-tested
// without the network: snippet choice, the prompt, and the fact-checker gate.

import type { VenueReview } from "./types";

// A note is one short editorial clause. Keep it tight — it sits under a stop.
export const MAX_NOTE_CHARS = 90;
const MIN_NOTE_CHARS = 12;

// Only ground a note in a genuinely useful review: a positive rating (so the
// line's tone is earned), enough text to say something, but not a wall we'd be
// cherry-picking out of context.
const MIN_SNIPPET_CHARS = 60;
const MAX_SNIPPET_CHARS = 600;
const MIN_SNIPPET_RATING = 4;

// Pick the single review best suited to ground a "why go here" line. Deterministic
// (stable ordering) so the offline run and the tests agree: highest rating first,
// then the snippet closest to a comfortable ~220-char sweet spot, then the most
// recent. Returns null when nothing clears the bar (→ no note for this venue).
export function pickReviewSnippet(
  reviews: VenueReview[] | null,
): VenueReview | null {
  if (!reviews || reviews.length === 0) return null;
  const SWEET = 220;
  const eligible = reviews.filter((r) => {
    const len = r.text?.trim().length ?? 0;
    return (
      r.rating >= MIN_SNIPPET_RATING &&
      len >= MIN_SNIPPET_CHARS &&
      len <= MAX_SNIPPET_CHARS
    );
  });
  if (eligible.length === 0) return null;
  return [...eligible].sort((a, b) => {
    if (b.rating !== a.rating) return b.rating - a.rating;
    const da = Math.abs((a.text?.length ?? 0) - SWEET);
    const db = Math.abs((b.text?.length ?? 0) - SWEET);
    if (da !== db) return da - db;
    // Newest last-ditch tiebreak (publishTime is ISO; missing sorts oldest).
    return (b.publishTime ?? "").localeCompare(a.publishTime ?? "");
  })[0];
}

// The generation prompt. Constrains Gemini HARD to the snippet so the fact-check
// gate below has a real chance of passing: no invented dishes, prices, or facts.
export function buildPlanNotePrompt(
  venue: { name: string; type: string; neighbourhood: string },
  snippet: VenueReview,
): string {
  return [
    `You write one short line for a London night-out planner explaining why a`,
    `venue is worth a stop. Voice: a friend with great taste, warm and confident,`,
    `never salesy, no clichés ("hidden gem", "must-visit", "nestled").`,
    ``,
    `Venue: "${venue.name}", a ${venue.type} in ${venue.neighbourhood}.`,
    `A real Google review (${snippet.rating}/5):`,
    `"""${snippet.text.trim()}"""`,
    ``,
    `Write ONE line (max ${MAX_NOTE_CHARS} characters, no quotes, no emoji,`,
    `optional trailing full stop) on why to go. Ground it ONLY in the review`,
    `above and the venue type. Do NOT invent dishes, prices, awards, or facts`,
    `the review doesn't mention. Reply with the line only, nothing else.`,
  ].join("\n");
}

// ── The fact-checker gate ────────────────────────────────────────────────────
//
// A cheap, deterministic groundedness check (no second LLM call — the repo runs
// on the Gemini free tier and deliberately minimises calls). It rejects a line
// whose CLAIM words don't trace back to the review snippet or the venue's own
// identity. Generic connective words and mild positive sentiment are allowed:
// the sentiment is earned by the 4–5★ snippet we grounded on.

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "for",
  "to",
  "of",
  "in",
  "on",
  "at",
  "with",
  "from",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "is",
  "are",
  "be",
  "you",
  "your",
  "their",
  "here",
  "there",
  "go",
  "get",
  "grab",
  "come",
  "then",
  "than",
  "so",
  "as",
  "if",
  "when",
  "where",
  "what",
  "why",
  "how",
  "all",
  "more",
  "most",
  "some",
  "any",
  "not",
  "no",
  "up",
  "out",
  "over",
  "into",
  "by",
  "via",
  "plus",
  "after",
  "before",
  "spot",
  "place",
  "stop",
  "night",
  "one",
  "two",
  "few",
  "while",
  "worth",
  "make",
  "makes",
  "made",
  // Neutral experience-nouns: generic enough that they aren't claims ABOUT the
  // venue, so they don't need grounding (unlike "robata" or "omakase").
  "trip",
  "visit",
  "evening",
  "afternoon",
  "table",
  "room",
  "crowd",
  "scene",
  "choice",
  "pick",
  "treat",
  "outing",
  "occasion",
  "everyone",
  "anyone",
  "something",
  "anywhere",
]);

// Positive sentiment is grounded by the high-rated snippet, so allow a small
// editorial vocabulary the model can use without it counting as an unbacked claim.
const SENTIMENT_OK = new Set([
  "great",
  "good",
  "lovely",
  "perfect",
  "brilliant",
  "excellent",
  "superb",
  "stellar",
  "buzzy",
  "lively",
  "cosy",
  "cozy",
  "relaxed",
  "intimate",
  "fun",
  "cool",
  "special",
  "best",
  "favourite",
  "favorite",
  "gem",
  "standout",
  "reliable",
  "solid",
  "top",
  "fine",
  "memorable",
  "charming",
  "stylish",
  "warm",
  "friendly",
  "easy",
  "nice",
  "beautiful",
]);

function contentWords(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

// Stem-ish containment: a note word is grounded if a 4+ char prefix of it appears
// in the haystack (handles plurals/tense: "cocktails" ~ "cocktail").
function appearsIn(word: string, haystack: string): boolean {
  const w = word.replace(/[^a-z0-9]/g, "");
  if (w.length < 3) return true;
  const stem = w.slice(0, Math.max(4, Math.ceil(w.length * 0.7)));
  return haystack.includes(stem);
}

// Is `note` faithfully grounded in `snippet` (given the venue's own identity)?
// The threshold tolerates one stray descriptor but rejects a line built on
// claims the review never makes.
export function isGrounded(
  note: string,
  snippet: VenueReview,
  venue: { name: string; type: string; neighbourhood: string },
): boolean {
  const clean = note.trim();
  if (clean.length < MIN_NOTE_CHARS || clean.length > MAX_NOTE_CHARS) {
    return false;
  }
  // A digit in the line is a hard claim (price, count, year) — only allow it if
  // the exact digit run is present in the snippet.
  const haystack = [snippet.text, venue.name, venue.type, venue.neighbourhood]
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ");
  for (const num of clean.toLowerCase().match(/\d+/g) ?? []) {
    if (!haystack.includes(num)) return false;
  }
  const words = contentWords(clean);
  if (words.length === 0) return false;
  let grounded = 0;
  let claims = 0;
  for (const w of words) {
    if (SENTIMENT_OK.has(w)) continue; // earned by the rating, not a claim
    claims += 1;
    if (appearsIn(w, haystack)) grounded += 1;
  }
  if (claims === 0) return true; // pure sentiment over a 4–5★ review is fine
  // 0.55 tolerates natural paraphrase/synonyms (a 5★ "treated well" → "spoils you",
  // "stayed for two" → "won't want to leave") while the hard guards above stay
  // strict (digits/prices/counts must appear verbatim). Calibrated on a real
  // sample where 0.7 rejected ~70% of faithful lines (scripts/verify-plan-notes.ts).
  return grounded / claims >= 0.55;
}
