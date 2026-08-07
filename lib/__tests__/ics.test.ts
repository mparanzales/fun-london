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

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { buildIcs, icsDataUrl, icsUri } from "@/lib/ics";
import { applyAffiliate } from "@/lib/affiliate";
import {
  ticketUrlForIcs,
  ticketLinkForIcs,
  icsTicketDescription,
  icsInputForEvent,
  ICS_SURFACE,
} from "@/lib/ics-ticket-url";

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
  url: "https://tickets.example.net/t",
};

// buildIcs and icsDataUrl are now nullable (an unrepresentable date yields no
// calendar entry at all). Every test below that is ABOUT something else routes
// through these, so a regression that starts returning null everywhere fails
// loudly here instead of quietly turning those assertions into no-ops.
function buildOk(input: Parameters<typeof buildIcs>[0]): string {
  const ics = buildIcs(input);
  expect(
    ics,
    "buildIcs returned null for input it should accept",
  ).not.toBeNull();
  return ics as string;
}

function dataUrlOk(input: Parameters<typeof icsDataUrl>[0]): string {
  const url = icsDataUrl(input);
  expect(
    url,
    "icsDataUrl returned null for input it should accept",
  ).not.toBeNull();
  return url as string;
}

// Reads one content line by property name. startsWith on purpose: if someone
// respells the property (URL;VALUE=URI:), this MISSES it and the test fails
// loudly rather than a looser regex quietly blessing a new spelling.
function valueOf(ics: string, prop: string): string | undefined {
  return contentLines(ics).find((l) => l.startsWith(`${prop}:`));
}

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
  // The allowlist above checks property NAMES, so "BEGIN:VALARM" passes it on
  // the strength of "BEGIN". Pin the values of the structural lines too.
  expect(
    lines.filter((l) => l.startsWith("BEGIN:")),
    `${label}: unexpected BEGIN component`,
  ).toEqual(["BEGIN:VCALENDAR", "BEGIN:VEVENT"]);
  expect(
    lines.filter((l) => l.startsWith("END:")),
    `${label}: unexpected END component`,
  ).toEqual(["END:VEVENT", "END:VCALENDAR"]);
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
    const ics = buildOk({
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
      const ics = buildOk({
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
      const url = dataUrlOk({ ...BASE, title: `Rooftop${injection(brk)}` });
      assertNoInjection(downloadedFile(url), `${_label} via data URL`);
    },
  );

  it("collapses one CRLF into one escaped break, not two", () => {
    const ics = buildOk({ ...BASE, title: "Line one\r\nLine two" });
    const summary = contentLines(ics).find((l) => l.startsWith("SUMMARY:"));
    expect(summary).toBe("SUMMARY:Line one\\nLine two");
  });
});

describe("icsDataUrl percent-encoding", () => {
  // encodeURIComponent here is load-bearing, not cosmetic, and the rest of
  // this file would stay green without it: no other fixture contains a "%",
  // so decodeURIComponent is the identity function on all of them.
  it("a literal %0D%0A in a catalogue value cannot decode back into a real break", () => {
    const url = dataUrlOk({
      ...BASE,
      title: "Rooftop%0D%0ABEGIN:VEVENT%0D%0ASUMMARY:Injected%0D%0AEND:VEVENT",
    });
    assertNoInjection(downloadedFile(url), "percent-escaped CRLF");
  });

  it("leaves no raw # in the payload, which would truncate the file at the fragment", () => {
    const url = dataUrlOk({ ...BASE, title: "Rooftop #1 Session" });
    const payload = url.slice("data:text/calendar;charset=utf-8,".length);
    expect(payload).not.toContain("#");
    expect(downloadedFile(url)).toContain("SUMMARY:Rooftop #1 Session");
  });
});

describe("buildIcs control characters", () => {
  it("drops C0 controls and DEL, which RFC 5545 forbids in TEXT", () => {
    const ics = buildOk({
      ...BASE,
      title: "Rooftop\x00 Session\x1f\x7f",
    });
    const summary = contentLines(ics).find((l) => l.startsWith("SUMMARY:"));
    expect(summary).toBe("SUMMARY:Rooftop Session");
  });

  it("keeps HTAB, the one control RFC 5545 allows", () => {
    const ics = buildOk({ ...BASE, title: "Rooftop\tSession" });
    const summary = contentLines(ics).find((l) => l.startsWith("SUMMARY:"));
    expect(summary).toBe("SUMMARY:Rooftop\tSession");
  });
});

