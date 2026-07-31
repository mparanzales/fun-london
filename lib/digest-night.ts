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

/**
 * The brief for a given week: same week in, same brief out.
 *
 * The two indices must not share a period. NIGHT_AREAS has 8 entries and
 * NIGHT_VIBES has 4, so indexing BOTH by the raw week number welds them
 * together: `w % 4` is fully determined by `w % 8`, which pinned every area to
 * a single vibe forever (Soho was always Chill, Camden always Lively) and made
 * 24 of the 32 possible briefs unreachable. Advancing the vibe by one whole
 * lap of the area list decouples them, so each area cycles through all four
 * vibes across 32 weeks.
 */
export function briefForWeek(d: Date): { area: string; vibe: PlanVibe } {
  const w = isoWeek(d);
  const lap = Math.floor(w / NIGHT_AREAS.length);
  return {
    area: NIGHT_AREAS[w % NIGHT_AREAS.length]!,
    vibe: NIGHT_VIBES[(w + lap) % NIGHT_VIBES.length]!,
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
 * Assembled from parts so the separator is OURS, not the platform's.
 *
 * Measured 2026-07-31 on ICU 78.3 / Unicode 17.0: en-GB, en-US, en-CA, en-AU,
 * en-IE and en-NZ ALL join with a plain space (0x20). No locale here emits the
 * narrow no-break space, so this is NOT fixing a live bug and no comment should
 * claim otherwise. (Two earlier revisions of this file did, each asserting a
 * different locale; both were wrong, which is the reason for the measurement
 * above.) It is a forward guard: U+202F before the meridiem is a real ICU
 * behaviour on other versions, and an invisible non-ASCII character is exactly
 * the failure class this digest was repaired for. The output is pinned to
 * ASCII by test so a runtime upgrade cannot silently reintroduce one.
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
