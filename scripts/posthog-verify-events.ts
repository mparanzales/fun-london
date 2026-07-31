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

import { hogql, resolveProjectId, API_HOST } from "./posthog-api";
import {
  readUnionEvents,
  BUILTIN_EVENTS,
  PROD_ONLY_SQL,
} from "./posthog-events";

// The four the cofounders asked to see proven. Zero on any of these is a
// build failure, not a data point.
const REQUIRED = [
  "venue_save",
  "venue_unsave",
  "together_room_create",
  "together_room_join",
] as const;

const daysArg = process.argv.find((a) => a.startsWith("--days="));
const DAYS = daysArg ? Number(daysArg.split("=")[1]) : 30;
// A bad --days must not masquerade as a broken funnel. `--days=` yields 0, which
// makes the window match nothing and prints "never fired in the last 0 days"
// from a script whose whole purpose is to never report a false state.
if (!Number.isFinite(DAYS) || DAYS <= 0 || DAYS > 3650) {
  console.error(
    `--days must be a number between 1 and 3650, got "${daysArg?.split("=")[1] ?? ""}".`,
  );
  process.exit(1);
}
const ALL = process.argv.includes("--all");

// [event, production events, ALL events, production people, production last seen]
type Row = [string, number, number, number, string];

async function main(): Promise<void> {
  const projectId = await resolveProjectId();
  // Derived, never hand-listed. `$pageview` is autocaptured rather than
  // declared in the union, so it is added explicitly.
  const wanted = ALL
    ? [
        ...new Set([
          ...REQUIRED,
          ...BUILTIN_EVENTS,
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
  // 🧨 PRODUCTION AND TOTAL, SIDE BY SIDE, using the SAME predicate the
  // dashboards use. This counted everything, so it could report an event
  // "firing" on the strength of localhost and preview traffic that every panel
  // discards -- and the documented Dashboard 5 procedure says to rewrite panels
  // once this shows arrival. The pass/fail decision below is made on the
  // production column only; the total is printed so a gap is visible rather
  // than inferred.
  const { results } = await hogql<Row>(
    projectId,
    `SELECT event,
            countIf(${PROD_ONLY_SQL}) AS events,
            count() AS all_events,
            count(DISTINCT if(${PROD_ONLY_SQL}, distinct_id, NULL)) AS people,
            maxIf(timestamp, ${PROD_ONLY_SQL}) AS last_seen
       FROM events
      WHERE timestamp > now() - INTERVAL ${DAYS} DAY
        AND event IN (${list})
      GROUP BY event
      ORDER BY all_events DESC`,
  );

  const seen = new Map<string, Row>();
  for (const r of results) seen.set(r[0], r);

  const pad = (s: string, n: number) => s.padEnd(n);
  console.log(
    pad("event", 24) +
      pad("prod", 8) +
      pad("all", 8) +
      pad("people", 8) +
      "last seen (prod)",
  );
  console.log("-".repeat(78));

  const dead: string[] = [];
  for (const e of wanted) {
    const row = seen.get(e);
    const required = (REQUIRED as readonly string[]).includes(e);
    if (!row) {
      dead.push(e);
      console.log(
        pad(e, 24) +
          pad("0", 8) +
          pad("0", 8) +
          pad("0", 8) +
          (required ? "NEVER  <-- REQUIRED" : "never"),
      );
      continue;
    }
    // A row with zero PRODUCTION events counts as dead even when the total is
    // non-zero: it means the only traffic was ours.
    if (!row[1]) dead.push(e);
    console.log(
      pad(e, 24) +
        pad(String(row[1]), 8) +
        pad(String(row[2]), 8) +
        pad(String(row[3]), 8) +
        (row[1]
          ? String(row[4]).slice(0, 19)
          : required
            ? "NO PROD DATA  <-- REQUIRED"
            : "no prod data"),
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