describe("buildIcs existing escaping and shape", () => {
  it("escapes backslash, semicolon and comma, in that order", () => {
    const ics = buildOk({ ...BASE, title: "A\\B;C,D" });
    const summary = contentLines(ics).find((l) => l.startsWith("SUMMARY:"));
    expect(summary).toBe("SUMMARY:A\\\\B\\;C\\,D");
  });

  it("emits a well formed single event with CRLF separators", () => {
    const ics = buildOk(BASE);
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
    const ics = buildOk(BASE);
    for (const prop of ["DTSTAMP", "DTSTART", "DTEND"]) {
      const line = contentLines(ics).find((l) => l.startsWith(`${prop}:`));
      expect(line, `${prop} missing or not machine-generated`).toMatch(
        new RegExp(`^${prop}:\\d{8}T\\d{6}Z$`),
      );
    }
  });

  it("omits the optional properties when they are absent", () => {
    const ics = buildOk({
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

// ── RFC 5545 value types: URL is a URI, not TEXT ────────────────────────────
//
// §3.3.11 defines the backslash escapes as part of the TEXT value type only,
// and §3.8.4.6 gives URL the URI value type. Consumers do not un-escape a URI,
// so running the TEXT escaper over a ticket link does not escape it, it
// CORRUPTS it: `?a=1,2` is delivered as `?a=1\,2` and no longer resolves.
describe("URL is a URI value, not TEXT", () => {
  // Commas and semicolons are ordinary legal URL characters. A Google Maps
  // link puts a comma between latitude and longitude, so this shape is real.
  const REAL_URL =
    "https://tickets.example.com/e/rooftop,soho?ll=51.5,-0.13;t=2";

  it("delivers commas and semicolons verbatim, with no TEXT escaping", () => {
    const ics = buildOk({ ...BASE, url: REAL_URL });
    expect(valueOf(ics, "URL")).toBe(`URL:${REAL_URL}`);
  });

  // The discriminator that stops the fix spreading one property too far.
  // DESCRIPTION is TEXT even when its content happens to be a URL, because the
  // value type belongs to the property, not to what you put in it.
  it("keeps TEXT escaping in DESCRIPTION even when it contains the same URL", () => {
    const ics = buildOk({
      ...BASE,
      url: REAL_URL,
      description: `Tickets: ${REAL_URL}`,
    });
    expect(valueOf(ics, "DESCRIPTION")).toBe(
      "DESCRIPTION:Tickets: https://tickets.example.com/e/rooftop\\,soho?ll=51.5\\,-0.13\\;t=2",
    );
  });

  it("keeps TEXT escaping in LOCATION", () => {
    const ics = buildOk({ ...BASE, location: "The Bar, Soho; London" });
    expect(valueOf(ics, "LOCATION")).toBe("LOCATION:The Bar\\, Soho\\; London");
  });

  // Dropping the escaping must not drop the injection guard with it: a URI
  // still occupies exactly one content line.
  it.each(BREAKS)(
    "omits the URL property when the URI carries %s",
    (label, brk) => {
      const ics = buildOk({ ...BASE, url: `https://example.com/t${brk}evil` });
      expect(valueOf(ics, "URL"), `URL survived with ${label}`).toBeUndefined();
      assertNoInjection(ics, `uri with ${label}`);
    },
  );

  // 🧨 Without this case the OTHER_CONTROL strip on the URI path can be deleted
  // and the whole suite stays green: no other URL fixture carries a C0 control.
  it.each([
    ["NUL", "\x00"],
    ["unit separator", "\x1f"],
    ["DEL", "\x7f"],
    ["HTAB", "\t"],
  ])("omits the URL property when the URI carries %s", (label, ch) => {
    const ics = buildOk({
      ...BASE,
      url: `https://tickets.example.net/t${ch}x`,
    });
    expect(valueOf(ics, "URL"), `URL survived with ${label}`).toBeUndefined();
    // Not just "the property is missing": the value must be nowhere in the
    // file under any spelling.
    expect(ics).not.toContain("tickets.example.net");
    assertNoInjection(ics, `uri with ${label}`);
  });

  // Fail closed, and specifically DO NOT strip the offending character: that
  // would silently publish a URL pointing somewhere the data never said.
  it("never rewrites a broken URI into a different working destination", () => {
    const ics = buildOk({ ...BASE, url: "https://exa\rmple.com/tickets" });
    expect(valueOf(ics, "URL")).toBeUndefined();
    // The whole point of failing closed: the break must not simply be deleted,
    // which would publish a link to a host the catalogue never contained.
    expect(ics).not.toContain("https://example.com/tickets");
    expect(ics).not.toContain("mple.com/tickets");
  });

  // 🧨 Calendar clients LINKIFY the URL property, so this is a real sink in
  // someone's calendar app, not just a formatting question. Without this block
  // the scheme allowlist can be deleted and the whole suite stays green.
  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(document.domain)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "about:blank",
  ])("omits the URL property for the non-web scheme %j", (raw) => {
    const ics = buildOk({ ...BASE, url: raw });
    expect(valueOf(ics, "URL"), `${raw} survived`).toBeUndefined();
    expect(ics.toLowerCase()).not.toContain("javascript");
    expect(ics.toLowerCase()).not.toContain("vbscript");
    expect(ics.toLowerCase()).not.toContain("etc/passwd");
    assertNoInjection(ics, `scheme ${raw}`);
  });

  // safeExternalHref strips userinfo, because "https://ticketmaster.com@evil
  // .com/x" reads as ticketmaster.com to a person glancing at it. The calendar
  // entry is exactly the place someone glances.
  it("strips userinfo from the ticket URL", () => {
    const ics = buildOk({
      ...BASE,
      url: "https://tickets.example.net@evil.example.org/x",
    });
    expect(valueOf(ics, "URL")).toBe("URL:https://evil.example.org/x");
  });

  it("survives the data-URL round trip unescaped", () => {
    const file = downloadedFile(dataUrlOk({ ...BASE, url: REAL_URL }));
    expect(valueOf(file, "URL")).toBe(`URL:${REAL_URL}`);
    assertNoInjection(file, "uri via data url");
  });
});

// ── Dates JS cannot represent must fail safe ────────────────────────────────
//
// events.starts_at is `timestamptz not null`, so these are unreachable from a
// well-formed row today. They are reachable from Postgres, though: its range
// runs to 294276 AD and it accepts the literal 'infinity'. A throw here lands
// during ISR generation of the anon twin, failing the CACHED signed-out page
// for every visitor, not just the one render.
// 🧨 Note for anyone tempted to simplify lib/ics.ts: the start check and the
// end check are DELIBERATELY redundant, and removing either one alone is an
// EQUIVALENT MUTANT that this file cannot catch. NaN + n is NaN, so an
// unparseable start is still caught by the end check, and vice versa. Both
// removed together turns 7 tests red. Redundant is the point: each one becomes
// load-bearing the moment the other is refactored.
describe("unrepresentable dates fail safe", () => {
  const BAD: [string, string][] = [
    ["free text", "banana"],
    ["empty string", ""],
    ["postgres infinity", "infinity"],
    ["postgres -infinity", "-infinity"],
    ["year beyond the JS Date range", "+300000-01-01T00:00:00.000Z"],
    // 🧨 The one a throw-only guard lets through: toISOString() SUCCEEDS here
    // and returns the expanded "+010000-..." form, which strips to a signed
    // ten-digit DATE-TIME that strict clients reject outright.
    [
      "year 10000, which serialises to the expanded form",
      "+010000-01-01T00:00:00.000Z",
    ],
    ["year 275760, the last JS can hold", "+275760-09-13T00:00:00.000Z"],
    ["the string null", "null"],
  ];

  it.each(BAD)("returns null instead of throwing for %s", (_label, value) => {
    expect(() => buildIcs({ ...BASE, startsAt: value })).not.toThrow();
    expect(buildIcs({ ...BASE, startsAt: value })).toBeNull();
    expect(() => icsDataUrl({ ...BASE, startsAt: value })).not.toThrow();
    expect(icsDataUrl({ ...BASE, startsAt: value })).toBeNull();
  });

  it("falls back to two hours when the duration is not a finite number", () => {
    const ics = buildOk({ ...BASE, durationMins: Number.NaN });
    expect(valueOf(ics, "DTSTART")).toBe("DTSTART:20260912T193000Z");
    expect(valueOf(ics, "DTEND")).toBe("DTEND:20260912T213000Z");
  });

  it("returns null when the duration alone pushes the end out of range", () => {
    expect(() => buildIcs({ ...BASE, durationMins: 1e15 })).not.toThrow();
    expect(buildIcs({ ...BASE, durationMins: 1e15 })).toBeNull();
  });

  // RFC 5545 3.6.1 forbids DTEND <= DTSTART. durationMins is public and typed
  // `number`, so this is reachable by any caller, and a finiteness check alone
  // lets it straight through.
  it.each([
    ["zero", 0],
    ["negative", -30],
  ])(
    "returns null for a %s duration rather than ending before it starts",
    (_label, mins) => {
      expect(() => buildIcs({ ...BASE, durationMins: mins })).not.toThrow();
      expect(buildIcs({ ...BASE, durationMins: mins })).toBeNull();
    },
  );

  it("still builds normally for a representable date", () => {
    const ics = buildOk(BASE);
    expect(valueOf(ics, "DTSTART")).toBe("DTSTART:20260912T193000Z");
    assertNoInjection(ics, "valid date");
  });
});

// ── Composition: the expression components/event-actions.tsx actually builds ──
//
// 🧨 THIS BLOCK EXISTS BECAUSE EVERY TEST ABOVE MISSED A LIVE BUG. They all
// call buildIcs/icsDataUrl directly, so they proved the helper's contract and
// said nothing about the caller. The caller was passing
// safeExternalHref(event.sourceUrl) -- already WHATWG-parsed, which DELETES a
// carriage return rather than rejecting it -- so a corrupt source_url arrived
// pre-"repaired" and the fail-closed branch could never fire in production.
// "never rewrites a broken URI into a different working destination" was green
// and false at the same time. Model the consumer, not just the unit.
describe("composition: the pipeline the event page really runs", () => {
  // Exactly what components/event-actions.tsx does with a row.
  const asEventPageDoes = (sourceUrl: string | null, isPopup = false) => {
    // The REAL helper the component calls, not a re-implementation of it.
    const ticketUrl = ticketUrlForIcs({ sourceUrl, isPopup });
    return {
      ticketUrl,
      ics: buildIcs({
        uid: BASE.uid,
        title: BASE.title,
        startsAt: BASE.startsAt,
        location: BASE.location,
        description: ticketUrl ? `Tickets: ${ticketUrl}` : undefined,
        url: ticketUrl ?? undefined,
      }),
    };
  };

  it("refuses a source_url whose break the URL parser would have deleted", () => {
    const { ticketUrl, ics } = asEventPageDoes("https://exa\rmple.com/tickets");
    expect(ticketUrl).toBeNull();
    expect(ics).not.toBeNull();
    // The repaired host must appear NOWHERE: not in URL, not in DESCRIPTION.
    expect(ics!).not.toContain("example.com/tickets");
    expect(valueOf(ics!, "URL")).toBeUndefined();
    expect(valueOf(ics!, "DESCRIPTION")).toBeUndefined();
    assertNoInjection(ics!, "composition: broken source_url");
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "not-a-url",
    "",
  ])("refuses the unusable source_url %j end to end", (raw) => {
    const { ticketUrl, ics } = asEventPageDoes(raw);
    expect(ticketUrl).toBeNull();
    expect(valueOf(ics!, "URL")).toBeUndefined();
    expect(valueOf(ics!, "DESCRIPTION")).toBeUndefined();
    assertNoInjection(ics!, `composition: ${raw}`);
  });

  it("keeps a real ticket link's commas unescaped in URL and escaped in DESCRIPTION", () => {
    // The original point of this case, unchanged: URL is a URI value so its
    // commas survive verbatim, while DESCRIPTION is TEXT so the SAME commas
    // are backslash-escaped. Attribution now appends utm parameters to both,
    // which is why the assertions are on the comma treatment rather than on
    // the whole string.
    const REAL = "https://tickets.example.net/e/rooftop,soho?ll=51.5,-0.13";
    const { ticketUrl, ics } = asEventPageDoes(REAL);

    expect(ticketUrl).toContain("utm_source=funlondon");

    const url = valueOf(ics!, "URL")!;
    // PATH commas survive verbatim, which is the property that mattered: the
    // TEXT escaper used to turn them into "\," and a WHATWG parser then read
    // that backslash as "/", changing the path.
    expect(url).toContain("/e/rooftop,soho");
    // QUERY commas are percent-encoded, and that is applyAffiliate, not us:
    // it rebuilds the query through searchParams, so "," becomes "%2C". A
    // semantically equivalent encoding, and identical to what the on-page CTA
    // has always produced -- the point of this PR is that the two now match.
    expect(url).toContain("ll=51.5%2C-0.13");
    // Still no TEXT escaping anywhere in a URI value.
    expect(url).not.toContain("\\,");

    const desc = valueOf(ics!, "DESCRIPTION")!;
    expect(desc).toContain("/e/rooftop\\,soho");
    // %2C in the query, so there is no literal comma left there to escape.
    expect(desc).toContain("ll=51.5%2C-0.13");

    assertNoInjection(ics!, "composition: real ticket link");
  });

  it("handles a null source_url the way the row does", () => {
    const { ticketUrl, ics } = asEventPageDoes(null);
    expect(ticketUrl).toBeNull();
    expect(valueOf(ics!, "URL")).toBeUndefined();
    assertNoInjection(ics!, "composition: null source_url");
  });
});

// ---- Structure: the component is WIRED to icsUri ---------------------------
//
// The composition block above runs the right pipeline, but it builds that
// pipeline itself, so it proves what event-actions.tsx SHOULD do and not what
// it DOES. Swapping the component back to safeExternalHref left all of it
// green. This is the tripwire for that exact regression; it is a source scan,
// so it shows the wiring, not a runtime fact.
describe("structure: the ticket-url pipeline still starts from icsUri", () => {
  // PR #231's pin lived on the component, which read event.sourceUrl directly.
  // That read now lives in lib/ics-ticket-url.ts, so the pin follows it: the
  // invariant is unchanged (the RAW field is validated by icsUri before
  // anything parses it), only its address moved.
  const SRC = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "ics-ticket-url.ts"),
    "utf8",
  )
    // Block comments too, not just line comments: this file's own JSDoc spells
    // out the wrong order it exists to prevent, and a scanner that only strips
    // "//" reads that prose as code.
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\s*\/\/.*$/, ""))
    .join("\n");

  it("reads event.sourceUrl exactly once, through icsUri", () => {
    const reads = [...SRC.matchAll(/([A-Za-z]+)\(\s*event\.sourceUrl/g)].map(
      (m) => m[1],
    );
    expect(reads.length, "no read of event.sourceUrl found at all").toBe(1);
    expect(reads[0]).toBe("icsUri");
  });

  it("does not reach for safeExternalHref here", () => {
    // safeExternalHref parses before it validates, which deletes a carriage
    // return instead of refusing it. Correct for an href, wrong for this path.
    expect(SRC).not.toContain("safeExternalHref");
  });

  it("never wraps applyAffiliate on the outside of icsUri", () => {
    // icsUri(applyAffiliate(...)) is the laundering order.
    expect(SRC).not.toMatch(/icsUri\(\s*applyAffiliate/);
  });
});

// ---- Affiliate attribution on the calendar ticket link ---------------------
//
// The on-page CTA tags its outbound; the .ics did not, so every click that
// originated from someone's calendar -- the link they open days later, at the
// moment they actually buy -- arrived untagged.
//
// These call ticketUrlForIcs directly. The previous version of this block
// hand-rewrote the pipeline, which meant it proved what the component SHOULD
// do and stayed green through three separate wrong implementations, including
// an inverted pop-up ternary that would have stamped a ticketing id on an
// organiser's own page.
describe("ticketUrlForIcs: validate, then attribute", () => {
  const REAL = "https://www.ticketmaster.co.uk/event/1AwZk8gGkdJ9ZcH";

  it("tags a normal event with the CTA's utm parameters", () => {
    const out = ticketUrlForIcs({ sourceUrl: REAL, isPopup: false })!;
    expect(out).toContain("utm_source=funlondon");
    expect(out).toContain("utm_medium=app");
    expect(out).toContain("utm_campaign=reserve");
    expect(out).toContain("ticketmaster.co.uk/event/1AwZk8gGkdJ9ZcH");
  });

  // 🧨 Without a surface marker every outbound is identical, so a calendar
  // open and an on-page tap are the same row in the partner's report and the
  // attribution cannot answer the question it was added to answer.
  it("marks the surface, so a calendar click is distinguishable", () => {
    const out = ticketUrlForIcs({ sourceUrl: REAL, isPopup: false })!;
    // The LITERAL, not the imported constant: asserting against ICS_SURFACE
    // moves with it, so renaming it to "reserve" (which collides with
    // utm_campaign=reserve and re-muddles the report) would stay green.
    expect(out).toContain("utm_content=calendar");
    expect(ICS_SURFACE).toBe("calendar");
    // And the CTA's own output deliberately does NOT carry it.
    expect(applyAffiliate("ticketmaster", REAL)).not.toContain("utm_content");
  });

  // 🧨 THE DIRECTION of the pop-up branch, which a source regex cannot see.
  it("leaves a pop-up untagged, and does not merely tag something", () => {
    const popup = "https://organiser.example.com/our-popup";
    expect(ticketUrlForIcs({ sourceUrl: popup, isPopup: true })).toBe(popup);
    // The inverted ternary would return the tagged value here and the raw one
    // for normal events; assert both directions so neither passes alone.
    expect(ticketUrlForIcs({ sourceUrl: popup, isPopup: false })).toContain(
      "utm_source=funlondon",
    );
  });

  // 🧨 THE ORDER. applyAffiliate parses and re-serialises, so it silently
  // REPAIRS a corrupt URL. Validating first is what stops that repair being
  // published to someone's calendar.
  it("refuses a corrupt URL instead of publishing the parser's repair", () => {
    const dirty = `https://exa${String.fromCharCode(13)}mple.com/tickets`;
    expect(ticketUrlForIcs({ sourceUrl: dirty, isPopup: false })).toBeNull();

    // Proof the wrong order really does launder it, rather than an assertion
    // that it would: this is what icsUri(applyAffiliate(raw)) returns.
    const laundered = icsUri(applyAffiliate("ticketmaster", dirty))!;
    expect(laundered).toContain("https://example.com/tickets");
    expect(laundered).toContain("utm_source=funlondon");
  });

  it.each(["javascript:alert(1)", "data:text/html,<b>x</b>", "not-a-url", ""])(
    "still refuses %j after attribution was introduced",
    (raw) => {
      expect(ticketUrlForIcs({ sourceUrl: raw, isPopup: false })).toBeNull();
    },
  );

  // icsUri returns the PARSED serialisation (PR #231's deliberate design), so
  // these two are normalised rather than refused. Pinned because "refused" was
  // my first assumption and it was wrong: what matters is that neither can
  // reach a calendar as something it is not.
  it("trims padding rather than refusing it, and keeps the destination", () => {
    const out = ticketUrlForIcs({
      sourceUrl: "  https://example.com/padded  ",
      isPopup: false,
    })!;
    expect(out.startsWith("https://example.com/padded")).toBe(true);
    expect(out).not.toMatch(/^\s|\s$/);
  });

  it("strips a userinfo disguise instead of publishing it", () => {
    const out = ticketUrlForIcs({
      sourceUrl: "https://ticketmaster.co.uk@evil.example.org/x",
      isPopup: false,
    })!;
    // The real host, with the ticketmaster-looking prefix gone.
    expect(out.startsWith("https://evil.example.org/x")).toBe(true);
    expect(out).not.toContain("ticketmaster.co.uk@");
  });

  // The anon contract: mapEventPreview hard-nulls sourceUrl for signed-out
  // visitors, so attribution must not invent a link out of nothing.
  it("returns null for the anon shape and invents nothing", () => {
    expect(ticketUrlForIcs({ sourceUrl: null, isPopup: false })).toBeNull();
    expect(ticketUrlForIcs({ sourceUrl: null, isPopup: true })).toBeNull();
  });
});

describe("the .ics built from an attributed link", () => {
  const REAL = "https://www.ticketmaster.co.uk/event/1AwZk8gGkdJ9ZcH";

  const icsFor = (sourceUrl: string | null, isPopup = false) => {
    const ticketUrl = ticketUrlForIcs({ sourceUrl, isPopup });
    return buildIcs({
      uid: BASE.uid,
      title: BASE.title,
      startsAt: BASE.startsAt,
      location: BASE.location,
      description: ticketUrl ? `Tickets: ${ticketUrl}` : undefined,
      url: ticketUrl ?? undefined,
    })!;
  };

  it("tags URL and DESCRIPTION, and keeps their value types apart", () => {
    const ics = icsFor(REAL);
    expect(valueOf(ics, "URL")).toContain("utm_source=funlondon");
    // DESCRIPTION is TEXT even though it contains a URL: its "," and ";" are
    // backslash-escaped, and a consumer un-escapes before linkifying.
    expect(valueOf(ics, "DESCRIPTION")).toContain("utm_source=funlondon");
    expect(
      valueOf(ics, "DESCRIPTION")!.startsWith("DESCRIPTION:Tickets: "),
    ).toBe(true);
    assertNoInjection(ics, "attributed ticket link");
  });

  it("omits both properties for the anon shape", () => {
    const ics = icsFor(null);
    expect(valueOf(ics, "URL")).toBeUndefined();
    expect(valueOf(ics, "DESCRIPTION")).toBeUndefined();
    expect(ics).not.toContain("utm_source");
    assertNoInjection(ics, "anon: no ticket link");
  });
});

// The component must be WIRED to the helper. A test that calls the helper
// proves the helper; only this proves the caller uses it.
describe("icsInputForEvent: the whole calendar entry, by calling it", () => {
  const EV = {
    id: "3f1c2b8e-0f6a-4a2b-9a1e-7c5d2f0b1a33",
    name: "Childish Gambino",
    venueName: "Jazz Cafe",
    area: "Camden",
    startsAt: "2026-09-12T19:30:00.000Z",
    sourceUrl: "https://www.ticketmaster.co.uk/event/X",
    isPopup: false,
  } as unknown as Parameters<typeof icsInputForEvent>[0];

  it("puts the attributed link in BOTH url and description", () => {
    const input = icsInputForEvent(EV);
    expect(input.url).toContain("utm_content=calendar");
    expect(input.description).toContain("utm_content=calendar");
    expect(input.description).toContain("Saved from Fun London.");
  });

  it("omits both when there is no usable link, and invents nothing", () => {
    const input = icsInputForEvent({ ...EV, sourceUrl: null } as typeof EV);
    expect(input.url).toBeUndefined();
    expect(input.description).toBeUndefined();
  });

  it("still carries the fields that do not depend on the link", () => {
    const input = icsInputForEvent(EV);
    expect(input.title).toBe("Childish Gambino");
    expect(input.location).toBe("Jazz Cafe, Camden, London");
    expect(input.startsAt).toBe("2026-09-12T19:30:00.000Z");
  });
});

describe("structure: event-actions.tsx delegates the whole entry", () => {
  const SRC = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "components",
      "event-actions.tsx",
    ),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\s*\/\/.*$/, ""))
    .join("\n");

  it("builds the entry through icsInputForEvent", () => {
    expect(SRC).toMatch(/icsDataUrl\(\s*icsInputForEvent\(\s*event\s*\)\s*\)/);
  });

  it("holds no pipeline of its own", () => {
    for (const forbidden of [
      "event.sourceUrl",
      "applyAffiliate",
      "icsUri",
      "Tickets:",
    ]) {
      expect(SRC).not.toContain(forbidden);
    }
  });
});

