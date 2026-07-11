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
// [\s\S] with no literal space before "Opening" — a multi-paragraph
// template must still match across newlines (review finding, 2026-07-11).
const TEMPLATE_RE = /^An independent [\s\S]*Opening hours can vary/i;

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

// `truncated` is the honest-copy switch: the "Continue reading" pull may
// ONLY render when something was actually cut. A short description that
// fits whole is complete — showing a continue link under it would claim
// more description exists behind sign-in when the signed-in text is
// byte-identical (confirmed review finding, 2026-07-11).
export type AnonTeaser = { text: string; truncated: boolean };

export function deriveAnonTeaser(
  longDescription: string | null | undefined,
): AnonTeaser | null {
  const text = (longDescription ?? "").trim();
  if (!text || TEMPLATE_RE.test(text)) return null;
  // Whole description fits the cap → it IS the teaser, nothing withheld.
  if (text.length <= SENTENCE_MAX) return { text, truncated: false };
  // Prefer a COMPLETE sentence (or two short ones) ending within 160 chars
  // — a full clause with a concrete fact hooks; a mid-thought cut reads as
  // withholding. The 60-char minimum reduces (not eliminates)
  // abbreviation false-ends like "St." for typical openers.
  const sentence = text.match(/^[\s\S]{60,159}?[.!?](?=\s|$)/);
  if (sentence) return { text: trailOff(sentence[0]), truncated: true };
  // Fallback: word boundary before the cap. Never a CSS clamp/fade — the
  // full text must never reach the client. The lone-surrogate strip keeps
  // a 140-char slice from splitting an emoji in half.
  const cut = text
    .slice(0, TEASER_MAX)
    .replace(/[\uD800-\uDBFF]$/, "")
    .replace(/\s+\S*$/, "");
  return { text: trailOff(cut), truncated: true };
}

// Top 3 of the venue's 20-60 tags: enough signal to read the vibe, too
// lossy a sample to rebuild the tag map or the taste engine.
export const ANON_TAG_LIMIT = 3;

export function deriveAnonTags(
  vibeTags: readonly string[] | null | undefined,
): string[] {
  return (vibeTags ?? []).slice(0, ANON_TAG_LIMIT);
}
