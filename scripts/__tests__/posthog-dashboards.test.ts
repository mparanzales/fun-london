import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readUnionEvents } from "../posthog-events";

// Guards for the PostHog provisioning + verification scripts.
//
// These two files are the only things standing between "we have analytics" and
// "we have numbers nobody checked". Three properties have to hold, and all
// three have already been wrong at least once:
//
//   1. the verifier must check EVERY event, not a hand-list that drifted;
//   2. provisioning matches BY NAME, so duplicate names silently create
//      duplicate dashboards on the next run;
//   3. no insight may sweep in the fl_probe_manual test event.

function src(rel: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../${rel}`, import.meta.url)),
    "utf8",
  );
}

const provision = src("posthog-provision-dashboards.ts");
const verify = src("posthog-verify-events.ts");
const events = src("posthog-events.ts");

const analytics = readFileSync(
  fileURLToPath(new URL("../../lib/analytics.ts", import.meta.url)),
  "utf8",
);

// THE REAL IMPLEMENTATION, imported rather than re-implemented. A previous
// version of this file kept its own copy of the parse, which meant deleting the
// comment-stripping line from the verifier would have dropped it to 22 of 33
// events with all 12 of these tests still green.
const unionEvents = readUnionEvents;

describe("the verifier checks every event, not a hand-maintained list", () => {
  it("derives its event list from the union at runtime", () => {
    // It used to carry a literal OTHERS array with a comment saying "kept in
    // sync by hand". By the time PR #189 merged it was missing 13 of the 33
    // union members, so --all silently reported on 20 and said nothing about
    // the rest.
    expect(verify).toContain("readUnionEvents");
    expect(verify).not.toContain("Kept in sync by hand");
    // And the shared module is the one doing it, so this test and the script
    // cannot drift apart.
    expect(verify).toContain('from "./posthog-events"');
  });

  it("strips comments before finding the end of the union", () => {
    // Runs the REAL parse, so removing the comment-stripping line fails here.
    // A comment inside the union ends in a semicolon ("...ships to move;"),
    // which truncated the first version of this parse at 22 of 33 events.
    const parsed = unionEvents();
    expect(parsed.length).toBeGreaterThanOrEqual(30);
    for (const e of [
      "plan_setup_started",
      "plan_generate_failed",
      "plan_preview_failed",
      "plan_save_tapped",
      "plan_save_succeeded",
      "plan_save_failed",
      "explore_filter_applied",
      "card_dismissed",
      "feed_end_reached",
      "near_you_result",
      "together_join_denied",
      "together_room_expired",
      "together_host_handoff",
    ]) {
      expect(parsed).toContain(e);
    }
  });

  it("fails loudly rather than checking a truncated list", () => {
    // The guard lives in the shared module now, which is the point: one
    // implementation, used by the script and exercised by this file.
    expect(events).toMatch(/implausible|refuses to check/i);
    expect(events).toContain("throw new Error");
  });

  it("still hard-fails on a required event that never fired", () => {
    expect(verify).toContain("process.exit(1)");
  });
});

describe("provisioning is idempotent, which depends on unique names", () => {
  const dashboardNames = [...provision.matchAll(/^\s{4}name: "([^"]+)"/gm)].map(
    (m) => m[1],
  );
  const insightNames = [...provision.matchAll(/^\s{8}name: "([^"]+)"/gm)].map(
    (m) => m[1],
  );

  it("declares exactly 6 dashboards and 26 insights", () => {
    expect(dashboardNames).toHaveLength(6);
    expect(insightNames).toHaveLength(26);
  });

  it("has no duplicate dashboard names", () => {
    expect(new Set(dashboardNames).size).toBe(dashboardNames.length);
  });

  it("has no duplicate insight names", () => {
    // Matching is by name across the whole project, so two insights sharing a
    // name would make the second run update the first and then report a
    // creation that never happened.
    expect(new Set(insightNames).size).toBe(insightNames.length);
  });

  it("looks a name up before creating, on both resources", () => {
    expect(provision).toContain("findByName");
    expect(provision).toContain('"dashboards"');
    expect(provision).toContain('"insights"');
    // A run that writes nothing is a failure, not a quiet success.
    expect(provision).toContain("process.exit(1)");
  });
});

describe("fl_probe_manual can never reach a dashboard", () => {
  // One test event sits in the production project from proving the capture
  // endpoint was reachable during the 2026-07-29 investigation. It must not be
  // counted anywhere.
  const hogqlQueries = [...provision.matchAll(/`SELECT[\s\S]*?`/g)].map(
    (m) => m[0],
  );

  it("sees EVERY HogQL query, not just the ones its regex happens to match", () => {
    // A query written in a shape the regex misses would be silently exempted
    // from the scoping check below. Tie the count to the table() call sites.
    // `function table(` is the declaration, not a call site. Excluding it was
    // the first thing this assertion caught, which is a fair advertisement for
    // tying a positive control to a real count instead of to "greater than 0".
    const tableCalls = [...provision.matchAll(/(?<!function )\btable\(/g)]
      .length;
    expect(tableCalls).toBeGreaterThan(0); // positive control
    expect(hogqlQueries.length).toBe(tableCalls);
  });

  it("scopes every HogQL query to explicit event names", () => {
    // Every query either filters `event = '...'` / `event IN (...)`, or uses
    // countIf(event = '...') per column. Either way an event nobody named
    // cannot be swept in.
    for (const q of hogqlQueries) {
      const named = /event\s*=\s*'/.test(q) || /event\s+IN\s*\(/i.test(q);
      expect(named).toBe(true);
    }
  });

  it("never names fl_probe_manual anywhere in an insight", () => {
    expect(provision).not.toContain("fl_probe_manual");
  });

  it("names no event that the union does not declare", () => {
    // Catches a typo'd or renamed event before it becomes an insight that reads
    // zero forever and gets misdiagnosed as a product signal.
    const known = new Set([
      ...unionEvents(),
      // Autocaptured / built-in, not declared in the app's union.
      "$pageview",
      "$exception",
      "$autocapture",
    ]);
    const referenced = new Set(
      [...provision.matchAll(/event\s*=\s*'([^']+)'/g)].map((m) => m[1]),
    );
    for (const m of provision.matchAll(/event:\s*"([^"]+)"/g)) {
      referenced.add(m[1]);
    }
    for (const e of referenced) expect(known).toContain(e);
  });
});