// ---- The calendar entry names its sender, and discloses when it earns -------
//
// 🧨 An .ics is FROZEN AT DOWNLOAD. A disclosure added after an affiliate id is
// configured never reaches the files already on people's devices, so the
// sentence has to exist before the id does. Gating both on the same env var is
// what makes that impossible to get wrong.
describe("icsTicketDescription", () => {
  const URL_ = "https://www.ticketmaster.co.uk/event/X?utm_source=funlondon";
  const attributed = {
    url: URL_,
    attributed: true,
    label: "Tickets" as const,
  };
  const unattributed = {
    url: URL_,
    attributed: false,
    label: "Official page" as const,
  };

  it("names the sender, which the URL alone never does", () => {
    expect(icsTicketDescription(attributed)!).toContain(
      "Saved from Fun London.",
    );
  });

  it("keeps the link on its own line", () => {
    const out = icsTicketDescription(attributed)!;
    expect(out.split("\n")[0]).toBe(`Tickets: ${URL_}`);
  });

  // 🧨 In afterEach, not inline: a FAILING assertion would otherwise leak
  // NEXT_PUBLIC_AFFILIATE_TICKETMASTER into every later test in this worker,
  // where it silently starts appending awc= to the byte-identity assertions.
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("claims NO commission while no affiliate id is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_AFFILIATE_TICKETMASTER", "");
    expect(icsTicketDescription(attributed)!).not.toContain("commission");
  });

  it("discloses the commission as soon as an id IS configured", () => {
    vi.stubEnv("NEXT_PUBLIC_AFFILIATE_TICKETMASTER", "some-awin-id");
    expect(icsTicketDescription(attributed)!).toContain(
      "We may earn a commission from this link.",
    );
  });

  // 🧨 THE BLOCKER. A pop-up is deliberately exempt from attribution, so its
  // link carries no id and no utm parameters. Gating the sentence on the env
  // var ALONE would have shipped "We may earn a commission from this link."
  // onto an organiser's own page -- a false claim, frozen on the device of
  // everyone who had already saved it.
  it("never claims a commission on a link it did not attribute", () => {
    vi.stubEnv("NEXT_PUBLIC_AFFILIATE_TICKETMASTER", "some-awin-id");
    expect(icsTicketDescription(unattributed)!).not.toContain("commission");
    expect(icsTicketDescription(unattributed)!).toContain(
      "Saved from Fun London.",
    );
  });

  // End to end through the real pipeline, so the exemption cannot be lost
  // between ticketLinkForIcs and the sentence.
  it("a pop-up event's .ics discloses nothing, even with an id set", () => {
    vi.stubEnv("NEXT_PUBLIC_AFFILIATE_TICKETMASTER", "some-awin-id");
    const popup = {
      sourceUrl: "https://organiser.example.com/our-popup",
      isPopup: true,
    };
    const desc = icsTicketDescription(ticketLinkForIcs(popup))!;
    expect(desc).not.toContain("commission");
    expect(desc).not.toContain("utm_");
  });

  it("returns undefined when there is no ticket link at all", () => {
    expect(icsTicketDescription(null)).toBeUndefined();
  });

  it("promises nothing that can go stale", () => {
    // No price, no line-up, no availability: the app can correct those, a file
    // on someone's phone cannot.
    const out = icsTicketDescription(attributed)!.toLowerCase();
    for (const stale of [
      "£",
      "sold out",
      "available",
      "from £",
      "tickets left",
    ]) {
      expect(out).not.toContain(stale);
    }
  });

  it("survives TEXT escaping as two readable lines", () => {
    const ics = buildIcs({
      uid: BASE.uid,
      title: BASE.title,
      startsAt: BASE.startsAt,
      description: icsTicketDescription(attributed)!,
    })!;
    const desc = valueOf(ics, "DESCRIPTION")!;
    // The real newline became the RFC 5545 escaped form, on ONE content line.
    expect(desc).toContain("\\nSaved from Fun London.");
    assertNoInjection(ics, "description with provenance");
  });
});

