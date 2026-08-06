// ICS injection: a catalogue value must never be able to end a content line.
//
// These are behavioural, not structural. They run the real generator over the
// values an attacker would actually store in events.name / venue_name / area /
// source_url, and then read the result the way a CALENDAR APP would: split the
// file into content lines and look at what properties it actually got.
//
// The bug this pins: esc() escaped /\r?\n/, so CRLF and bare LF were caught and
// a LONE CARRIAGE RETURN was not. Several parsers treat a bare CR as a line
// break, so "Rooftop\rBEGIN:VEVENT..." in an event name wrote a second event
// into the calendar of whoever tapped "Add to calendar".

import { describe, it, expect } from "vitest";
import { buildIcs, icsDataUrl } from "@/lib/ics";

// Deliberately re-declared here instead of imported from lib/ics: a test that
// borrows the guard's own definition of "line break" moves whenever the guard
// is wrong, which is how a broken invariant stays green.
//
// The missing /g is also deliberate. This is .test()ed in a loop, and a global
// regex carries lastIndex between calls, so "aligning" it with LINE_BREAK in
// lib/ics.ts would make it skip every other match and quietly weaken.
const RAW_BREAK = new RegExp(
  `[\\r\\n\\v\\f${String.fromCharCode(0x85)}${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]`,
);

// Every spelling of "end of line" a real consumer splits on. Python's
// str.splitlines(), which more than one calendar backend unfolds with, breaks
// on all of them and not just on CRLF.
const BREAKS: [string, string][] = [
  ["bare CR", "\r"],
  ["CRLF", "\r\n"],
  ["bare LF", "\n"],
  ["vertical tab", "\v"],
  ["form feed", "\f"],
  ["NEL U+0085", "\x85"],
  ["line separator U+2028", String.fromCharCode(0x2028)],
  ["paragraph separator U+2029", String.fromCharCode(0x2029)],
];

// The property names buildIcs is allowed to emit. An allowlist, not a
// denylist: a test that only greps for a second BEGIN:VEVENT stays green while
// an injected ATTACH, ORGANIZER or alarm-bearing line walks straight past it.
const ALLOWED_PROPERTIES = new Set([
  "BEGIN",
  "VERSION",
  "PRODID",
  "CALSCALE",
  "UID",
  "DTSTAMP",
  "DTSTART",
  "DTEND",
  "SUMMARY",
  "LOCATION",
  "DESCRIPTION",
  "URL",
  "END",
]);

const BASE = {
  uid: "3f1c2b8e-0f6a-4a2b-9a1e-7c5d2f0b1a33",
  title: "Rooftop Session",
  startsAt: "2026-09-12T19:30:00.000Z",
  location: "The Bar, Soho, London",
  description: "Tickets: https://example.com/t",
  url: "https://example.com/t",
};

// What a calendar app sees after it splits the file on CRLF.
function contentLines(ics: string): string[] {
  return ics.split("\r\n");
}

function propertyName(line: string): string {
  return line.slice(0, line.indexOf(":"));
}

// The whole invariant in one place: no content line carries a raw break, no
// property outside the allowlist appears, and there is exactly one event.
function assertNoInjection(ics: string, label: string): void {
  const lines = contentLines(ics);
  for (const line of lines) {
    expect(
      RAW_BREAK.test(line),
      `${label}: raw line break survived inside ${JSON.stringify(line)}`,
    ).toBe(false);
    // Checked before the allowlist: a colon-less line is not a property at
    // all, and slicing to indexOf(":") would hand a bare "BEGIN" to the
    // allowlist and let it pass.
    expect(
      line.includes(":"),
      `${label}: line with no property name ${JSON.stringify(line)}`,
    ).toBe(true);
    expect(
      ALLOWED_PROPERTIES.has(propertyName(line)),
      `${label}: injected property ${JSON.stringify(propertyName(line))}`,
    ).toBe(true);
  }
  expect(
    lines.filter((l) => l === "BEGIN:VEVENT"),
    `${label}: more than one VEVENT`,
  ).toHaveLength(1);
  expect(lines.filter((l) => l === "END:VEVENT")).toHaveLength(1);
}

// The browser percent-decodes the data URL when it writes the .ics to disk, so
// the file the calendar app parses is this, not the URL. Verifying only
// buildIcs would model the wrong consumer.
function downloadedFile(dataUrl: string): string {
  const prefix = "data:text/calendar;charset=utf-8,";
  expect(dataUrl.startsWith(prefix)).toBe(true);
  return decodeURIComponent(dataUrl.slice(prefix.length));
}

function injection(brk: string): string {
  return `${brk}BEGIN:VEVENT${brk}SUMMARY:Injected${brk}DTSTART:20260101T000000Z${brk}END:VEVENT`;
}

