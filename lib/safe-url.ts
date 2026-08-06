// Keep catalogue-sourced URLs from reaching an href as anything but the web.
//
// Venue websites and menus, booking links, ticket links, editorial-source and
// creator-coverage links, admin candidate/prospect/pop-up links: every one of
// them arrives from an ingestion cron or a bulk CSV import. They are catalogue
// DATA, not code, so their scheme is attacker-controlled. A stored
// "javascript:..." rendered into an href executes in the funldn.com origin, on
// the user's own tap, with the user's session.
//
// PR #226 established the rule inside buildReserveUrl (http(s) or nothing).
// This is that same rule hoisted out so every sink shares ONE definition
// instead of each one re-deciding. lib/safe-redirect.ts is the internal
// sibling: that keeps ?return= on our origin, this keeps outbound hrefs on
// real web schemes.
//
// Deliberately an ALLOWLIST. A denylist of "javascript:, data:, vbscript:" is
// one novel scheme away from being wrong, and it has to out-guess the parser:
// the WHATWG parser folds scheme case and strips tabs, newlines and leading
// whitespace before we ever see `protocol`, so "Java\nScript:alert(1)" arrives
// at this check already normalised to "javascript:" and is rejected by the
// same two-entry set that rejects the plain spelling.

const WEB_SCHEMES = new Set(["http:", "https:"]);

// The rule, once. Returns a parsed URL only for real web schemes.
export function parseExternalUrl(raw: string | null | undefined): URL | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    // Relative ("/menu") or bare ("www.example.com"). Deliberately NOT
    // upgraded to https by guessing a scheme: that would invent a
    // destination we were never given. A bare host is already broken today
    // anyway, since the browser resolves it against funldn.com.
    return null;
  }
  if (!WEB_SCHEMES.has(u.protocol)) return null;
  // Strip any userinfo. "https://ticketmaster.com@evil.com/x" is a valid https
  // URL to evil.com that READS as ticketmaster.com to a person glancing at the
  // status bar, which is the whole phishing trick. No legitimate catalogue URL
  // carries credentials, so dropping them costs nothing and removes the
  // disguise. (providerFromUrl already reads `hostname`, so it correctly
  // refuses to label such a link, but that is one consumer, not a guarantee.)
  u.username = "";
  u.password = "";
  return u;
}

// WRITE-side guard: the value to STORE in a url column, or null.
//
// The sink guards below decide what may reach an href. This decides what may
// reach the database in the first place, and it exists because six live rows
// carry a non-URL in `events.source_url`: five "N/A" and one "Not available",
// all written 4-5 June by the Gemini-era pop-up generator (removed 2026-07-11),
// which emitted a model's idea of "no value" as a string. `scripts/ingest-
// events.ts` had its own version of the same bug, storing `e.url ?? ""`.
//
// Nothing downstream was broken by this: parseExternalUrl refuses all three, so
// no bad href ever rendered and the .ics correctly omits its URL property. The
// hazard is that the column is NULLABLE and these are truthy, so the ordinary
// way to read it -- `event.sourceUrl ? ... : ...` -- treats "N/A" as a real
// ticket link. A sentinel in a nullable column is a trap set for the next
// person, not a bug in the current code.
//
// 🧨 An ALLOWLIST, not a list of known sentinels. Matching "N/A"/"Not
// available"/"" is one model, one provider or one intern away from being wrong
// ("none", "TBC", "-", "unknown"), and the repo has already paid for a denylist
// twice. Anything that is not a parseable http(s) URL is not a URL, whatever it
// spells.
//
// Returns the caller's ORIGINAL string, deliberately not the parsed
// serialisation: this runs on every sync, and emitting `u.toString()` would
// silently rewrite thousands of stored URLs (trailing slashes, percent-encoding,
// host case) on the next cron run. Validate without normalising.
// 🧨 Control characters are checked on the RAW string, BEFORE parsing, for the
// same reason lib/ics.ts does it (PR #231): the WHATWG parser does not reject
// CR, LF or TAB, it DELETES them. So "https://exa<CR>mple.com" parses happily,
// and returning the original would store a value that no consumer resolves to,
// while returning the parsed form would store a host the provider never sent.
// Neither is acceptable, so it is refused. Verified against production: 0 of
// the 67 rows with a source_url carry a control character, so this closes the
// door rather than changing any live value.
// C0, DEL and C1. C1 is included because Postgres's [[:cntrl:]] matches it in a
// UTF-8 locale, and the migration's predicate must not be able to null a row
// the write path would have kept. Ticketmaster has already served this repo raw
// U+0080/U+0093 (see lib/text.ts), so C1 in a provider field is not academic.
const CONTROL_CHARS = /[\x00-\x1f\x7f-\x9f]/;

// A scheme-and-authority shape. The SQL predicate in migration 0007 is the same
// shape test, so the two definitions agree on the floor and this helper is
// strictly stricter above it.
const HTTP_PREFIX = /^https?:\/\//i;

// userinfo, which parseExternalUrl deliberately STRIPS.
const HAS_USERINFO = /^https?:\/\/[^/?#]*@/i;

export function storedUrlOrNull(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;

  // 🧨 Everything below rejects an input whose PARSE IS NOT FAITHFUL to its
  // bytes, and that is the whole design. Returning the original string is only
  // safe where parsing would not have changed it; anywhere the parser silently
  // repairs, storing the original persists a value no consumer resolves to,
  // while storing the parsed form persists something the provider never sent.
  // Refuse instead of choosing. Same reasoning as lib/ics.ts (PR #231).

  // Padding: the parser strips leading/trailing whitespace before validating,
  // so "  https://x.com" parses fine and would be stored WITH the spaces.
  if (raw !== raw.trim()) return null;

  // CR/LF/TAB and friends: deleted by the parser, not rejected.
  if (CONTROL_CHARS.test(raw)) return null;

  // Anything not literally scheme-first. Keeps the stored bytes inside the
  // shape the migration's predicate tests for, so "stored implies starts with
  // http(s)://" is a real invariant rather than an assumption.
  if (!HTTP_PREFIX.test(raw)) return null;

  // userinfo is the phishing disguise: "https://ticketmaster.co.uk@evil.com/x"
  // reads as ticketmaster to a person and resolves to evil.com. parseExternalUrl
  // strips it, so returning the original would store the disguise intact and
  // hand it to applyAffiliate, which stamps our UTM parameters onto it.
  if (HAS_USERINFO.test(raw)) return null;

  return parseExternalUrl(raw) === null ? null : raw;
}

// Sink guard: the value to put in an href, or null to render no link at all.
// Callers must treat null as "drop the anchor" rather than falling back to the
// raw string, which is the whole point. No link beats a live sink.
export function safeExternalHref(
  raw: string | null | undefined,
): string | null {
  // The PARSED serialisation, never the caller's original string, so the value
  // we validated is the exact value that reaches the DOM. Nothing the parser
  // normalised away can sneak back in through a re-parse difference.
  return parseExternalUrl(raw)?.toString() ?? null;
}
