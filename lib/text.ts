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
// RECOVERY, not guesswork. Mojibake is a UTF-8 sequence decoded one byte at a
// time, so the residue still carries the original codepoint. Two families
// cover essentially everything a listings feed contains, and each maps back
// arithmetically from its final byte:
//
//   e2 80 xx  ->  U+2000 + (xx - 0x80)   General Punctuation: dashes, curly
//                                        quotes, apostrophes, ellipsis, bullet
//   c3    xx  ->  U+00C0 + (xx - 0x80)   Latin-1 Supplement: accented letters
//
// That is how the Voyager title is KNOWN to have held an en dash (tail 0x93)
// rather than assumed to.
//
// 🧨 NEVER DELETE A PRINTABLE CHARACTER HERE. The first version of this file
// dropped the whole run when it could not recover, which ate real letters:
// "Etienne de Crecy" arrives mojibaked as a c3-family run, failed the
// e2-80-only test, and came out as "tienne de Crecy" with the leading letter
// gone. A guard that mangles real names is worse than the bug it fixes. When
// recovery is not possible, strip ONLY the unprintable controls and leave
// every printable character exactly where it was.
//
// Literal dash characters never appear in this file's source: the
// check-no-dashes guard scans lib/, so every dash is written as an escape.

// Recoverable: General Punctuation. Needs the 0x80 middle byte.
const PUNCT_RUN = new RegExp("[\\u00C2\\u00E2]\\u0080([\\u0080-\\u00BF])", "g");

// Recoverable: Latin-1 Supplement, the accented letters. Two bytes only.
const LATIN_RUN = new RegExp("\\u00C3([\\u0080-\\u00BF])", "g");

// Whatever survives recovery: stray C0/C1 controls, BOM, replacement char.
// Tabs and newlines are deliberately preserved. Printables are NEVER matched.
const RESIDUAL_CONTROLS = new RegExp(
  "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F\\uFEFF\\uFFFD]",
  "g",
);

// Recovery can land on the invisible end of General Punctuation (zero-width
// joiners, and the left/right-to-right marks). A stray direction mark flips
// the rest of a title, so collapse the space-like ones and drop the invisible.
const RECOVERED_SPACES = new RegExp("[\\u2000-\\u200A]", "g");
const RECOVERED_INVISIBLE = new RegExp("[\\u200B-\\u200F\\u202A-\\u202E]", "g");

const DASH_RE = new RegExp("\\s*[\\u2014\\u2013]\\s*", "g"); // em / en dash
const DBL_HYPHEN_RE = / -{2} /g;
const MULTI_SPACE = /[ \t]{2,}/g;

/**
 * Undo provider mojibake, leaving every printable character intact.
 *
 * This is the INGEST-side helper. It repairs corruption without applying any
 * editorial rule, so what we store stays faithful to what the provider sent.
 * That fidelity is not academic: it is what made this bug diagnosable at all
 * (the stored bytes matched the live API exactly, which is how we proved the
 * corruption was upstream and not ours).
 */
export function repairMojibake<T extends string | null | undefined>(s: T): T {
  if (s == null) return s;
  return s
    .replace(PUNCT_RUN, (_m, tail: string) =>
      String.fromCodePoint(0x2000 + (tail.codePointAt(0)! - 0x80)),
    )
    .replace(LATIN_RUN, (_m, tail: string) =>
      String.fromCodePoint(0x00c0 + (tail.codePointAt(0)! - 0x80)),
    )
    .replace(RECOVERED_SPACES, " ")
    .replace(RECOVERED_INVISIBLE, "")
    .replace(RESIDUAL_CONTROLS, "") as T;
}

/**
 * Repair mojibake AND apply the no-dashes brand rule.
 *
 * This is the READ/RENDER-side helper. Order matters: recovery runs FIRST so a
 * mangled en dash becomes a real en dash and is then tidied to ", " by the same
 * rule that governs clean copy. Without that order the corrupt title slips past
 * the dash guard, which is exactly what let it reach subscribers.
 */
export function tidyText<T extends string | null | undefined>(s: T): T {
  if (s == null) return s;
  return (repairMojibake(s) as string)
    .replace(DASH_RE, ", ")
    .replace(DBL_HYPHEN_RE, ", ")
    .replace(MULTI_SPACE, " ")
    .trim() as T;
}

/**
 * True when a string still carries characters that can never be legitimate
 * text. Used by ingest to LOG provider corruption rather than swallow it, so a
 * feed that starts serving garbage at scale is visible and not silent.
 */
export function hasControlChars(s: string | null | undefined): boolean {
  if (s == null) return false;
  return new RegExp("[\\u0080-\\u009F]").test(s);
}
