// Plan My Night engine.
//
// Turns (area, vibe, budget) into a real 3-stop itinerary: Start (eat) →
// Then (drinks) → Finish (night). Unlike the old prototype port, this
// actually USES vibe and budget, scores venues for fit, and computes real
// walk times between stops from their coordinates.
//
// Pure + deterministic: same inputs (+ same `offset`) always yield the
// same plan, so "Try another combination" just bumps `offset`.

import type { Venue, VenueType } from "./types";

export type PlanVibe = "Chill" | "Lively" | "Fancy" | "Unique";
export type PlanBudget = "£" | "££" | "Any";
export type PlanRole = "Start" | "Then" | "Finish";

export type PlanStep = {
  venue: Venue;
  role: PlanRole;
  dwellMins: number; // time spent at this stop
  walkToNextMins: number | null; // walk to the next stop (null on the last)
};

export type Plan = {
  area: string;
  vibe: PlanVibe;
  budget: PlanBudget;
  steps: PlanStep[];
  totalMins: number; // dwell + walking across the whole night
};

// ── Budget ───────────────────────────────────────────────────────────────

const PRICE_RANK: Record<string, number> = {
  Free: 0,
  "£": 1,
  "££": 2,
  "£££": 3,
};

export function withinBudget(price: string, budget: PlanBudget): boolean {
  if (budget === "Any") return true;
  const cap = budget === "£" ? 1 : 2; // "£" → Free/£ · "££" → up to ££
  return (PRICE_RANK[price] ?? 2) <= cap;
}

// ── Opening hours ──────────────────────────────────────────────────────────

const WEEK_MINS = 7 * 24 * 60;

function minuteOfWeek(day: number, hour: number, minute: number): number {
  return day * 24 * 60 + hour * 60 + minute;
}

// Is the venue open at `when`? Fail-OPEN when we have no hours yet (null) so
// the plan doesn't empty out before the backfill cron has populated them.
// Handles periods that wrap past midnight and across the week boundary.
export function isOpenAt(v: Venue, when: Date): boolean {
  const oh = v.openingHours;
  if (!oh || !oh.periods || oh.periods.length === 0) return true;
  const now = minuteOfWeek(when.getDay(), when.getHours(), when.getMinutes());
  for (const p of oh.periods) {
    if (p.close == null) return true; // open 24h
    const open = minuteOfWeek(p.open.day, p.open.hour, p.open.minute);
    let close = minuteOfWeek(p.close.day, p.close.hour, p.close.minute);
    if (close <= open) close += WEEK_MINS; // wraps past midnight / week end
    if (
      (now >= open && now < close) ||
      (now + WEEK_MINS >= open && now + WEEK_MINS < close)
    ) {
      return true;
    }
  }
  return false;
}

// ── Roles ────────────────────────────────────────────────────────────────

const EAT_TYPES: VenueType[] = ["Restaurant"];
const EAT_FALLBACK: VenueType[] = ["Cafe", "Wine Bar"];
const DRINK_TYPES: VenueType[] = ["Bar", "Wine Bar", "Pub", "Listening Bar"];
const FINISH_TYPES: VenueType[] = ["Live Music", "Listening Bar", "Bar"];

function roleMatches(v: Venue, role: PlanRole): boolean {
  switch (role) {
    case "Start":
      return EAT_TYPES.includes(v.type) || EAT_FALLBACK.includes(v.type);
    case "Then":
      return DRINK_TYPES.includes(v.type);
    case "Finish":
      return FINISH_TYPES.includes(v.type) || v.timeOfDay === "Night";
  }
}

const DWELL: Record<PlanRole, number> = { Start: 75, Then: 60, Finish: 60 };

// ── Vibe scoring ─────────────────────────────────────────────────────────

function tagHit(v: Venue, keywords: string[]): number {
  const hay = [v.vibe, ...v.vibeTags].join(" ").toLowerCase();
  return keywords.some((k) => hay.includes(k)) ? 1 : 0;
}

