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
    const referenced = new Set<string>();

    // (a) HogQL equality: `event = 'venue_save'`
    for (const m of provision.matchAll(/event\s*=\s*'([^']+)'/g)) {
      referenced.add(m[1]);
    }
    // (b) HogQL membership: `event IN ('a', 'b')`. This was missing, so a typo
    // inside an IN list shipped green.
    for (const m of provision.matchAll(/event\s+IN\s*\(([^)]*)\)/gi)) {
      for (const q of m[1].matchAll(/'([^']+)'/g)) referenced.add(q[1]);
    }
    // (c) 🧨 THE 18 INSIGHTS THIS GUARD USED TO MISS ENTIRELY. It looked for
    // `event: "..."`, of which this file contains ZERO: series() builds the
    // node with ES shorthand (`{ kind: "EventsNode", event, name: event }`),
    // and the names live in the array literals passed to trend()/funnel().
    // So every Trends and Funnels insight was exempt from the check that is
    // supposed to stop a renamed event becoming a panel that reads zero
    // forever and gets misdiagnosed as a product signal.
    for (const m of provision.matchAll(
      /(?:trend|funnel)\(\s*\[([\s\S]*?)\]/g,
    )) {
      for (const q of m[1].matchAll(/"([^"]+)"/g)) referenced.add(q[1]);
    }

    // Positive control tied to a real floor, not to "> 0": an empty or
    // near-empty match set is the failure mode being fixed, and it would
    // otherwise pass this test in silence.
    expect(referenced.size).toBeGreaterThanOrEqual(15);
    // And specifically prove each source found something.
    expect(referenced).toContain("venue_reserve_click"); // (a)
    expect(referenced).toContain("plan_reshuffle"); // (b)
    expect(referenced).toContain("plan_generate"); // (c)

    for (const e of referenced) expect(known).toContain(e);
  });
});

describe("every insight is scoped to real production traffic", () => {
  // 🧨 WHY THIS EXISTS. One PostHog project, and NEXT_PUBLIC_POSTHOG_KEY ships
  // to the browser in dev, preview and production alike. Until the app-side
  // gate landed, the dev server, every preview deployment and every deliberate
  // probe filed into the same funnels these dashboards read. The app gate stops
  // NEW traffic; it cannot retract the stored history, and every insight here
  // reads a 30-to-90-day window.

  const hogql = [...provision.matchAll(/`SELECT[\s\S]*?`/g)].map((m) => m[0]);

  it("puts the host predicate in EVERY HogQL query", () => {
    const tableCalls = [...provision.matchAll(/(?<!function )\btable\(/g)]
      .length;
    expect(tableCalls).toBeGreaterThan(0); // positive control
    expect(hogql.length).toBe(tableCalls); // and we see all of them
    for (const q of hogql) {
      expect(q).toContain("${PROD_ONLY_SQL}");
    }
  });

  it("puts a property filter on EVERY trend and funnel", () => {
    // Counted, not spot-checked: a builder that stopped applying it would
    // otherwise pass as long as one other builder still did.
    const builders = [
      ...provision.matchAll(/kind: "(TrendsQuery|FunnelsQuery)"/g),
    ].length;
    const filtered = [...provision.matchAll(/properties: prodOnly\(\)/g)]
      .length;
    expect(builders).toBeGreaterThan(0); // positive control
    expect(filtered).toBe(builders);
  });

  it("defines the hosts ONCE, shared with the verifier", () => {
    // 🧨 The provisioner and the verifier must not each carry their own copy.
    // While only the dashboards filtered, `pnpm posthog:verify` could report an
    // event "firing" on localhost traffic that every panel discards, and the
    // documented Dashboard 5 procedure says to rewrite panels once the verifier
    // shows arrival. That gate would have passed on data the panels throw away.
    expect(events).toMatch(/export const PROD_HOSTS/);
    expect(events).toMatch(/export const PROD_ONLY_SQL/);
    expect(provision).toMatch(/import[\s\S]{0,120}from "\.\/posthog-events"/);
    expect(verify).toMatch(/import[\s\S]{0,160}PROD_ONLY_SQL/);
    // Neither may redeclare it locally.
    expect(provision).not.toMatch(/const PROD_HOSTS\s*=/);
    expect(verify).not.toMatch(/const PROD_HOSTS\s*=/);
  });

  it("is an allowlist of production hosts, not a denylist of test ones", () => {
    // Same reasoning as the app-side gate: a synthetic source nobody predicted
    // is excluded by default rather than included until somebody notices.
    const code = events
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).toMatch(/PROD_HOSTS\s*=\s*\[[^\]]*funldn\.com/);
    expect(code).not.toMatch(/["'`]localhost["'`]/);
    expect(code).not.toMatch(/vercel\.app/);
    expect(code).not.toMatch(/NOT\s+IN|!=\s*'localhost'/i);
  });

  it("decides the verifier's pass/fail on PRODUCTION counts", () => {
    // Printing both columns is not enough: the gate has to be the prod one.
    expect(verify).toMatch(/countIf\(\$\{PROD_ONLY_SQL\}\)/);
    expect(verify).toMatch(/if \(!row\[1\]\) dead\.push\(e\)/);
  });

  // The tooling's allowlist, parsed once from the shared module and asserted
  // two ways below.
  const dashHosts = [
    ...(events.match(/PROD_HOSTS\s*=\s*\[[^\]]*\]/)?.[0] ?? "").matchAll(
      /"([^"]+)"/g,
    ),
  ].map((m) => m[1]);

  it("names exactly the two production hosts", () => {
    expect([...dashHosts].sort()).toEqual(["funldn.com", "www.funldn.com"]);
  });

  it("agrees with the app-side gate, once that gate is on main", () => {
    // Two allowlists that drift are worse than one: the app would keep sending
    // from a host the dashboards silently ignore, so the funnels would read
    // zero while every other signal looked healthy.
    //
    // This was DORMANT while the app-side gate sat in a different PR: with
    // nothing to compare against, it took an early return. PR #192 is on main
    // now, so the dormancy branch is gone and the constant is REQUIRED. A test
    // that can silently decline to run is the failure this repo keeps paying
    // for, and leaving the branch in "just in case" is how it becomes permanent.
    //
    // Searched across the plausible homes rather than one hardcoded path: the
    // constant could reasonably have landed in analytics-keys.ts or the gate
    // component, and pinning a single file would have made a MOVE look exactly
    // like a deletion, silently.
    const CANDIDATES = [
      "lib/analytics.ts",
      "lib/analytics-keys.ts",
      "components/analytics-gate.tsx",
    ];
    let decl: string | undefined;
    let foundIn = "";
    for (const rel of CANDIDATES) {
      const body = readFileSync(
        fileURLToPath(new URL(`../../${rel}`, import.meta.url)),
        "utf8",
      );
      const m = body.match(/PRODUCTION_HOSTS\s*=[^;]*;/)?.[0];
      if (m) {
        decl = m;
        foundIn = rel;
        break;
      }
    }
    expect(
      decl,
      `PRODUCTION_HOSTS was not found in any of ${CANDIDATES.join(", ")}. ` +
        "Either the app-side gate was removed (in which case dev and preview " +
        "are reporting to production again) or it moved somewhere this test " +
        "does not look. Both need a human.",
    ).toBeTruthy();
    expect(foundIn).toBeTruthy();

    const appHosts = [...decl!.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(appHosts.length).toBeGreaterThan(0); // positive control
    expect([...dashHosts].sort()).toEqual([...appHosts].sort());
  });
});

