// Minimal RFC-5545 iCalendar (.ics) generator for "Add to calendar".
// Produces a single VEVENT and returns it as a data URL that an
// <a download> can hand straight to Apple/Google/Outlook calendars.
// No dependency, no server round-trip — runs client-side.

export type IcsInput = {
  uid: string; // stable id (event id / booking ref)
  title: string;
  startsAt: string; // ISO timestamp
  durationMins?: number; // default 120
  location?: string;
  description?: string;
  url?: string;
};

// ISO → UTC basic format: 20260626T193000Z
function toIcsUtc(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
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

// Escape per RFC 5545: backslash, comma, semicolon, and line breaks.
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

export function buildIcs(input: IcsInput): string {
  const start = new Date(input.startsAt);
  const end = new Date(start.getTime() + (input.durationMins ?? 120) * 60_000);

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
    `DTSTAMP:${toIcsUtc(start)}`,
    `DTSTART:${toIcsUtc(start)}`,
    `DTEND:${toIcsUtc(end)}`,
    `SUMMARY:${esc(input.title)}`,
    input.location ? `LOCATION:${esc(input.location)}` : null,
    input.description ? `DESCRIPTION:${esc(input.description)}` : null,
    input.url ? `URL:${esc(input.url)}` : null,
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return lines.filter((l): l is string => l !== null).join("\r\n");
}

export function icsDataUrl(input: IcsInput): string {
  return (
    "data:text/calendar;charset=utf-8," + encodeURIComponent(buildIcs(input))
  );
}
