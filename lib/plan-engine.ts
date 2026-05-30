// Plan My Night engine.
//
// Turns (area, vibe, budget) into a real 3-stop itinerary: Start (eat) →
// Then (drinks) → Finish (night). Unlike the old prototype port, this
// actually USES vibe and budget, scores venues for fit, and computes real
// walk times between stops from their coordinates.
//
// Pure + deterministic: same inputs (+ same `offset`) always yield the
// same plan, so "Try another combination" just bumps `offset`.

import type { Venue, VenueType, Event } from "./types";
import { venueInArea, regionOf, type PlanArea } from "./regions";

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

// ── Plan Together v2 — proximity-first walkable group plan ───────────────────
//
// Host sets logistics (when/where/budget/group size); the group's yes/no
// swipes decide which stop-types to include. This builds a WALKABLE cluster
// of those stops, all OPEN at the meeting time, in the chosen area, within
// budget — picking each next stop NEAR the ones already chosen rather than
// measuring distance after the fact.

export type WalkableSettings = {
  area: PlanArea;
  budget: PlanBudget;
  when: Date; // resolved meeting time (host's clock for "now")
  groupSize: number;
};

export type WalkableStep = {
  venue: Venue;
  role: PlanRole;
  dwellMins: number;
  walkToNextMins: number | null;
};

export type WalkableEvent = { event: Event; nearStepIdx: number };

export type WalkablePlan = {
  steps: WalkableStep[];
  alternatives: Venue[][]; // alternatives[i] = ranked next-best for step i
  totalMins: number;
  unfilledRoles: PlanRole[];
  event: WalkableEvent | null;
};

const ROLE_ORDER: PlanRole[] = ["Start", "Then", "Finish"];
const RADIUS_LADDER_KM = [0.8, 1.2, 1.6]; // widen per slot if nothing nearby
const PROX_WEIGHT = 0.05; // rating points shaved per walking minute

// Base desirability before the proximity penalty. Rating-led for now (yes/no
// swipes don't capture chill-vs-lively); a real vibe question can feed
// vibeScore in here later.
function baseScore(v: Venue): number {
  return v.rating;
}

function minWalkToChosen(v: Venue, chosen: Venue[]): number {
  if (chosen.length === 0) return 0;
  return Math.min(...chosen.map((c) => walkMins(c, v)));
}

function minKmToChosen(v: Venue, chosen: Venue[]): number {
  if (chosen.length === 0) return 0;
  const ds = chosen
    .map((c) => haversineKm(c, v))
    .filter((d): d is number => d != null);
  return ds.length ? Math.min(...ds) : 0;
}

function rankByScore(candidates: Venue[], near: Venue[]): Venue[] {
  return [...candidates].sort(
    (a, b) =>
      baseScore(b) -
      PROX_WEIGHT * minWalkToChosen(b, near) -
      (baseScore(a) - PROX_WEIGHT * minWalkToChosen(a, near)),
  );
}

function eventAreaMatches(e: Event, area: PlanArea): boolean {
  switch (area.kind) {
    case "anywhere":
      return true;
    case "region":
      return regionOf(e.area) === area.region;
    case "neighbourhood":
      return (
        e.area === area.name ||
        (regionOf(e.area) !== null && regionOf(e.area) === regionOf(area.name))
      );
  }
}