describe("buildIcs line-break escaping", () => {
  // The named regression: a lone CR, which the old /\r?\n/ rule missed.
  it("a bare CR in the event name cannot open a second VEVENT", () => {
    const ics = buildIcs({
      ...BASE,
      title: `Rooftop${injection("\r")}`,
    });

    assertNoInjection(ics, "bare CR in name");

    // Positive pin, not just an absence: the payload is still there, as one
    // escaped SUMMARY value, exactly as RFC 5545 says it should be.
    const summary = contentLines(ics).find((l) => l.startsWith("SUMMARY:"));
    expect(summary).toBe(
      "SUMMARY:Rooftop\\nBEGIN:VEVENT\\nSUMMARY:Injected\\nDTSTART:20260101T000000Z\\nEND:VEVENT",
    );

    // And no carriage return survives anywhere except in the CRLF separators
    // the format itself is built from.
    expect(ics.replace(/\r\n/g, "")).not.toContain("\r");
  });

  it.each(BREAKS)(
    "%s cannot inject a property from any catalogue field",
    (_label, brk) => {
      const payload = injection(brk);
      const ics = buildIcs({
        uid: `${BASE.uid}${payload}`,
        title: `Rooftop${payload}`,
        startsAt: BASE.startsAt,
        location: `The Bar${payload}`,
        description: `Tickets${payload}`,
        url: `https://example.com/t${payload}`,
      });
      assertNoInjection(ics, _label);
    },
  );

  it.each(BREAKS)(
    "%s is still neutralised in the downloaded .ics file",
    (_label, brk) => {
      const url = icsDataUrl({ ...BASE, title: `Rooftop${injection(brk)}` });
      assertNoInjection(downloadedFile(url), `${_label} via data URL`);
    },
  );

  it("collapses one CRLF into one escaped break, not two", () => {
    const ics = buildIcs({ ...BASE, title: "Line one\r\nLine two" });
    const summary = contentLines(ics).find((l) => l.startsWith("SUMMARY:"));
    expect(summary).toBe("SUMMARY:Line one\\nLine two");
  });
});

describe("icsDataUrl percent-encoding", () => {
  // encodeURIComponent here is load-bearing, not cosmetic, and the rest of
  // this file would stay green without it: no other fixture contains a "%",
  // so decodeURIComponent is the identity function on all of them.
  it("a literal %0D%0A in a catalogue value cannot decode back into a real break", () => {
    const url = icsDataUrl({
      ...BASE,
      title: "Rooftop%0D%0ABEGIN:VEVENT%0D%0ASUMMARY:Injected%0D%0AEND:VEVENT",
    });
    assertNoInjection(downloadedFile(url), "percent-escaped CRLF");
  });

  it("leaves no raw # in the payload, which would truncate the file at the fragment", () => {
    const url = icsDataUrl({ ...BASE, title: "Rooftop #1 Session" });
    const payload = url.slice("data:text/calendar;charset=utf-8,".length);
    expect(payload).not.toContain("#");
    expect(downloadedFile(url)).toContain("SUMMARY:Rooftop #1 Session");
  });
});

describe("buildIcs control characters", () => {
  it("drops C0 controls and DEL, which RFC 5545 forbids in TEXT", () => {
    const ics = buildIcs({
      ...BASE,
      title: "Rooftop\x00 Session\x1f\x7f",
    });
    const summary = contentLines(ics).find((l) => l.startsWith("SUMMARY:"));
    expect(summary).toBe("SUMMARY:Rooftop Session");
  });

  it("keeps HTAB, the one control RFC 5545 allows", () => {
    const ics = buildIcs({ ...BASE, title: "Rooftop\tSession" });
    const summary = contentLines(ics).find((l) => l.startsWith("SUMMARY:"));
    expect(summary).toBe("SUMMARY:Rooftop\tSession");
  });
});

describe("buildIcs existing escaping and shape", () => {
  it("escapes backslash, semicolon and comma, in that order", () => {
    const ics = buildIcs({ ...BASE, title: "A\\B;C,D" });
    const summary = contentLines(ics).find((l) => l.startsWith("SUMMARY:"));
    expect(summary).toBe("SUMMARY:A\\\\B\\;C\\,D");
  });

  it("emits a well formed single event with CRLF separators", () => {
    const ics = buildIcs(BASE);
    assertNoInjection(ics, "clean input");
    expect(contentLines(ics)[0]).toBe("BEGIN:VCALENDAR");
    expect(contentLines(ics).at(-1)).toBe("END:VCALENDAR");
    expect(ics).toContain("DTSTART:20260912T193000Z");
    expect(ics).toContain("DTEND:20260912T213000Z");
  });

  // startsAt is the one interpolated input that never reaches esc(): its
  // defence is the Date round-trip in toIcsUtc, which can only emit digits, T
  // and Z. Pinning the SHAPE catches anyone who "simplifies" these three lines
  // to interpolate input.startsAt directly.
  it("emits machine-generated timestamps only in DTSTAMP, DTSTART and DTEND", () => {
    const ics = buildIcs(BASE);
    for (const prop of ["DTSTAMP", "DTSTART", "DTEND"]) {
      const line = contentLines(ics).find((l) => l.startsWith(`${prop}:`));
      expect(line, `${prop} missing or not machine-generated`).toMatch(
        new RegExp(`^${prop}:\\d{8}T\\d{6}Z$`),
      );
    }
  });

  it("omits the optional properties when they are absent", () => {
    const ics = buildIcs({
      uid: BASE.uid,
      title: BASE.title,
      startsAt: BASE.startsAt,
    });
    expect(ics).not.toContain("LOCATION:");
    expect(ics).not.toContain("DESCRIPTION:");
    expect(ics).not.toContain("URL:");
    assertNoInjection(ics, "minimal input");
  });
});
