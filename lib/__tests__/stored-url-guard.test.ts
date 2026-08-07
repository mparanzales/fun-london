// A url column holds a real URL or NULL. Never a sentinel string.
//
// The live catalogue carried six rows spelling "N/A" (5) and "Not available"
// (1) in events.source_url, written by the Gemini-era pop-up generator, plus a
// live code path in scripts/ingest-events.ts that stored `e.url ?? ""`.
//
// Nothing rendered wrong: parseExternalUrl refuses all of them. The bug is the
// SHAPE. The column is nullable, so the natural read is a truthiness check, and
// `"N/A" ? a : b` takes the wrong branch. That is a trap for the next reader,
// which is why this is guarded rather than left to "it happens to be fine".

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { storedUrlOrNull } from "@/lib/safe-url";

// The values actually found in production, plus the ones a provider or a model
// would plausibly produce next. The point of an allowlist is that this list
// does not have to be complete.
const SENTINELS = [
  ["the five live rows", "N/A"],
  ["the sixth live row", "Not available"],
  ['empty string, from `e.url ?? ""`', ""],
  ["whitespace only", "   "],
  ["lowercase variant", "n/a"],
  ["dash", "-"],
  ["none", "none"],
  ["null spelled out", "null"],
  ["undefined spelled out", "undefined"],
  ["TBC", "TBC"],
  [
    "a bare host, which the browser would resolve against our own origin",
    "www.example.com",
  ],
  ["a relative path", "/tickets"],
];

describe("storedUrlOrNull nulls everything that is not a URL", () => {
  it.each(SENTINELS)("nulls %s", (_label, value) => {
    expect(storedUrlOrNull(value)).toBeNull();
  });

  it.each([[null], [undefined]])("passes %s through as null", (value) => {
    expect(storedUrlOrNull(value as null | undefined)).toBeNull();
  });

  // Non-web schemes are refused here for the same reason they are refused at
  // the href: storing one means something downstream may yet render it.
  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
  ])("nulls the non-web scheme %j", (value) => {
    expect(storedUrlOrNull(value)).toBeNull();
  });
});

describe("storedUrlOrNull preserves a real URL exactly", () => {
  // 🧨 Byte-for-byte, NOT the parsed serialisation. This runs on every sync, so
  // returning `u.toString()` would silently rewrite every stored URL on the
  // next cron run: trailing slash added, host lowercased, characters
  // percent-encoded. Validate without normalising.
  it.each([
    "https://www.eventbrite.co.uk/e/some-event-tickets-123456789",
    "https://www.ticketmaster.co.uk/event/1AwZk8gGkdJ9ZcH",
    "http://example.com",
    "https://example.com",
    "https://example.com/e/rooftop,soho?ll=51.5,-0.13;t=2",
    "https://EXAMPLE.com/Path",
    "https://example.com:8443/x?a=1#frag",
    "https://example.com/a%20b",
  ])("returns %j unchanged", (value) => {
    expect(storedUrlOrNull(value)).toBe(value);
  });

  it("does not add a trailing slash to a bare origin", () => {
    // parseExternalUrl(...).toString() WOULD return "https://example.com/".
    expect(storedUrlOrNull("https://example.com")).toBe("https://example.com");
  });
});

