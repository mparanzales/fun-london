// Anon teaser derivation — PURE functions so the moat tests pin the exact
// exposure surface offline (no client, no network).
//
// Panel ruling (2026-07-11, personas + ux + design + supabase-guardian,
// unanimous): anon visitors get a first-sentence teaser of the venue
// description + the top 3 vibe tags, derived SERVER-side and shipped as
// separate props — never by widening the anon column grant (one PostgREST
// query would harvest all ~2,100 teasers) and never by repopulating
// venue.longDescription / vibeTags on the anon object (mapVenuePreview
// stays the single blanking choke point).

// The verified template signature: 217 venues on prod (2026-07-11) still
// carry the un-curated "An independent {type} in {area}. Opening hours can
// vary…" boilerplate. Those NEVER tease — showing generic prose at the
// moment of peak curiosity is worse than showing nothing, and the
// no-templates rule bars unapproved copy from logged-out strangers.
// Durable follow-up: a description_curated_at column (like events already
// have) so the gate is a marker, not a signature match.
const TEMPLATE_RE = /^An independent .* Opening hours can vary/i;

// Hard cap on the anon-visible fragment (≈ a Google SERP snippet).
export const TEASER_MAX = 140;
// A first sentence may run slightly past the cap and still read better
// than a mid-sentence cut.
const SENTENCE_MAX = 160;

// Every truncated teaser trails off with an ellipsis — Maria's call
// (2026-07-11): the dots are the signal that there IS more behind the
// sign-up. Trailing sentence punctuation is stripped first so we never
// render ".…". The one honest exception: when the whole description fits
// the cap, nothing is missing, so no dots.
function trailOff(fragment: string): string {
  return `${fragment.trim().replace(/[.!?…]+$/, "")}…`;
}

export function deriveAnonTeaser(
  longDescription: string | null | undefined,
): string | null {
  const text = (longDescription ?? "").trim();
  if (!text || TEMPLATE_RE.test(text)) return null;
  // Whole description fits the cap → it IS the teaser, nothing withheld.
  if (text.length <= SENTENCE_MAX) return text;
  // Prefer a COMPLETE sentence (or two short ones) ending within 160 chars
  // — a full clause with a concrete fact hooks; a mid-thought cut reads as
  // withholding. The 60-char minimum skips abbreviation false-ends
  // ("St. John") for typical openers.
  const sentence = text.match(/^[\s\S]{60,159}?[.!?](?=\s|$)/);
  if (sentence) return trailOff(sentence[0]);
  // Fallback: word boundary before the cap. Never a CSS clamp/fade — the
  // full text must never reach the client.
  const cut = text.slice(0, TEASER_MAX).replace(/\s+\S*$/, "");
  return trailOff(cut);
}

// Top 3 of the venue's 20-60 tags: enough signal to read the vibe, too
// lossy a sample to rebuild the tag map or the taste engine.
export const ANON_TAG_LIMIT = 3;

export function deriveAnonTags(
  vibeTags: readonly string[] | null | undefined,
): string[] {
  return (vibeTags ?? []).slice(0, ANON_TAG_LIMIT);
}
