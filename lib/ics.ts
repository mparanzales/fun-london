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

// Escape per RFC 5545: backslash, comma, semicolon, and newlines.
function esc(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
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
    `UID:${input.uid}@fun-london`,
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
