// The ENFORCEMENT POINT for the anonymous plan payload. Pure and importable
// by vitest (no server-only), guarded by lib/__tests__/plan-preview-guard.
//
// 🧨 THE RULE THIS FILE EXISTS TO HOLD: never return, spread or pick from the
// engine's Plan object into an anon payload. `Plan.steps[].venue` is a FULL
// engine Venue (vibeTags, openingHours, planNote) and `Plan.alternatives` is
// up to 8 more per stop — returning `plan` or `plan.steps` from the action
// leaks 3–27 moat-bearing venues in one serialization (2026-07-27 guardian
// gate, condition C1). Stops are rebuilt from the RAW service-role rows via
// mapVenuePreview — the same choke point every other anon surface uses — and
// then an EXPLICIT field pick. Fields are allow-listed, never spread.
//
// `isOpenNow` is consumed HERE (moat input → 1 bit out) and ships as a plain
// boolean; the hours themselves never serialize (guardian C9).

import type { Plan } from "@/lib/plan-engine";
import { planRationale } from "@/lib/plan-engine";
import { isOpenNow } from "@/lib/opening-hours";

// "11:01 pm" — same formatter as the signed-in result (plan-flow fmtTime).
function fmtArrive(d: Date): string {
  return d
    .toLocaleTimeString("en-GB", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "Europe/London",
    })
    .toLowerCase();
}
import { mapVenuePreview } from "@/lib/queries";
import type { VenueCardRow, VenuePlanRow } from "@/lib/queries";

export type AnonPlanStop = {
  slug: string;
  name: string;
  type: string;
  neighbourhood: string;
  price: string;
  rating: number;
  reviewCount: number;
  imgUrl: string;
  vibe: string;
  role: string;
  dwellMins: number;
  walkToNextMins: number | null;
  isOpenNow: boolean;
  // "7:45 pm" — estimated arrival, formatted SERVER-side. Moat judgement
  // (ux gate, 2026-07-28): derived ONLY from the user's own chosen start +
  // cumulative dwell + walk minutes — all data the anon client already
  // holds — NEVER from opening_hours. Keep it that way.
  arriveAtLabel: string | null;
};

export type AnonPlanPayload = {
  stops: AnonPlanStop[];
  rationale: string;
  area: string;
  daypart: "day" | "evening";
  totalMins: number;
};

export function toAnonPlanPayload(
  plan: Plan,
  rowsById: Map<string, VenuePlanRow>,
  now: Date,
): AnonPlanPayload | null {
  const stops: AnonPlanStop[] = [];
  for (const step of plan.steps) {
    const row = rowsById.get(step.venue.id);
    // A step whose raw row we can't find is dropped rather than built from
    // the engine venue — the engine object is the thing we must never ship.
    if (!row) continue;
    const v = mapVenuePreview(row as VenueCardRow);
    stops.push({
      slug: v.slug,
      name: v.name,
      type: v.type,
      neighbourhood: v.neighbourhood,
      price: v.price,
      rating: v.rating,
      reviewCount: v.reviewCount,
      imgUrl: v.imgUrl,
      vibe: v.vibe,
      role: step.role,
      dwellMins: step.dwellMins,
      walkToNextMins: step.walkToNextMins,
      isOpenNow: isOpenNow(step.venue.openingHours, step.arriveAt ?? now),
      arriveAtLabel: step.arriveAt ? fmtArrive(step.arriveAt) : null,
    });
  }
  if (stops.length === 0) return null;
  return {
    stops,
    // planRationale reads only stop names + the chosen vibe/area/daypart —
    // verified never to touch vibeTags (guardian gate). Pinned by the guard
    // test anyway, so a future "richer rationale" trips it.
    rationale: planRationale(plan),
    area: plan.area,
    daypart: plan.daypart,
    totalMins: plan.totalMins,
  };
}