describe("descriptions fit what PostHog accepts", () => {
  it("keeps every description at or under 400 characters", () => {
    // 🧨 PostHog rejects a longer description with a 400, and the FIRST real
    // provisioning run died part-way through on exactly this, after creating
    // two dashboards. It was survivable only because provisioning is
    // idempotent. Nothing checked it until now, and the longest description is
    // already close to the ceiling.
    const descriptions = [
      ...provision.matchAll(/description:\s*\n?\s*"((?:[^"\\]|\\.)*)"/g),
    ].map((m) => m[1]);
    expect(descriptions.length).toBeGreaterThanOrEqual(26); // positive control
    for (const d of descriptions) {
      expect(
        d.length,
        `description over the limit: ${d.slice(0, 60)}...`,
      ).toBeLessThanOrEqual(400);
    }
  });
});

describe("the deprecated plan_save cannot quietly flatline a funnel", () => {
  it("stops referencing plan_save before its 2026-09-30 sunset", () => {
    // 🧨 A DATED TRIPWIRE, on purpose. lib/analytics.ts and the event
    // dictionary both say plan_save is dual-emitted only until 2026-09-30 and
    // that new dashboards must use plan_save_succeeded. Three insights key on
    // it, including the bottom step of both dashboard-1 funnels. On the sunset
    // date those panels go to zero and present as a flat line in exactly the
    // charts used to decide navigation and landing.
    //
    // This repo's documented failure mode is automation going QUIET, so the
    // deadline gets a test rather than a comment. Migrating is not blocked on
    // anything: plan_save_succeeded is already emitted alongside it.
    const SUNSET = Date.parse("2026-09-30T00:00:00Z");
    const stillUsed = /["'`]plan_save["'`]|'plan_save'/.test(provision);
    if (Date.now() >= SUNSET && stillUsed) {
      throw new Error(
        "plan_save reached its 2026-09-30 sunset and is still referenced in " +
          "posthog-provision-dashboards.ts. Switch those insights to " +
          "plan_save_succeeded and re-provision, or the funnels read zero.",
      );
    }
    // Positive control: if the reference disappears by other means, this test
    // has served its purpose and can go. Until then it must be watching
    // something real.
    expect(typeof stillUsed).toBe("boolean");
  });
});