function pickNearbyEvent(
  events: Event[],
  chosen: Venue[],
  settings: WalkableSettings,
): WalkableEvent | null {
  if (events.length === 0 || chosen.length === 0) return null;
  const whenMs = settings.when.getTime();
  const day = settings.when.getDay();
  const candidates = events
    .filter((e) => {
      const d = new Date(e.startsAt);
      const sameDay = d.getDay() === day;
      const notPast = d.getTime() >= whenMs - 3 * 60 * 60 * 1000;
      return sameDay && notPast && eventAreaMatches(e, settings.area);
    })
    .sort(
      (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
    );
  const ev = candidates[0];
  if (!ev) return null;
  let nearStepIdx = 0;
  if (ev.venueId) {
    const idx = chosen.findIndex((v) => v.id === ev.venueId);
    if (idx >= 0) nearStepIdx = idx;
  }
  return { event: ev, nearStepIdx };
}

// Greedily build a walkable cluster from a given seed: seed first, then the
// best-scoring open role-match within an expanding radius of the cluster.
function buildClusterFromSeed(
  pool: Venue[],
  roles: PlanRole[],
  seed: Venue,
): {
  chosen: { venue: Venue; role: PlanRole; radiusKm: number }[];
  unfilled: PlanRole[];
} {
  const used = new Set<string>([seed.id]);
  const chosen = [{ venue: seed, role: roles[0], radiusKm: 0 }];
  const unfilled: PlanRole[] = [];
  for (const role of roles.slice(1)) {
    const chosenVenues = chosen.map((c) => c.venue);
    let picked: Venue | null = null;
    let pickedRadius = RADIUS_LADDER_KM[RADIUS_LADDER_KM.length - 1];
    for (const R of RADIUS_LADDER_KM) {
      const candidates = rankByScore(
        pool.filter(
          (v) =>
            !used.has(v.id) &&
            roleMatches(v, role) &&
            minKmToChosen(v, chosenVenues) <= R,
        ),
        chosenVenues,
      );
      if (candidates.length > 0) {
        picked = candidates[0];
        pickedRadius = R;
        break;
      }
    }
    if (!picked) {
      unfilled.push(role);
      continue;
    }
    used.add(picked.id);
    chosen.push({ venue: picked, role, radiusKm: pickedRadius });
  }
  return { chosen, unfilled };
}

export function computeWalkablePlan(
  venues: Venue[],
  settings: WalkableSettings,
  includedRoles: PlanRole[],
  events: Event[] = [],
): WalkablePlan {
  const { area, budget, when } = settings;
  const open = (v: Venue) => isOpenAt(v, when);

  // Candidate pool with a graceful widening ladder. Never drop the
  // open-check unless it would otherwise empty the pool.
  let pool = venues.filter(
    (v) => venueInArea(v, area) && withinBudget(v.price, budget) && open(v),
  );
  if (pool.length < 3)
    pool = venues.filter((v) => withinBudget(v.price, budget) && open(v));
  if (pool.length < 3) pool = venues.filter((v) => open(v));
  if (pool.length < 3) pool = [...venues];

  let roles = ROLE_ORDER.filter((r) => includedRoles.includes(r));
  if (roles.length === 0) roles = ["Start"];

  // Try several seeds (top role-matches by score) and keep the cluster that
  // fills the most stops, then the highest quality — so we don't seed on an
  // isolated top-rated venue and end up with a lonely 1-stop plan.
  const seedRole = roles[0];
  let seedCandidates = rankByScore(
    pool.filter((v) => roleMatches(v, seedRole)),
    [],
  ).slice(0, 10);
  if (seedCandidates.length === 0) {
    seedCandidates = rankByScore(pool, []).slice(0, 10);
  }

  let best: {
    chosen: { venue: Venue; role: PlanRole; radiusKm: number }[];
    unfilled: PlanRole[];
    score: number;
  } | null = null;
  for (const seed of seedCandidates) {
    const c = buildClusterFromSeed(pool, roles, seed);
    const filled = roles.length - c.unfilled.length;
    const quality = c.chosen.reduce((s, x) => s + baseScore(x.venue), 0);
    const score = filled * 1000 + quality;
    if (!best || score > best.score) best = { ...c, score };
  }

  const chosen = best ? best.chosen : [];
  const unfilledRoles = best ? best.unfilled : roles;
  const used = new Set<string>(chosen.map((c) => c.venue.id));

  const steps: WalkableStep[] = chosen.map((c, i) => {
    const next = chosen[i + 1]?.venue;
    return {
      venue: c.venue,
      role: c.role,
      dwellMins: DWELL[c.role],
      walkToNextMins: next ? walkMins(c.venue, next) : null,
    };
  });

  // Per-step alternatives (deterministic → powers Swap): same role, unused,
  // near the OTHER chosen stops so a swap keeps the cluster walkable.
  const alternatives: Venue[][] = chosen.map((c) => {
    const others = chosen
      .filter((x) => x.venue.id !== c.venue.id)
      .map((x) => x.venue);
    return rankByScore(
      pool.filter(
        (v) =>
          !used.has(v.id) &&
          roleMatches(v, c.role) &&
          (others.length === 0 || minKmToChosen(v, others) <= c.radiusKm),
      ),
      others,
    );
  });

  const totalMins = steps.reduce(
    (sum, s) => sum + s.dwellMins + (s.walkToNextMins ?? 0),
    0,
  );

  const event = pickNearbyEvent(
    events,
    chosen.map((c) => c.venue),
    settings,
  );

  return { steps, alternatives, totalMins, unfilledRoles, event };
}