// The helper being correct is half of it. This is the half that rots: a new
// provider block added to the ingest script with `source_url: e.url` reopens
// the hole, and no behavioural test would notice.
describe("structure: every source_url write goes through the normaliser", () => {
  const SCRIPT = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "scripts",
    "ingest-events.ts",
  );
  // 🧨 Line comments are stripped FIRST. The regex below anchors on the comma
  // at end of line, so `source_url: e.url, // skiddle has no normaliser yet`
  // was invisible to it: found.length stayed at 4 and "wraps every one of
  // them" never saw the new site. A trailing comment is exactly how someone
  // writes a new provider block, so the guard has to see through one.
  const SRC = readFileSync(SCRIPT, "utf8")
    .split("\n")
    .map((l) => l.replace(/\s*\/\/.*$/, ""))
    .join("\n");

  // Assignments only: `source_url: <something>,`. The type declaration
  // (`source_url: string | null;`) ends in a semicolon and is excluded.
  const ASSIGNMENT = /^\s*source_url:\s*(.+),$/gm;

  it("still has exactly the four write sites it was written for", () => {
    // Exact, not a floor. A floor can only catch a DELETION; an addition -- a
    // new provider block -- is the regression this guard is actually for, and
    // ">= 4" is blind to it. Changing this number should require a human to
    // look at the new site.
    const found = [...SRC.matchAll(ASSIGNMENT)];
    expect(
      found.length,
      "source_url write sites changed - check the new one is normalised",
    ).toBe(4);
  });

  it("wraps every one of them", () => {
    const bare: string[] = [];
    for (const m of SRC.matchAll(ASSIGNMENT)) {
      // 🧨 The WHOLE right-hand side, not a prefix. A prefix test passes
      // `storedUrlOrNull(e.url) ?? ""`, which re-stores the exact sentinel
      // this PR exists to delete -- and that is the natural thing to write
      // when a string-typed field complains about null.
      if (!/^storedUrlOrNull\([^)]*\)$/.test(m[1])) bare.push(m[0].trim());
    }
    expect(
      bare,
      `unnormalised source_url writes in scripts/ingest-events.ts:\n${bare.join("\n")}`,
    ).toEqual([]);
  });

  it("keeps the column's type nullable, so null is representable", () => {
    // `source_url: string` would force every caller back to a sentinel.
    expect(SRC).toMatch(/source_url:\s*string \| null;/);
  });

  // Deliberately no separate `?? ""` regex here. The earlier one used a
  // character class that could not contain "(", so it could never match
  // `storedUrlOrNull(e.url) ?? ""` -- the exact expression it was meant to
  // catch. The whole-RHS assertion above is what actually catches it; a test
  // pinning something unreachable is worse than no test.
});

// Control characters, checked on the RAW string before parsing.
//
// 🧨 The parser DELETES CR/LF/TAB rather than rejecting them (the lesson from
// PR #231). So a URL carrying one parses fine, and storing it would persist a
// value that no consumer ever resolves to, while storing the parsed form would
// persist a host the provider never sent. Refuse instead of choosing.
describe("storedUrlOrNull refuses a URL carrying a control character", () => {
  const ch = (code: number) => String.fromCharCode(code);

  it.each([
    ["CR", 0x0d],
    ["LF", 0x0a],
    ["TAB", 0x09],
    ["NUL", 0x00],
    ["vertical tab", 0x0b],
    ["form feed", 0x0c],
    ["DEL", 0x7f],
  ])("nulls an otherwise-valid URL containing %s", (_label, code) => {
    expect(
      storedUrlOrNull(`https://exa${ch(code)}mple.com/tickets`),
    ).toBeNull();
  });

  it("does not silently repair it into a different host", () => {
    // The parser would happily yield "https://example.com/tickets" here.
    const out = storedUrlOrNull(
      `https://exa${String.fromCharCode(13)}mple.com/tickets`,
    );
    expect(out).toBeNull();
    expect(out).not.toBe("https://example.com/tickets");
  });
});

