// The AnalyticsEvent union, read from lib/analytics.ts at runtime.
//
// Its own module for one reason: the verifier and the test that guards the
// verifier must run the SAME code. When the test kept a private copy of this
// parse, deleting the comment-stripping line from the real one would have made
// `--all` silently check 22 of 33 events while all 12 guard tests stayed green.
// A guard that re-implements the thing it guards is not guarding anything.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Autocaptured or built in, so not declared in the app's union but worth
// checking for arrival all the same.
export const BUILTIN_EVENTS = ["$pageview", "$exception"] as const;

// ── Which traffic counts as real ─────────────────────────────────────────
//
// 🧨 ONE DEFINITION, USED BY BOTH TOOLS, and it lives here because the two of
// them disagreeing is a specific and nasty failure. There is a single PostHog
// project and NEXT_PUBLIC_POSTHOG_KEY ships to the browser in dev, preview and
// production alike, so localhost reloads, preview click-throughs and deliberate
// probes all landed in it. Measured on 2026-07-31 over 90 days: `venue_save`
// was 42 events, of which 35 were production. 17% of that funnel was us.
//
// When only the dashboards filtered, `pnpm posthog:verify` could report an
// event "firing" on the strength of localhost traffic while the corresponding
// panel read zero — and the documented Dashboard-5 procedure says to rewrite
// panels once the verifier shows arrival. That gate would have been passing on
// data the panels discard.
//
// An ALLOWLIST, matching PRODUCTION_HOSTS in lib/analytics.ts: a synthetic
// source nobody predicted is excluded by default rather than counted until
// somebody notices.
export const PROD_HOSTS = ["funldn.com", "www.funldn.com"] as const;

/** The same predicate as HogQL text, for queries that are written as SQL. */
export const PROD_ONLY_SQL = `properties.$host IN (${PROD_HOSTS.map(
  (h) => `'${h}'`,
).join(", ")})`;

/** The same predicate as a PostHog PropertyGroupFilter, for Trends/Funnels. */
export function prodOnlyFilter(): Record<string, unknown> {
  return {
    type: "AND",
    values: [
      {
        type: "AND",
        values: [
          {
            key: "$host",
            type: "event",
            operator: "exact",
            value: [...PROD_HOSTS],
          },
        ],
      },
    ],
  };
}

/**
 * Every event name in the AnalyticsEvent union.
 *
 * Throws rather than returning a short list. A verifier that quietly checks a
 * subset is the green tick over the nine-week dead digest wearing a new hat.
 */
export function readUnionEvents(): string[] {
  const src = readFileSync(
    fileURLToPath(new URL("../lib/analytics.ts", import.meta.url)),
    "utf8",
  );
  const start = src.indexOf("export type AnalyticsEvent =");
  if (start === -1) {
    throw new Error(
      "Could not find the AnalyticsEvent union in lib/analytics.ts. " +
        "The verifier refuses to check a list it cannot derive.",
    );
  }
  // Strip comments BEFORE looking for the terminating semicolon. The union is
  // heavily commented and one of those comments ends in a semicolon
  // ("...anon /plan ships to move;"), which truncated the first version of this
  // parse at 22 of 33 events. Silently. Exactly the failure this function was
  // written to remove, reproduced inside the fix for it.
  const body = src
    .slice(start)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  const end = body.indexOf(";");
  const names = [...body.slice(0, end).matchAll(/\|\s*"([^"]+)"/g)].map(
    (m) => m[1],
  );

  // A parse that silently returns almost nothing is the failure mode this
  // module exists to remove, so make it loud. The union has been well above 20
  // members since PR #189; 10 is a floor no real refactor would cross.
  if (names.length < 10) {
    throw new Error(
      `Parsed only ${names.length} events from the AnalyticsEvent union. ` +
        "That is implausible, so the parse is broken. Fix it rather than " +
        "letting the verifier check a truncated list.",
    );
  }
  return names;
}
