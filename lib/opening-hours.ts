// Normalize Google Places `regularOpeningHours` into our compact, timezone-
// stable OpeningHours shape (day 0–6 = JS Date.getDay(); null close = 24h).
// Shared by the three venue-ingest scripts.

import type { OpeningHours } from "@/lib/types";

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
