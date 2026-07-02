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
// "day" = a daytime outing (brunch/coffee → a daytime activity → a relaxed
// wind-down); "evening" = the classic eat → drinks → night-out arc.
export type PlanDaypart = "day" | "evening";
// Sentinel area meaning "don't constrain to a neighbourhood".
export const ANYWHERE = "Anywhere";

export type PlanStep = {
  venue: Venue;
  role: PlanRole;
  dwellMins: number; // time spent at this stop
  walkToNextMins: number | null; // walk to the next stop (null on the last)
  // Estimated arrival time at this stop, walking the night's clock forward
  // from the plan start (`when`): arrival(N) = arrival(N-1) + dwell(N-1) +
  // walk(N-1→N). null when no start time was supplied (server-side render).
  arriveAt: Date | null;
};

export type Plan = {
  area: string;
  vibe: PlanVibe;
  budget: PlanBudget;
  daypart: PlanDaypart;
  steps: PlanStep[];
  totalMins: number; // dwell + walking across the whole night
  // Telemetry (not rendered) — how the candidate pool was resolved, so
  // analytics can see when the engine had to compromise to fill a night:
  //   "area"   = honoured the chosen area + budget
  //   "budget" = dropped the area (kept budget) to find enough venues
  //   "all"    = last resort: ignored area AND budget
  // Opening hours are NOT a pool rung — each stop is checked open at its own
  // arrival time (Stage 4.2), independent of how the pool was widened.
  poolStage: "area" | "budget" | "all";
  poolSize: number; // candidates considered after widening
  // Per-stop swap options: alternatives[i] is the ranked list of other venues
  // that fit stop i's role, stay within a short walk of the OTHER stops (so a
  // swap keeps the night walkable) and are open at that stop's arrival. Powers
  // "don't like this one — change it" without rebuilding the whole plan.
  alternatives: Venue[][];
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

// Daytime role types: brunch/coffee → a daytime activity → a relaxed wind-down.
// Lets the daytime catalogue (cafés, culture, markets, outdoors) actually be
// PLACED as stops — the evening arc (eat → drinks → night-venue) can't.
const DAY_START_TYPES: VenueType[] = ["Cafe", "Restaurant"];
const DAY_THEN_TYPES: VenueType[] = ["Culture", "Market", "Outdoors"];
const DAY_FINISH_TYPES: VenueType[] = ["Cafe", "Wine Bar", "Restaurant"];

// Role match for a daypart. Evening reuses the classic arc; day uses the
// daytime templates above.
function roleMatchesForDaypart(
  v: Venue,
  role: PlanRole,
  daypart: PlanDaypart,
): boolean {
  if (daypart === "evening") return roleMatches(v, role);
  switch (role) {
    case "Start":
      return DAY_START_TYPES.includes(v.type);
    case "Then":
      return DAY_THEN_TYPES.includes(v.type);
    case "Finish":
      return DAY_FINISH_TYPES.includes(v.type);
  }
}

// Plan Together (mood-deck) matcher: when the group hearted moods for this
// role, the allowed venue types are exactly the union of those moods' types
// (RoleIntent). When a role has no hearted types, fall back to the default
// role rule so the planner still behaves. See lib/plan-together-moods.ts.
export type RoleIntent = Record<PlanRole, VenueType[]>;

const EMPTY_INTENT: RoleIntent = { Start: [], Then: [], Finish: [] };

function roleMatchesIntent(
  v: Venue,
  role: PlanRole,
  intent: RoleIntent,
): boolean {
  const types = intent[role];
  if (types && types.length > 0) return types.includes(v.type);
  return roleMatches(v, role);
}

// How long you actually spend at a stop, by venue TYPE — a coffee is not a
// dinner is not a club. Drives both the itinerary's total time and the
// arrival-time clock (Stage 4.2). Falls back to 60 for any unlisted type.
const DWELL_BY_TYPE: Record<VenueType, number> = {
  Cafe: 40, // coffee / a quick bite
  Restaurant: 90, // a proper sit-down meal
  "Wine Bar": 70,
  Bar: 60,
  Pub: 60,
  "Listening Bar": 75,
  "Live Music": 105, // a set / a club night runs long
  Culture: 75, // a gallery / exhibition
  Market: 50,
  Outdoors: 60,
};
function dwellFor(v: Venue): number {
  return DWELL_BY_TYPE[v.type] ?? 60;
}

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
export function walkMins(a: Venue, b: Venue): number {
  const km = haversineKm(a, b);
  if (km == null) return 8;
  return Math.max(2, Math.round(km * 12));
}

// ── Plan builder ─────────────────────────────────────────────────────────

// Is a venue within `radiusKm` of a centre point (the "Near you" mode)?
function withinRadius(
  v: Venue,
  center: { lat: number; lng: number },
  radiusKm: number,
): boolean {
  if (v.lat == null || v.lng == null) return false;
  const km = haversineKm({ lat: center.lat, lng: center.lng } as Venue, v);
  return km != null && km <= radiusKm;
}

// A short human label for a requested scope — used only when a plan can't be
// filled, so there's no resolved pocket to name.
function scopeLabel(area: PlanArea): string {
  switch (area.kind) {
    case "anywhere":
      return ANYWHERE;
    case "region":
      return area.region;
    case "neighbourhood":
      return area.name;
  }
}

// Build ONE walkable cluster from a seed: the seed first, then for each later
// role the best-scoring open role-match within an expanding WALK radius of the
// stops already chosen. This is the group planner's proximity clustering, but
// kept on the solo engine's terms — vibe/taste score, daypart role-matching,
// per-arrival open check and type variety. Without this a region/"Anywhere"
// pick would scatter the night across non-walkable distances.
type ClusterStop = { venue: Venue; role: PlanRole; arriveAt: Date | null };
function buildSoloCluster(
  pool: Venue[],
  roles: PlanRole[],
  seed: Venue,
  scoreOf: (v: Venue) => number,
  matchRole: (v: Venue, role: PlanRole) => boolean,
  when: Date | undefined,
  enforceOpen: boolean,
  radiusLadder: number[],
): ClusterStop[] {
  const addMins = (t: Date, mins: number) =>
    new Date(t.getTime() + mins * 60_000);
  const used = new Set<string>([seed.id]);
  const usedTypes = new Set<VenueType>([seed.type]);
  const chosen: ClusterStop[] = [
    { venue: seed, role: roles[0], arriveAt: when ?? null },
  ];

  for (const role of roles.slice(1)) {
    const prev = chosen[chosen.length - 1];
    const chosenVenues = chosen.map((c) => c.venue);
    const arrivalFor = (cand: Venue): Date | undefined => {
      if (!when || !prev.arriveAt) return undefined;
      const depart = addMins(prev.arriveAt, dwellFor(prev.venue));
      return addMins(depart, walkMins(prev.venue, cand));
    };
    const openOK = (cand: Venue) =>
      !when || !enforceOpen || isOpenAt(cand, arrivalFor(cand)!);
    // Best open candidate within `maxKm` of the cluster (null = no limit).
    // `requireRole` enforces the daypart role-match; prefer a fresh venue TYPE
    // so a night doesn't repeat e.g. two bars.
    const best = (maxKm: number | null, requireRole: boolean): Venue | null => {
      const cands = pool.filter(
        (v) =>
          !used.has(v.id) &&
          (!requireRole || matchRole(v, role)) &&
          openOK(v) &&
          (maxKm == null || minKmToChosen(v, chosenVenues) <= maxKm),
      );
      const fresh = cands.filter((v) => !usedTypes.has(v.type));
      const ranked = (fresh.length > 0 ? fresh : cands).sort(
        (a, b) => scoreOf(b) - scoreOf(a),
      );
      return ranked[0] ?? null;
    };
    // Stay within a WALKABLE radius of the cluster: prefer a role-match nearby,
    // widen the radius, then relax the role — but never teleport outside the
    // ladder (that would break the walkable promise). If nothing's near, leave
    // the slot unfilled rather than stitch in a far stop.
    let picked: Venue | null = null;
    for (const R of radiusLadder) {
      picked = best(R, true);
      if (picked) break;
    }
    if (!picked)
      for (const R of radiusLadder) {
        picked = best(R, false);
        if (picked) break;
      }
    if (!picked) continue; // nothing walkable for this role — leave it unfilled
    used.add(picked.id);
    usedTypes.add(picked.type);
    chosen.push({
      venue: picked,
      role,
      arriveAt: when ? (arrivalFor(picked) ?? null) : null,
    });
  }
  return chosen;
}

// How hard the personal taste vector pulls vs the chosen vibe/quality. The
// chosen vibe/budget/area are tonight's brief (hard-ish); taste personalises
// WHICH on-brief venue leads. Centred cosine ~[-0.3,0.7] × this is comparable
// to a strong vibe match (~8), so taste leads but vibe still shapes the night.
const PLAN_TASTE_WEIGHT = 8;

// Does this clock hour read as "day" (vs evening/night)? Daytime is 05:00–16:59;
// the small hours (00:00–04:59) are still the night before, so a plan built at
// 1am is a night out, not a day out. Shared with the plan UI so both agree.
export function isDaytimeHour(hour: number): boolean {
  return hour >= 5 && hour < 17;
}

export function computePlan(
  venues: Venue[],
  opts: {
    area: PlanArea;
    vibe: PlanVibe;
    budget: PlanBudget;
    offset?: number;
    when?: Date;
    tasteScores?: Record<string, number> | null;
    daypart?: PlanDaypart;
    center?: { lat: number; lng: number } | null;
    radiusKm?: number;
  },
): Plan {
  const {
    area,
    vibe,
    budget,
    offset = 0,
    when,
    tasteScores,
    center,
    radiusKm = 1.5,
  } = opts;
  // Day vs evening shapes the whole plan (which venue types fill each role).
  // Explicit `daypart` wins; else infer from the clock (05:00–16:59 reads day,
  // and the small hours count as the night before — see isDaytimeHour).
  const daypart: PlanDaypart =
    opts.daypart ??
    (when && isDaytimeHour(when.getHours()) ? "day" : "evening");
  const matchRole = (v: Venue, role: PlanRole) =>
    roleMatchesForDaypart(v, role, daypart);
  // Blended desirability: tonight's vibe/quality + the user's personal taste
  // (Stage 4.1). No taste (anon / no signals) → pure vibe, unchanged behaviour.
  const scoreOf = (v: Venue) =>
    vibeScore(v, vibe) +
    (tasteScores ? PLAN_TASTE_WEIGHT * (tasteScores[v.id] ?? 0) : 0);

  // Scope the pool: a "Near you" centre+radius wins; else the PlanArea
  // (Anywhere / a region / a single neighbourhood). Widen gracefully if the
  // scope + budget is too thin; poolStage records which rung we landed on.
  const inScope = (v: Venue) =>
    center ? withinRadius(v, center, radiusKm) : venueInArea(v, area);
  const inArea = venues.filter(
    (v) => inScope(v) && withinBudget(v.price, budget),
  );
  const inBudget = venues.filter((v) => withinBudget(v.price, budget));
  let pool: Venue[];
  let poolStage: Plan["poolStage"];
  if (inArea.length >= 3) {
    pool = inArea;
    poolStage = "area";
  } else if (inBudget.length >= 3) {
    pool = inBudget; // dropped area, kept budget
    poolStage = "budget";
  } else {
    pool = venues; // last resort: ignore area AND budget
    poolStage = "all";
  }

  const roles: PlanRole[] = ["Start", "Then", "Finish"];
  // "Near you" is already radius-bounded, so its cluster just keeps the stops
  // mutually close; a broad scope (a region / Anywhere) uses the widening
  // ladder to settle on a single WALKABLE pocket rather than scatter the night.
  const radiusLadder = center ? [radiusKm] : RADIUS_LADDER_KM;

  // Try several seeds (the top Start-matches by score) and keep the cluster
  // that fills the most stops, then the highest quality — so we never seed on
  // an isolated top venue and strand a one-stop night. `offset` cycles the
  // distinct clusters for "Try another".
  const buildClusters = (enforceOpen: boolean) => {
    const seedMatches = pool.filter((v) => matchRole(v, "Start"));
    const seeds = (seedMatches.length > 0 ? seedMatches : pool)
      .slice()
      .sort((a, b) => scoreOf(b) - scoreOf(a))
      .slice(0, 10);
    const clusters = seeds.map((seed) => {
      const chosen = buildSoloCluster(
        pool,
        roles,
        seed,
        scoreOf,
        matchRole,
        when,
        enforceOpen,
        radiusLadder,
      );
      const quality = chosen.reduce((s, c) => s + scoreOf(c.venue), 0);
      let totalWalk = 0;
      for (let i = 1; i < chosen.length; i++)
        totalWalk += walkMins(chosen[i - 1].venue, chosen[i].venue);
      // Fill first (a complete night beats a short one), then prefer the
      // TIGHTEST cluster, then quality — so a scattered 3-stop never beats a
      // walkable one.
      return { chosen, score: chosen.length * 1000 + quality - totalWalk };
    });
    // Distinct by venue set, best first, so "Try another" actually changes.
    const distinct: typeof clusters = [];
    const seen = new Set<string>();
    for (const c of clusters.sort((a, b) => b.score - a.score)) {
      const key = c.chosen
        .map((x) => x.venue.id)
        .sort()
        .join(",");
      if (!seen.has(key)) {
        seen.add(key);
        distinct.push(c);
      }
    }
    return distinct;
  };

  // Honour opening hours; only if that can't fill a single stop do we relax it
  // (last-resort fail-open), so a planned night never routes to a shut door yet
  // never empties out before the hours backfill has run.
  let clusters = buildClusters(true);
  if (clusters.length === 0 || clusters[0].chosen.length === 0) {
    clusters = buildClusters(false);
  }
  const chosen =
    clusters.length > 0 ? clusters[offset % clusters.length].chosen : [];

  const steps: PlanStep[] = chosen.map((c, i) => {
    const next = chosen[i + 1]?.venue;
    return {
      venue: c.venue,
      role: c.role,
      dwellMins: dwellFor(c.venue),
      walkToNextMins: next ? walkMins(c.venue, next) : null,
      arriveAt: c.arriveAt,
    };
  });

  const totalMins = steps.reduce(
    (sum, s) => sum + s.dwellMins + (s.walkToNextMins ?? 0),
    0,
  );

  // The plan's resolved POCKET — the neighbourhood it actually landed in — so a
  // region / Anywhere pick reads as a real place ("a night around Shoreditch").
  const resolvedArea = chosen[0]?.venue.neighbourhood || scopeLabel(area);

  // Per-stop swap options (Stage 4.x — "change this one"): for each stop, the
  // best other venues that fit its role, stay within a short walk of the OTHER
  // stops (so a swap keeps the night walkable) and are open at its arrival.
  const chosenIds = new Set(chosen.map((c) => c.venue.id));
  const maxRadius = Math.max(...radiusLadder);
  const alternatives: Venue[][] = chosen.map((c, i) => {
    const others = chosen.filter((_, j) => j !== i).map((x) => x.venue);
    return pool
      .filter(
        (v) =>
          !chosenIds.has(v.id) &&
          matchRole(v, c.role) &&
          (!when || !c.arriveAt || isOpenAt(v, c.arriveAt)) &&
          (others.length === 0 || minKmToChosen(v, others) <= maxRadius),
      )
      .sort((a, b) => scoreOf(b) - scoreOf(a))
      .slice(0, 8);
  });

  return {
    area: resolvedArea,
    vibe,
    budget,
    daypart,
    steps,
    totalMins,
    poolStage,
    poolSize: pool.length,
    alternatives,
  };
}

// Recompute a plan's steps (dwell, walk-to-next, and the arrival clock) for a
// given venue sequence. Used when the UI swaps a single stop so the swapped
// venue's dwell/distance/arrivals stay honest without rebuilding the whole plan.
// With no `when`, arrivals stay null (server render / no clock), as in the
// freshly-computed plan.
export function relinkSteps(
  items: { venue: Venue; role: PlanRole }[],
  when?: Date,
): PlanStep[] {
  let arrival: Date | null = when ?? null;
  return items.map((it, i) => {
    const next = items[i + 1]?.venue;
    const dwellMins = dwellFor(it.venue);
    const walkToNextMins = next ? walkMins(it.venue, next) : null;
    const arriveAt = arrival;
    if (arrival && next) {
      arrival = new Date(
        arrival.getTime() + (dwellMins + (walkToNextMins ?? 0)) * 60_000,
      );
    }
    return {
      venue: it.venue,
      role: it.role,
      dwellMins,
      walkToNextMins,
      arriveAt,
    };
  });
}

// One-line rationale for the saved-plan record + the result header.
export function planRationale(plan: Plan): string {
  const names = plan.steps.map((s) => s.venue.name);
  const where = plan.area === ANYWHERE ? "London" : plan.area;
  const kind = plan.daypart === "day" ? "day out" : "night";
  return `A ${plan.vibe.toLowerCase()} ${where} ${kind}: ${names.join(" → ")}.`;
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
// How many rating points a full group-taste match is worth (Stage 5). Rating
// spreads ~0.5 across a role's candidates, so this lets taste reorder within a
// role without swamping quality entirely.
const GROUP_TASTE_WEIGHT = 4;

// A blended group taste map: venueId → the group's taste relevance for it
// (centred cosine, ~[-0.3, 0.7]). Built server-side from the signed-in members'
// taste vectors (Stage 5). Absent/off → pure rating, unchanged behaviour.
export type GroupTaste = Record<string, number> | null | undefined;

// Base desirability before the proximity penalty: the venue's rating, nudged by
// how well it matches the GROUP's blended taste (Stage 5).
function baseScore(v: Venue, taste?: GroupTaste): number {
  return v.rating + (taste ? GROUP_TASTE_WEIGHT * (taste[v.id] ?? 0) : 0);
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

function rankByScore(
  candidates: Venue[],
  near: Venue[],
  taste?: GroupTaste,
): Venue[] {
  return [...candidates].sort(
    (a, b) =>
      baseScore(b, taste) -
      PROX_WEIGHT * minWalkToChosen(b, near) -
      (baseScore(a, taste) - PROX_WEIGHT * minWalkToChosen(a, near)),
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
  intent: RoleIntent = EMPTY_INTENT,
  taste?: GroupTaste,
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
            roleMatchesIntent(v, role, intent) &&
            minKmToChosen(v, chosenVenues) <= R,
        ),
        chosenVenues,
        taste,
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
  variant = 0,
  intent: RoleIntent = EMPTY_INTENT,
  taste?: GroupTaste,
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
    pool.filter((v) => roleMatchesIntent(v, seedRole, intent)),
    [],
    taste,
  ).slice(0, 10);
  if (seedCandidates.length === 0) {
    seedCandidates = rankByScore(pool, [], taste).slice(0, 10);
  }

  const clusters = seedCandidates
    .map((seed) => {
      const c = buildClusterFromSeed(pool, roles, seed, intent, taste);
      const filled = roles.length - c.unfilled.length;
      const quality = c.chosen.reduce(
        (s, x) => s + baseScore(x.venue, taste),
        0,
      );
      return { ...c, score: filled * 1000 + quality };
    })
    .sort((a, b) => b.score - a.score);

  // Keep only distinct clusters (by venue set) so "another mix" actually
  // changes the plan; `variant` cycles through them.
  const distinct: typeof clusters = [];
  const seenKey = new Set<string>();
  for (const c of clusters) {
    const key = c.chosen
      .map((x) => x.venue.id)
      .sort()
      .join(",");
    if (!seenKey.has(key)) {
      seenKey.add(key);
      distinct.push(c);
    }
  }
  const best = distinct.length > 0 ? distinct[variant % distinct.length] : null;

  const chosen = best ? best.chosen : [];
  const unfilledRoles = best ? best.unfilled : roles;
  const used = new Set<string>(chosen.map((c) => c.venue.id));

  const steps: WalkableStep[] = chosen.map((c, i) => {
    const next = chosen[i + 1]?.venue;
    return {
      venue: c.venue,
      role: c.role,
      dwellMins: dwellFor(c.venue),
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
          roleMatchesIntent(v, c.role, intent) &&
          (others.length === 0 || minKmToChosen(v, others) <= c.radiusKm),
      ),
      others,
      taste,
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
