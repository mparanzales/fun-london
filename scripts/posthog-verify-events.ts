// ─────────────────────────────────────────────────────────────────────────
// Does the funnel actually FIRE in production?
//
// WHY THIS EXISTS: an event being present in lib/analytics.ts and wired to a
// call site proves only that the code compiles. It does not prove a single
// event ever reached PostHog. The repo has been burned by exactly this gap
// before (a green tick over a job that no-opped for nine weeks), so this
// script refuses to answer "did it run?" and answers "what number changed?".
//
// It asks PostHog for a real count per event and FAILS LOUDLY (exit 1) when a
// required event has zero. Zero is not "quiet success", it is a broken funnel.
//
// Usage:
//   pnpm posthog:verify              # last 30 days
//   pnpm posthog:verify -- --days=90
//   pnpm posthog:verify -- --all     # every event, READ FROM the union at runtime
//
// Needs a personal API key with the READ scopes only:
//   query:read   (this script)      + project:read
// ─────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hogql, resolveProjectId, API_HOST } from "./posthog-api";

// The four the cofounders asked to see proven. Zero on any of these is a
// build failure, not a data point.
const REQUIRED = [
  "venue_save",
  "venue_unsave",
  "together_room_create",
  "together_room_join",
] as const;

// Every OTHER event, read from the union in lib/analytics.ts at runtime.
//
// 🧨 This list used to be maintained BY HAND, with a comment saying so. By the
// time PR #189 merged it was missing 13 of the 33 events in the union, so
// `--all` quietly reported on 20 and said nothing about the rest. A verifier
// that silently checks less than it claims is worse than no verifier: it is the
// green tick over the nine-week dead digest, again.
//
// So it is derived. The union is a plain TypeScript string union, which is
// trivially parseable and is the actual source of truth.
function readUnionEvents(): string[] {
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
  // ("...anon /plan ships to move;"), which truncated the parse at 22 of 33
  // events on the first attempt. Silently. Exactly the failure this function
  // was written to remove, reproduced inside the fix for it.
  const body = src
    .slice(start)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  const end = body.indexOf(";");
  const names = [...body.slice(0, end).matchAll(/\|\s*"([^"]+)"/g)].map(
    (m) => m[1],
  );

  // A parse that silently returns almost nothing is the failure mode this
  // change exists to remove, so make it loud. The union has been well above 20
  // members since #189; 10 is a floor no real refactor would cross.
  if (names.length < 10) {
    throw new Error(
      `Parsed only ${names.length} events from the AnalyticsEvent union. ` +
        "That is implausible, so the parse is broken. Fix it rather than " +
        "letting the verifier check a truncated list.",
    );
  }
  return names;
}

const daysArg = process.argv.find((a) => a.startsWith("--days="));
const DAYS = daysArg ? Number(daysArg.split("=")[1]) : 30;
const ALL = process.argv.includes("--all");

type Row = [string, number, number, string];

async function main(): Promise<void> {
  const projectId = await resolveProjectId();
  // Derived, never hand-listed. `$pageview` is autocaptured rather than
  // declared in the union, so it is added explicitly.
  const wanted = ALL
    ? [
        ...new Set([
          ...REQUIRED,
          "$pageview",
          ...readUnionEvents().filter(
            (e) => !(REQUIRED as readonly string[]).includes(e),
          ),
        ]),
      ]
    : [...REQUIRED];
  const list = wanted.map((e) => `'${e}'`).join(", ");

  console.log(`PostHog project ${projectId} at ${API_HOST}`);
  console.log(`Window: last ${DAYS} days\n`);

  // One query, not one per event: cheaper, and a single failure surface.
  const { results } = await hogql<Row>(
    projectId,
    `SELECT event,
            count() AS events,
            count(DISTINCT distinct_id) AS people,
            max(timestamp) AS last_seen
       FROM events
      WHERE timestamp > now() - INTERVAL ${DAYS} DAY
        AND event IN (${list})
      GROUP BY event
      ORDER BY events DESC`,
  );

  const seen = new Map<string, Row>();
  for (const r of results) seen.set(r[0], r);

  const pad = (s: string, n: number) => s.padEnd(n);
  console.log(
    pad("event", 24) + pad("events", 10) + pad("people", 9) + "last seen",
  );
  console.log("-".repeat(70));

  const dead: string[] = [];
  for (const e of wanted) {
    const row = seen.get(e);
    const required = (REQUIRED as readonly string[]).includes(e);
    if (!row) {
      dead.push(e);
      console.log(
        pad(e, 24) +
          pad("0", 10) +
          pad("0", 9) +
          (required ? "NEVER  <-- REQUIRED" : "never"),
      );
      continue;
    }
    console.log(
      pad(e, 24) +
        pad(String(row[1]), 10) +
        pad(String(row[2]), 9) +
        String(row[3]).slice(0, 19),
    );
  }

  const deadRequired = dead.filter((e) =>
    (REQUIRED as readonly string[]).includes(e),
  );

  console.log("\nscoreboard");
  console.log(`  events_checked:      ${wanted.length}`);
  console.log(`  events_with_data:    ${seen.size}`);
  console.log(`  required_checked:    ${REQUIRED.length}`);
  console.log(
    `  required_firing:     ${REQUIRED.length - deadRequired.length}`,
  );

  if (deadRequired.length) {
    console.error(
      `\nFAIL: ${deadRequired.length} required event(s) have never fired in ` +
        `the last ${DAYS} days: ${deadRequired.join(", ")}\n` +
        "That is a broken funnel, not an empty one. Check, in this order:\n" +
        "  1. is the surface reachable at all (together rooms need sign-in)\n" +
        "  2. did the visitor decline in the consent banner (fl.consent.v1)\n" +
        "  3. is NEXT_PUBLIC_POSTHOG_KEY set on the Vercel environment\n" +
        "  4. an ad blocker on the test browser eats eu.i.posthog.com",
    );
    process.exit(1);
  }

  console.log("\nOK: every required event is firing.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
