// Minimal RFC-5545 iCalendar (.ics) generator for "Add to calendar".
// Produces a single VEVENT and returns it as a data URL that an
// <a download> can hand straight to Apple/Google/Outlook calendars.
// No dependency, no server round-trip — runs client-side.

import { safeExternalHref } from "@/lib/safe-url";

export type IcsInput = {
  uid: string; // stable id (event id / booking ref)
  title: string;
  startsAt: string; // ISO timestamp
  durationMins?: number; // default 120
  location?: string;
  description?: string;
  url?: string;
};

// The only shape RFC 5545 accepts for a UTC DATE-TIME: 20260626T193000Z.
const ICS_UTC = /^\d{8}T\d{6}Z$/;

// ISO → UTC basic format, or null if the result is not a conforming DATE-TIME.
//
// 🧨 The null case is NOT unreachable, and "it throws" is not the only failure.
// For any year from 10000 to 275760 — most of the timestamptz range this guard
// exists for — toISOString() succeeds and returns the EXPANDED form
// "+010000-01-01T00:00:00.000Z", which strips down to "+0100000101T000000Z":
// a signed ten-digit date that strict clients reject, taking the whole import
// with it. Checking only for a throw catches the far end of the range and lets
// the wide middle through, so the shape of the emitted value is what gets
// validated here.
function toIcsUtc(d: Date): string | null {
  let iso: string;
  try {
    iso = d.toISOString();
  } catch {
    return null;
  }
  const out = iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return ICS_UTC.test(out) ? out : null;
}

// The three line-break codepoints that cannot be written as a short escape.
// Named and built from their numeric values so no invisible raw control
// character ever sits in this source file: those survive code review, diffs
// and copy-paste badly. NEL is U+0085, LS is U+2028, PS is U+2029.
const NEL = String.fromCharCode(0x85);
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

// 🧨 Anything a calendar parser could read as the END OF A CONTENT LINE.
//
// ICS content lines are CRLF-delimited, so the obvious rule is /\r?\n/ — which
// is what this used to be, and it let a LONE CARRIAGE RETURN straight through.
// Plenty of parsers accept a bare CR as a break, so a catalogue value carrying
// one could close SUMMARY and start writing its own properties: a second
// VEVENT, an ATTACH, a VALARM, into the calendar of anyone who tapped "Add to
// calendar". Every field reaching here is catalogue data written by the
// ingestion crons and bulk import, and the button renders for signed-out
// visitors on the ISR-cached event pages.
//
// The wider point is that WE do not decide what a line break is, the consumer
// does. Anything unfolding this with Python's str.splitlines(), or any other
// Unicode-aware line scanner, also breaks on VT, FF, NEL, LS and PS. Modelling
// the consumer as "CRLF or LF" is exactly the assumption that left the hole
// open, so this set is the union of what real consumers split on, not the RFC
// minimum. CRLF is matched first so one break never escapes to two.
const LINE_BREAK = new RegExp(`\\r\\n|[\\r\\n\\v\\f${NEL}${LS}${PS}]`, "g");

// The remaining C0 controls, plus DEL. RFC 5545's TEXT type forbids them
// outright (HTAB is its one exception, hence the gap at \x09) and no venue
// name, area or title has any use for them. Dropped rather than escaped:
// unlike a line break there is no meaning worth preserving.
const OTHER_CONTROL = /[\x00-\x08\x0e-\x1f\x7f]/g;

// Escape a TEXT value per RFC 5545 §3.3.11: backslash, comma, semicolon, and
// line breaks. Consumers reverse this before they display the value, so the
// escaping is invisible to the reader.
function esc(s: string): string {
  return (
    s
      .replace(OTHER_CONTROL, "")
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      // Last on purpose: the backslash this rule introduces must not be
      // doubled by the backslash rule above.
      .replace(LINE_BREAK, "\\n")
  );
}

// A URI value (RFC 5545 §3.3.13) is NOT a TEXT value, and the difference is
// not academic: consumers do not un-escape URI values. Running esc() over a
// ticket link therefore does not "escape" anything, it CORRUPTS the link —
// `?a=1,2` is delivered as `?a=1\,2` and the URL no longer resolves. Commas
// and semicolons are ordinary, legal URL characters (a Google Maps link puts a
// comma between latitude and longitude), so this is a live breakage, not a
// hypothetical one.
//
// 🧨 What must NOT be relaxed along with the escaping: a URI value still
// occupies one content line, so a line break inside it is the same injection
// PR #229 closed. There is no escape mechanism to fall back on here, and
// silently deleting characters out of a URL rewrites its destination, so this
// is FAIL-CLOSED: a URI carrying a break or a control character is refused
// outright and the property is omitted. Same principle as lib/safe-url.ts —
// no link beats a wrong link.
//
// 🧨 And the threat it must fail closed on is not only formatting. Calendar
// clients LINKIFY the URL property, so a `javascript:` or `data:text/html`
// value written here is a live sink in someone's calendar app. The first
// version of this function rejected control characters and said nothing about
// schemes, which failed closed on the weaker threat and wide open on the
// stronger one. It now runs the same allowlist the hrefs use, so there is ONE
// definition of "a URL we are willing to hand to a user".
//
// In practice this never rejects our own data: components/event-actions.tsx
// already passes the output of safeExternalHref. It fires only for a future
// caller that forgets, which is exactly who it is for. IcsInput.url is typed
// `string`, so the type system will not catch them.

