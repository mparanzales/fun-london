// Text hygiene for third-party copy.
//
// WHY THIS EXISTS. Provider feeds serve mojibake, and it is not our decoder's
// fault. Verified 2026-07-30 by fetching Ticketmaster event 1AwZk8gGkdJ9ZcH
// straight from the Discovery API: the title comes back as the characters
// U+00C2 U+0080 U+0093, byte-identical to what we had stored. Our ingest was
// faithful; the provider's own data is broken. That matters for the fix,
// because it rules out the obvious remedy: re-ingesting cannot help, so the
// only correct place to deal with this is on the way IN and on the way OUT.
//
// The signature is reliable. U+0080 to U+009F are C1 control characters. They
// are unprintable and can never occur in real text, so their presence always
// means a broken decode somewhere upstream. Mail clients render them as boxes,
// which is exactly how this surfaced: in a weekly digest that reached real
// subscribers reading "Through Storms and Stars [box][box] an Evening with".
//
// RECOVERY, not guesswork. The residue is the tail of a mangled UTF-8
// sequence. Every character in Unicode's General Punctuation block encodes as
// e2 80 xx, and that final byte gives the codepoint directly:
//
//     U+2000 + (xx - 0x80)
//
// So U+0093 recovers to U+2013 (en dash), U+0094 to U+2014 (em dash), U+0099
// to U+2019 (curly apostrophe), U+009C to U+201C (curly quote). This is how we
// know the Voyager title held an en dash rather than assuming it did.
//
// Literal dash characters never appear in this file's source: the check-no-dashes
// guard scans lib/, so every dash is written as an escape.

// A mojibake run: an optional mis-decoded lead character followed by one or
// more C1 controls. A legitimate capital A-circumflex is never followed by a
// control character, so requiring the control makes this safe for real text
// (French, Portuguese and Vietnamese names pass through untouched).
const MOJIBAKE_RUN = new RegExp(
  "[\\u00C2\\u00C3\\u00E2]?[\\u0080-\\u009F]+",
  "g",
);

// Whatever survives recovery: stray C0/C1 controls, BOM, replacement char.
// Tabs and newlines are deliberately preserved.
const RESIDUAL_CONTROLS = new RegExp(
  "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F\\uFEFF\\uFFFD]",
  "g",
);

const DASH_RE = new RegExp("\\s*[\\u2014\\u2013]\\s*", "g"); // em / en dash
const DBL_HYPHEN_RE = / -{2} /g;
const MULTI_SPACE = /[ \t]{2,}/g;

// Recover a single mojibake run to the punctuation it was before the feed
// mangled it. The last control character in the run carries the identity: it
// is the third byte of the original e2 80 xx sequence.
function recoverRun(run: string): string {
  const controls = [...run].filter((c) => {
    const n = c.codePointAt(0)!;
    return n >= 0x80 && n <= 0x9f;
  });
  if (controls.length === 0) return run;

  const tail = controls[controls.length - 1]!.codePointAt(0)!;
  // Only the e2 80 xx family is recoverable this way, and a genuine sequence
  // always carries the 0x80 middle byte. Anything else is unrecoverable
  // garbage and is dropped rather than turned into a plausible wrong glyph.
  const hasMiddleByte = controls.some((c) => c.codePointAt(0) === 0x80);
  if (!hasMiddleByte || controls.length < 2) return "";

  return String.fromCodePoint(0x2000 + (tail - 0x80));
}

/**
 * Repair provider mojibake and apply the no-dashes brand rule.
 *
 * Order matters: recovery runs FIRST so a mangled en dash becomes a real en
 * dash and is then tidied to ", " by the same rule that governs clean copy.
 * Without that order the corrupt title would slip past the dash guard, which
 * is precisely what let it reach subscribers.
 */
export function tidyText<T extends string | null | undefined>(s: T): T {
  if (s == null) return s;
  return s
    .replace(MOJIBAKE_RUN, recoverRun)
    .replace(RESIDUAL_CONTROLS, "")
    .replace(DASH_RE, ", ")
    .replace(DBL_HYPHEN_RE, ", ")
    .replace(MULTI_SPACE, " ")
    .trim() as T;
}

/**
 * True when a string still carries characters that can never be legitimate
 * text. Used by ingest to log provider corruption rather than swallow it,
 * so a feed that starts serving garbage at scale is visible and not silent.
 */
export function hasControlChars(s: string | null | undefined): boolean {
  if (s == null) return false;
  return new RegExp("[\\u0080-\\u009F]").test(s);
}
