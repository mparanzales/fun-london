// Proper nouns must be sanitised at the mapper, on every mapper, with the
// RIGHT helper.
//
// text.test.ts proves the helpers strip what they should and keep what they
// should. This file proves the MAPPERS ARE WIRED to them, which is the half
// that rots: lib/queries.ts has five near-identical mappers, and for a long
// time exactly one field in two of them was tidied while venue_name, area, and
// the venue's own name and neighbourhood went through raw.
//
// 🧨 Two ways an earlier version of THIS FILE was green while the invariant was
// broken, both worth remembering:
//   1. It only ever tested the helper, never a mapper. Rewriting one line to
//      `const tidyName = tidyText` renames every venue on every surface, and
//      the entire suite stayed green. Hence the behavioural block below, which
//      calls a real mapper.
//   2. Its structural half counted matches against a ">= 10" floor and accepted
//      any of four wrappers. Two sites could vanish from the scan, and swapping
//      the sanitiser for the editorial helper counted as compliant. Hence the
//      exact per-mapper table: each field names the ONE wrapper it may have.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { repairMojibake } from "@/lib/text";
import { mapVenuePreview } from "@/lib/queries";

const QUERIES = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "queries.ts",
);

// Every mapper, every field carrying a name or a place, and the exact helper it
// must be wrapped in.
//
// tidyName (= repairMojibake) strips only what can never be legitimate.
// tidyDashes (= tidyText) ALSO rewrites em/en dashes to ", ", which is right
// for copy Fun London wrote and wrong for a name somebody else owns.
//
// ⚠️ events.name is the one deliberate inconsistency in this table. It is a
// promoter's title from Ticketmaster or Eventbrite, so by the same authorship
// argument it arguably belongs on tidyName too. It stays on tidyDashes here
// because moving it changes live rendered copy (one current event title,
// "Summer Residency <en dash> Week 1"), which is Maria's call to make and not a
// side effect of a security fix. Pinned so the question cannot be lost.
// [wrapper, source column]. The column is pinned too: checking only the
// helper let `name: tidyName(r.slug)` and a venueName/area swap pass.
const EXPECTED: Record<string, Record<string, [string, string]>> = {
  mapVenue: {
    name: ["tidyName", "r.name"],
    neighbourhood: ["tidyName", "r.neighbourhood"],
    address: ["tidyName", "r.address"],
  },
  mapVenuePlan: {
    name: ["tidyName", "r.name"],
    neighbourhood: ["tidyName", "r.neighbourhood"],
  },
  mapVenuePreview: {
    name: ["tidyName", "r.name"],
    neighbourhood: ["tidyName", "r.neighbourhood"],
  },
  mapEvent: {
    name: ["tidyDashes", "r.name"],
    venueName: ["tidyName", "r.venue_name"],
    area: ["tidyName", "r.area"],
  },
  mapEventPreview: {
    name: ["tidyDashes", "r.name"],
    venueName: ["tidyName", "r.venue_name"],
    area: ["tidyName", "r.area"],
  },
};

const SRC = readFileSync(QUERIES, "utf8");

// One mapper's body, from its declaration to the next top-level close. Bound
// per FUNCTION, not per file: otherwise one compliant line anywhere in the file
// satisfies a check meant for a different mapper.
function bodyOf(fn: string): string {
  const start = SRC.indexOf(`function ${fn}(`);
  expect(start, `mapper ${fn} not found in lib/queries.ts`).toBeGreaterThan(-1);
  const end = SRC.indexOf("\n}", start);
  expect(end, `could not find the end of ${fn}`).toBeGreaterThan(start);
  return SRC.slice(start, end);
}