// The surface marker must not leak into a provider's own utm namespace.
describe("applyAffiliate surface scoping", () => {
  it("adds the surface alongside our own attribution", () => {
    const out = applyAffiliate(
      "ticketmaster",
      "https://x.example/e",
      "calendar",
    );
    expect(out).toContain("utm_source=funlondon");
    expect(out).toContain("utm_content=calendar");
  });

  // 🧨 When the provider owns the utm namespace we add NOTHING. Dropping our
  // utm_content into their campaign's creative dimension is a value neither
  // side can read correctly.
  it("adds nothing when the provider already set utm_source", () => {
    const provider =
      "https://x.example/e?utm_source=partnerX&utm_content=theirs";
    const out = applyAffiliate("ticketmaster", provider, "calendar");
    expect(out).toContain("utm_source=partnerX");
    expect(out).toContain("utm_content=theirs");
    expect(out).not.toContain("funlondon");
    expect(out).not.toContain("calendar");
  });

  it("omits utm_content entirely when no surface is given (the CTA)", () => {
    expect(applyAffiliate("ticketmaster", "https://x.example/e")).not.toContain(
      "utm_content",
    );
  });
});

// A pop-up's CTA reads "Visit official page", not "Get tickets" -- many are
// free. Promising "Tickets:" for a page that sells nothing is a small invented
// fact, and in an .ics it is frozen on the device.
describe("the description labels what is actually on the other end", () => {
  it('says "Tickets" for a ticketed event', () => {
    const link = ticketLinkForIcs({
      sourceUrl: "https://www.ticketmaster.co.uk/event/X",
      isPopup: false,
    })!;
    expect(link.label).toBe("Tickets");
    expect(icsTicketDescription(link)!.startsWith("Tickets: ")).toBe(true);
  });

  it('says "Official page" for a pop-up, and never promises tickets', () => {
    const link = ticketLinkForIcs({
      sourceUrl: "https://organiser.example.com/our-popup",
      isPopup: true,
    })!;
    expect(link.label).toBe("Official page");
    const desc = icsTicketDescription(link)!;
    expect(desc.startsWith("Official page: ")).toBe(true);
    expect(desc).not.toContain("Tickets");
  });

  // 🧨 The label is plumbed, NOT derived from `attributed`. They coincide today
  // and answer different questions; deriving one from the other is the kind of
  // accidental coupling that let earlier inversions in this file stay green.
  it("keeps label and attribution as independent facts", () => {
    expect(
      icsTicketDescription({
        url: "https://x.example/e",
        attributed: true,
        label: "Official page",
      })!.startsWith("Official page: "),
    ).toBe(true);
  });
});