// Non-global twins of the two guards, derived from the SAME sources so they can
// never drift apart. Non-global matters: .test() on a /g regex advances
// lastIndex between calls, so a shared global regex silently returns false on
// every other call. Deriving beats re-typing; a second literal is a second
// thing to keep in sync.
const LINE_BREAK_ONCE = new RegExp(LINE_BREAK.source);
const OTHER_CONTROL_ONCE = new RegExp(OTHER_CONTROL.source);

function escUri(s: string): string | null {
  // 🧨 ORDER IS THE WHOLE POINT, and it is counter-intuitive: the character
  // check must run on the RAW value, BEFORE the parser sees it.
  //
  // The WHATWG parser does not reject a URL containing CR, LF or TAB — it
  // DELETES them and carries on, and it percent-encodes VT and FF. So parsing
  // first turns "https://exa<CR>mple.com/t" into a perfectly valid
  // "https://example.com/t" and we would publish a link to a host the
  // catalogue never contained. That is the silent-rewrite failure this
  // function exists to refuse, and it is invisible unless you look: parsing
  // first passes every "is it a valid URL" test you can write.
  //
  // HTAB is checked here and not in OTHER_CONTROL because the two value types
  // genuinely differ: RFC 5545 permits HTAB inside TEXT, and no URI may carry
  // one.
  if (s.includes("\t")) return null;
  if (LINE_BREAK_ONCE.test(s) || OTHER_CONTROL_ONCE.test(s)) return null;

  // Only now the scheme allowlist, which also returns the parsed
  // serialisation, so what lands in the file is the value that was validated.
  return safeExternalHref(s);
}

// One content line for a URI-valued property, or null to omit the property.
function uriLine(name: string, value: string): string | null {
  const safe = escUri(value);
  return safe === null ? null : `${name}:${safe}`;
}

// A start/end pair that can be emitted as conforming RFC 5545 DATE-TIMEs.
//
// events.starts_at is `timestamptz not null`, so an unusable value is
// unreachable from a well-formed row today. It is reachable from POSTGRES,
// though: its range runs to 294276 AD and it accepts the literal 'infinity'.
// Without this the failure was a RangeError thrown while the anon ISR twin was
// being generated, which fails the CACHED signed-out page for every visitor for
// up to 15 minutes, not just the one render. Same idiom as lib/night-plan.ts:190.
function utcPair(
  startsAt: string,
  durationMins: number | undefined,
): { start: string; end: string } | null {
  const startMs = Date.parse(startsAt);
  if (!Number.isFinite(startMs)) return null;

  // A missing, non-finite or absurd duration must not push the end out of range
  // on its own, so it is validated by the same rule as the start.
  const mins = Number.isFinite(durationMins) ? (durationMins as number) : 120;
  const endMs = startMs + mins * 60_000;
  if (!Number.isFinite(endMs)) return null;

  const start = toIcsUtc(new Date(startMs));
  const end = toIcsUtc(new Date(endMs));
  if (start === null || end === null) return null;
  return { start, end };
}

// Returns null when the event cannot produce a valid calendar entry, so the
// caller can decline to offer the download rather than hand over a broken file.
export function buildIcs(input: IcsInput): string | null {
  const when = utcPair(input.startsAt, input.durationMins);
  if (when === null) return null;

  const lines: (string | null)[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Fun London//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    // Escaped like every other interpolated value. It is a database uuid
    // today, but leaving it raw is the same class of hole as the one above,
    // waiting for the day it is not a uuid.
    `UID:${esc(input.uid)}@fun-london`,
    `DTSTAMP:${when.start}`,
    `DTSTART:${when.start}`,
    `DTEND:${when.end}`,
    `SUMMARY:${esc(input.title)}`,
    input.location ? `LOCATION:${esc(input.location)}` : null,
    // DESCRIPTION stays TEXT even though ours happens to contain a URL: the
    // value type is a property of the PROPERTY, not of what you put in it, and
    // a consumer un-escapes DESCRIPTION before linkifying it. Escaping here is
    // correct and must not be "fixed" to match URL below.
    input.description ? `DESCRIPTION:${esc(input.description)}` : null,
    input.url ? uriLine("URL", input.url) : null,
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return lines.filter((l): l is string => l !== null).join("\r\n");
}

// Null when no valid calendar entry can be built. Callers must render no
// button rather than fall back to a broken href.
export function icsDataUrl(input: IcsInput): string | null {
  const ics = buildIcs(input);
  if (ics === null) return null;
  // 🧨 encodeURIComponent is load-bearing, not cosmetic. The browser decodes
  // the data URL when it writes the file to disk, so a literal "%0D%0A" left
  // un-encoded arrives in the .ics as a REAL CRLF, and a raw "#" truncates the
  // file at the fragment. See the pins in lib/__tests__/ics.test.ts.
  return "data:text/calendar;charset=utf-8," + encodeURIComponent(ics);
}
