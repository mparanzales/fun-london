// Normalize Google Places `regularOpeningHours` into our compact, timezone-
// stable OpeningHours shape (day 0–6 = JS Date.getDay(); null close = 24h).
// Shared by the three venue-ingest scripts.

import type { OpeningHours, OpeningPoint } from "@/lib/types";

type GooglePoint = { day?: number; hour?: number; minute?: number };
type GooglePeriod = { open?: GooglePoint; close?: GooglePoint };
export type GoogleOpeningHours = {
  periods?: GooglePeriod[];
  weekdayDescriptions?: string[];
};

export function normalizeOpeningHours(
  g: GoogleOpeningHours | undefined | null,
): OpeningHours | null {
  if (!g || !Array.isArray(g.periods) || g.periods.length === 0) return null;
  const periods = g.periods
    .filter((p) => p.open && typeof p.open.day === "number")
    .map((p) => ({
      open: {
        day: p.open!.day ?? 0,
        hour: p.open!.hour ?? 0,
        minute: p.open!.minute ?? 0,
      },
      close:
        p.close && typeof p.close.day === "number"
          ? {
              day: p.close.day,
              hour: p.close.hour ?? 0,
              minute: p.close.minute ?? 0,
            }
          : null,
    }));
  if (periods.length === 0) return null;
  return { periods, weekdayDescriptions: g.weekdayDescriptions };
}

// ── Display-side: is a venue open right now? ────────────────────────────────
// Computed live in the browser from the structured `periods` — NOT from the
// localized `weekdayDescriptions` strings, which are display-only and fragile.
// All reasoning is in Europe/London wall-clock so it is correct regardless of
// the user's device timezone and across BST/GMT. Periods may wrap past
// midnight (close.day after open.day) and across the week boundary (Sat night
// → Sun morning); both are handled by working in "minutes since Sunday 00:00"
// on a circular 7-day week.

const WEEK_MINUTES = 7 * 24 * 60;

const DAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function pointToMinutes(p: OpeningPoint): number {
  return p.day * 1440 + p.hour * 60 + p.minute;
}

// Current Europe/London wall-clock as {day,hour,minute}, day 0=Sun…6=Sat
// (matching OpeningPoint.day / JS Date.getDay()). Derived from the absolute
// instant via Intl, so it tracks BST/GMT automatically.
export function londonWallClock(now: Date): {
  day: number;
  hour: number;
  minute: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/London",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const val = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = DAY_INDEX[val("weekday")] ?? 0;
  // Some engines render midnight as "24" under hour12:false — normalize to 0.
  let hour = parseInt(val("hour"), 10) % 24;
  if (Number.isNaN(hour)) hour = 0;
  const minute = parseInt(val("minute"), 10) || 0;
  return { day, hour, minute };
}

export type OpenState =
  | { status: "open"; closesAt: OpeningPoint | null } // closesAt null = open 24h
  | { status: "closed"; opensAt: OpeningPoint | null }
  | { status: "unknown" };

// The live open/closed state for the hours strip. `unknown` when we hold no
// structured periods (fall back to a plain "Hours" list in the UI).
export function getOpenState(
  hours: OpeningHours | null | undefined,
  now: Date,
): OpenState {
  if (!hours || !hours.periods || hours.periods.length === 0) {
    return { status: "unknown" };
  }
  const { day, hour, minute } = londonWallClock(now);
  const nowMin = day * 1440 + hour * 60 + minute;

  // Open right now? Check each period, accounting for midnight + week wrap.
  for (const p of hours.periods) {
    if (p.close === null) return { status: "open", closesAt: null }; // open 24h
    const openMin = pointToMinutes(p.open);
    let closeMin = pointToMinutes(p.close);
    if (closeMin <= openMin) closeMin += WEEK_MINUTES; // wraps past week end
    if (
      (nowMin >= openMin && nowMin < closeMin) ||
      (nowMin + WEEK_MINUTES >= openMin && nowMin + WEEK_MINUTES < closeMin)
    ) {
      return { status: "open", closesAt: p.close };
    }
  }

  // Closed → report the soonest upcoming opening (circular week).
  let bestDelta = Infinity;
  let opensAt: OpeningPoint | null = null;
  for (const p of hours.periods) {
    let delta = pointToMinutes(p.open) - nowMin;
    if (delta < 0) delta += WEEK_MINUTES;
    if (delta < bestDelta) {
      bestDelta = delta;
      opensAt = p.open;
    }
  }
  return { status: "closed", opensAt };
}

export function isOpenNow(
  hours: OpeningHours | null | undefined,
  now: Date,
): boolean {
  return getOpenState(hours, now).status === "open";
}