describe("structure: every mapper sanitises with the right helper", () => {
  for (const [fn, fields] of Object.entries(EXPECTED)) {
    for (const [prop, [wrapper, column]] of Object.entries(fields)) {
      it(`${fn} wraps ${prop} in ${wrapper}(${column})`, () => {
        const found = bodyOf(fn).match(
          new RegExp(`^\\s*${prop}:\\s*(.+),$`, "m"),
        );
        // Without this the test would pass by matching nothing, which is how a
        // renamed field turns a guard into decoration.
        expect(found, `${fn} does not assign ${prop} at all`).not.toBeNull();
        expect(
          found![1],
          `${fn}.${prop} must be exactly ${wrapper}(${column})`,
        ).toBe(`${wrapper}(${column})`);
      });
    }
  }

  it("covers every mapper the file defines", () => {
    // A sixth mapper added later has to be added to EXPECTED, rather than being
    // silently exempt from it.
    // Arrow and const forms count too: matching only `function map...(`
    // leaves `export const mapVenueLite = (r) => ({...})` silently exempt,
    // which is the same hole as the ">= 10 floor" this replaced.
    const declared = [
      ...SRC.matchAll(/^(?:export )?(?:async )?function (map\w+)\s*[(<]/gm),
      ...SRC.matchAll(/^(?:export )?const (map\w+)\s*[=:]/gm),
    ].map((m) => m[1]);
    expect(declared.sort()).toEqual(Object.keys(EXPECTED).sort());
  });
});

describe("behaviour: a real mapper, not just the helper", () => {
  const ch = (code: number) => String.fromCharCode(code);

  // The row shape mapVenuePreview takes; only the fields under test matter.
  const row = (name: string, neighbourhood: string) =>
    ({
      id: "v1",
      slug: "test-venue",
      name,
      type: "restaurant",
      vibe: "cosy",
      neighbourhood,
      price: "££",
      time_of_day: "evening",
      rating: 4.5,
      review_count: 10,
      img_url: "https://example.com/p.jpg",
      lat: 51.5,
      lng: -0.1,
      curation_tier: "curated",
      created_at: "2026-01-01T00:00:00Z",
    }) as unknown as Parameters<typeof mapVenuePreview>[0];

  it("strips a direction override from a venue name", () => {
    expect(mapVenuePreview(row(`Dar${ch(0x202e)}kroom Bar`, "Soho")).name).toBe(
      "Darkroom Bar",
    );
  });

  it("strips an isolate from a neighbourhood", () => {
    expect(mapVenuePreview(row("Bar", `${ch(0x2067)}Soho`)).neighbourhood).toBe(
      "Soho",
    );
  });

  // 🧨 THE CASE THAT CATCHES `const tidyName = tidyText`. A live venue is named
  // "Hermanos Colombian Coffee Roasters <en dash> Angel Lane", and the
  // editorial helper would rewrite that dash to a comma and rename the business
  // on the card, the OG title and the calendar entry.
  it("does NOT rewrite a dash in a venue name", () => {
    const NAME = "Hermanos Colombian Coffee Roasters \u2013 Angel Lane";
    expect(mapVenuePreview(row(NAME, "Angel")).name).toBe(NAME);
  });

  it("does NOT rewrite a street-number range", () => {
    const NAME = "The Photographers' Gallery, 16\u201318 Ramillies Street";
    expect(mapVenuePreview(row(NAME, "Soho")).name).toBe(NAME);
  });
});

// 🧨 The MIRROR mutant. Everything above pins tidyName; nothing pinned
// tidyDashes, so `const tidyDashes = repairMojibake` left every call site
// intact, satisfied the whole structural table, and silently killed the
// no-dashes brand rule on every editorial surface. A guard that only checks
// one direction of a two-way alias is half a guard.
describe("behaviour: the editorial helper is still the editorial one", () => {
  const row = (vibe: string) =>
    ({
      id: "v1",
      slug: "s",
      name: "Bar",
      type: "restaurant",
      vibe,
      neighbourhood: "Soho",
      price: "££",
      time_of_day: "evening",
      rating: 4.5,
      review_count: 10,
      img_url: "https://example.com/p.jpg",
      lat: 51.5,
      lng: -0.1,
      curation_tier: "curated",
      created_at: "2026-01-01T00:00:00Z",
    }) as unknown as Parameters<typeof mapVenuePreview>[0];

  it("still applies the no-dashes rule to a vibe line", () => {
    expect(mapVenuePreview(row("Cosy \u2014 and loud")).vibe).toBe(
      "Cosy, and loud",
    );
  });

  it("still repairs mojibake in a vibe line", () => {
    expect(mapVenuePreview(row("Stars \u00C2\u0080\u0093 Voyager")).vibe).toBe(
      "Stars, Voyager",
    );
  });
});

describe("behaviour: the helper's own contract", () => {
  const ch = (code: number) => String.fromCharCode(code);

  it.each([
    ["LRE U+202A", 0x202a],
    ["RLO U+202E", 0x202e],
    ["LRI U+2066", 0x2066],
    ["PDI U+2069", 0x2069],
    ["ALM U+061C", 0x061c],
    ["word joiner U+2060", 0x2060],
    ["zero width space U+200B", 0x200b],
    ["BOM U+FEFF", 0xfeff],
  ])("strips %s", (_label, code) => {
    expect(repairMojibake(`Roof${ch(code as number)}top`)).toBe("Rooftop");
  });

  it.each([
    "Jazz Cafe",
    "Knightsbridge / Belgravia",
    "The Photographers' Gallery, 16\u201318 Ramillies Street",
    "Hermanos Colombian Coffee Roasters \u2013 Angel Lane",
    "King's Cross",
    "Bar Américain",
  ])("leaves %j untouched", (value) => {
    expect(repairMojibake(value)).toBe(value);
  });
});
