// Pure helpers for the weekly digest's "night of the week".
//
// WHY THIS FILE EXISTS. These lived inside scripts/send-weekly-digest.ts,
// which runs `dotenv.config()` and `process.exit(1)` at module scope: importing
// it from a test kills the test runner. So the centrepiece of the email, the
// only section that carries real product logic, shipped with ZERO coverage.
// Everything here is pure (no env, no network, no Supabase), so it is testable,
// and the script imports it rather than owning it.
//
// Nothing here decides content. Picking the brief is deliberate and boring:
// rotate by ISO week so each digest draws a different night and two sends in
// the same week draw the SAME night (re-running a cron must be idempotent).

import type { PlanVibe } from "@/lib/plan-engine";

export const NIGHT_AREAS = [
  "Soho",
  "Shoreditch",
  "Fitzrovia",
  "Covent Garden",
  "Islington",
  "Camden",
  "Borough",
  "Notting Hill",
];

export const NIGHT_VIBES: PlanVibe[] = ["Chill", "Lively", "Unique", "Fancy"];

/** ISO-8601 week number. Week 1 is the week containing the first Thursday. */
export function isoWeek(d: Date): number {
  const t = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - y0.getTime()) / 86400000 + 1) / 7);
}

/** The brief for a given week: same week in, same brief out. */
export function briefForWeek(d: Date): { area: string; vibe: PlanVibe } {
  const w = isoWeek(d);
  return {
    area: NIGHT_AREAS[w % NIGHT_AREAS.length]!,
    vibe: NIGHT_VIBES[w % NIGHT_VIBES.length]!,
  };
}

/**
 * A Date whose Europe/London wall clock reads `hour`:00 on the given day.
 *
 * Derived from Intl rather than a hardcoded offset, so it is correct on both
 * sides of the BST/GMT switch. A fixed +1 would silently put every arrival
 * time an hour out for five months of the year.
 */
export function londonAt(y: number, m: number, d: number, hour: number): Date {
  const guess = new Date(Date.UTC(y, m, d, hour));
  const wall = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      hour: "numeric",
      hour12: false,
    }).format(guess),
  );
  return new Date(guess.getTime() + (hour - wall) * 3600000);
}

/** 7pm London on the next Friday. Never today, so the night is always ahead. */
export function upcomingFriday19(now: Date = new Date()): Date {
  const day = now.getUTCDay();
  const add = (5 - day + 7) % 7 || 7;
  const f = new Date(now.getTime() + add * 86400000);
  return londonAt(f.getUTCFullYear(), f.getUTCMonth(), f.getUTCDate(), 19);
}

/**
 * "7:00 PM" in London time.
 *
 * Assembled from parts so the separator is OURS, not the locale's. Measured
 * 2026-07-31: en-GB currently joins with a plain space, but en-US and friends
 * use a narrow no-break space (U+202F) before the meridiem, and ICU has moved
 * this before. An invisible non-ASCII character is exactly the failure class
 * the digest was just repaired for, so the output is pinned to ASCII by test
 * rather than left to the platform's ICU version.
 */
export function fmtLondonTime(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("hour")}:${get("minute")} ${get("dayPeriod").toUpperCase()}`;
}