// Inputs the URL parser SILENTLY REPAIRS. Storing the original would persist a
// value nothing resolves to; storing the parsed form would persist something
// the provider never sent. Both are wrong, so both are refused.
describe("storedUrlOrNull refuses an input whose parse is not faithful", () => {
  it.each([
    ["leading space", "  https://example.com/t"],
    ["trailing space", "https://example.com/t  "],
    ["leading newline", "\nhttps://example.com/t"],
    ["surrounding tabs", "\thttps://example.com/t\t"],
  ])("nulls %s, which the parser would silently trim", (_l, value) => {
    expect(storedUrlOrNull(value)).toBeNull();
  });

  // 🧨 The phishing shape. parseExternalUrl STRIPS userinfo, so returning the
  // original would store the disguise intact -- and applyAffiliate would then
  // stamp our UTM parameters onto the attacker's host.
  it.each([
    "https://www.ticketmaster.co.uk@evil.example.org/x",
    "https://user:pass@evil.example.org/x",
    "http://ticketmaster.co.uk@evil.example.org",
  ])("nulls the userinfo disguise %j", (value) => {
    expect(storedUrlOrNull(value)).toBeNull();
  });

  it.each([
    ["C1 U+0080", 0x80],
    ["C1 U+009F", 0x9f],
  ])("nulls %s, which Postgres [[:cntrl:]] also matches", (_l, code) => {
    expect(
      storedUrlOrNull(`https://exa${String.fromCharCode(code)}mple.com/t`),
    ).toBeNull();
  });

  // The invariant the migration's predicate relies on: anything we store
  // literally begins with the scheme, so the SQL shape test is a true floor.
  it("everything it accepts starts with http(s):// literally", () => {
    for (const v of [
      "https://example.com",
      "http://example.com/x?a=1,2;b=3",
      "HTTPS://EXAMPLE.com/Path",
    ]) {
      const out = storedUrlOrNull(v);
      expect(out).toBe(v);
      expect(out!).toMatch(/^https?:\/\//i);
    }
  });
});

// The migration is half of this change and nothing was reading it. Swapping its
// allowlist predicate for `= 'N/A'` would clean five of the six live rows,
// leave "Not available" sitting there looking fixed, and keep every other test
// in this file green.
describe("migration 0007 stays a shape test, not a list of spellings", () => {
  const SQL = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "supabase",
      "migrations",
      "0007_event_source_url_hygiene.sql",
    ),
    "utf8",
  );

  // Only what actually runs: the house convention for reading a migration.
  const executable = SQL.split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();

  it("tests the SHAPE of the value, never a specific spelling", () => {
    // Tolerant of a TIGHTER predicate: what matters is that it is a regex
    // shape test on source_url, not which exact pattern. Pinning the exact
    // string would turn an improvement red.
    expect(executable).toMatch(/source_url\s*!~\*\s*'\^https\?:\/\//);
    // `= 'N/A'` / `in ('N/A', ...)` is the denylist this rejects.
    expect(executable).not.toMatch(/source_url\s*(=|in)\s*\(?\s*'/i);
  });

  // 🧨 STRUCTURE, not token presence. Flipping this `or` to `and` makes the
  // predicate require a value to be BOTH non-http AND control-carrying, which
  // matches zero rows -- the six sentinels survive and every token-presence
  // test stays green.
  it("combines its two branches with OR, so either alone matches", () => {
    // Structure, not spelling: either branch alone must be able to match.
    // Pinning the exact control-character pattern would turn a TIGHTENING of
    // the predicate red, which is the trap the sibling test above avoids.
    expect(executable).toMatch(
      /where source_url is not null and \( source_url !~\* '[^']+' or source_url ~ '\[[^']+\]' \)/i,
    );
    expect(executable).not.toMatch(/!~\* '[^']+' and source_url ~/i);
  });

  // 🧨 An ALLOWLIST of statement verbs. The previous version denylisted five
  // DDL strings, which let `delete from public.events where ...` through --
  // in a PR whose whole thesis is that denylists are one spelling away from
  // being wrong.
  it("its second branch is a CONTROL-character test, whatever the spelling", () => {
    // Either the locale-independent explicit range (preferred) or the
    // [[:cntrl:]] class. Not an unrelated class: swapping this branch to
    // [[:space:]] would quietly stop catching the thing it exists for.
    const CONTROL_BRANCH = new RegExp(
      "source_url ~ '\\[(\\[:cntrl:\\]|" +
        "\\\\u0001-\\\\u001F\\\\u007F-\\\\u009F)\\]'",
      "i",
    );
    expect(executable).toMatch(CONTROL_BRANCH);
  });

  it("runs only begin / one update / commit", () => {
    const verbs = (
      executable.match(
        /\b(begin|commit|rollback|update|insert|delete|truncate|alter|create|drop|grant|revoke|copy|merge)\b/gi,
      ) ?? []
    ).map((v) => v.toLowerCase());
    expect(verbs).toEqual(["begin", "update", "commit"]);
  });

  it("only ever writes NULL, and only to public.events", () => {
    expect(executable).toMatch(/set source_url = null/i);
    expect(executable.match(/update public\.\w+/gi)).toEqual([
      "update public.events",
    ]);
  });

  // Named for what it actually pins. The RETURNING rows are DISCARDED on every
  // apply path this repo documents (Supabase MCP apply_migration, `db push`,
  // and the dashboard editor, which shows only the last statement's result --
  // here, `commit`). Only `psql -f` prints them. The durable record of what was
  // destroyed is the hardcoded rollback id list in the header, plus the
  // operator's own pre-apply snapshot.
  it("asks for its rows back, for whoever runs the statement standalone", () => {
    expect(executable).toMatch(/returning id/i);
  });
});