function vibeScore(v: Venue, vibe: PlanVibe): number {
  let s = 0;
  switch (vibe) {
    case "Chill":
      if (["Cafe", "Wine Bar"].includes(v.type)) s += 2;
      if (v.timeOfDay !== "Night") s += 1;
      s +=
        2 *
        tagHit(v, [
          "cosy",
          "cozy",
          "relaxed",
          "calm",
          "quiet",
          "intimate",
          "laid-back",
        ]);
      break;
    case "Lively":
      if (["Bar", "Pub", "Live Music"].includes(v.type)) s += 2;
      if (v.timeOfDay === "Night") s += 1;
      s +=
        2 *
        tagHit(v, [
          "buzzy",
          "lively",
          "loud",
          "party",
          "vibrant",
          "packed",
          "energetic",
        ]);
      break;
    case "Fancy":
      if (["Restaurant", "Wine Bar"].includes(v.type)) s += 1;
      s += PRICE_RANK[v.price] ?? 2; // pricier reads fancier
      s +=
        2 *
        tagHit(v, [
          "elegant",
          "refined",
          "romantic",
          "date",
          "upscale",
          "smart",
          "special",
        ]);
      break;
    case "Unique":
      if (["Listening Bar", "Live Music", "Culture", "Market"].includes(v.type))
        s += 2;
      s +=
        2 *
        tagHit(v, [
          "unique",
          "hidden",
          "quirky",
          "unusual",
          "only",
          "one-of",
          "cult",
        ]);
      break;
  }
  s += (v.rating - 4) * 1.5; // gentle quality nudge
  return s;
}

// ── Distance / walk time ─────────────────────────────────────────────────

function haversineKm(a: Venue, b: Venue): number | null {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) {
    return null;
  }
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// ~5 km/h walking → 12 min/km. Floor at 2 min so adjacent venues still read
// as a short hop. Falls back to a flat ~8 min when coordinates are missing.
function walkMins(a: Venue, b: Venue): number {
  const km = haversineKm(a, b);
  if (km == null) return 8;
  return Math.max(2, Math.round(km * 12));
}

// ── Plan builder ─────────────────────────────────────────────────────────

function pick(
  pool: Venue[],
  role: PlanRole,
  vibe: PlanVibe,
  used: Set<string>,
  offset: number,
): Venue | null {
  const ranked = pool
    .filter((v) => !used.has(v.id) && roleMatches(v, role))
    .sort((a, b) => vibeScore(b, vibe) - vibeScore(a, vibe));
  if (ranked.length === 0) return null;
  // offset rotates through the ranked list for "Try another", starting at
  // the best fit (offset 0).
  return ranked[offset % ranked.length];
}

// Any best-scoring unused venue, ignoring role — used to backfill a slot
// when an area is too thin to satisfy a role cleanly.
function pickAny(
  pool: Venue[],
  vibe: PlanVibe,
  used: Set<string>,
  offset: number,
): Venue | null {
  const ranked = pool
    .filter((v) => !used.has(v.id))
    .sort((a, b) => vibeScore(b, vibe) - vibeScore(a, vibe));
  if (ranked.length === 0) return null;
  return ranked[offset % ranked.length];
}

export function computePlan(
  venues: Venue[],
  opts: { area: string; vibe: PlanVibe; budget: PlanBudget; offset?: number },
): Plan {
  const { area, vibe, budget, offset = 0 } = opts;

  // Prefer venues in the chosen area + budget; widen gracefully if too thin.
  const inArea = venues.filter(
    (v) => v.neighbourhood === area && withinBudget(v.price, budget),
  );
  const inBudget = venues.filter((v) => withinBudget(v.price, budget));
  let pool = inArea.length >= 3 ? inArea : inBudget;
  if (pool.length < 3) pool = venues; // last resort: ignore budget too

  const used = new Set<string>();
  const roles: PlanRole[] = ["Start", "Then", "Finish"];
  const chosen: Venue[] = [];

  for (const role of roles) {
    const v =
      pick(pool, role, vibe, used, offset) ?? pickAny(pool, vibe, used, offset);
    if (v) {
      used.add(v.id);
      chosen.push(v);
    }
  }

  const steps: PlanStep[] = chosen.map((venue, i) => {
    const next = chosen[i + 1];
    return {
      venue,
      role: roles[i],
      dwellMins: DWELL[roles[i]],
      walkToNextMins: next ? walkMins(venue, next) : null,
    };
  });

  const totalMins = steps.reduce(
    (sum, s) => sum + s.dwellMins + (s.walkToNextMins ?? 0),
    0,
  );

  return { area, vibe, budget, steps, totalMins };
}

// One-line rationale for the saved-plan record + the result header.
export function planRationale(plan: Plan): string {
  const names = plan.steps.map((s) => s.venue.name);
  return `A ${plan.vibe.toLowerCase()} ${plan.area} night: ${names.join(" → ")}.`;
}
