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
