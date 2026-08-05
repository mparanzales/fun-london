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
import { haversineKm as geoHaversineKm } from "@/lib/geo";
import { VIBE_KEYWORDS } from "@/lib/ranking";
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
  // Per-stop swap options for a freshly generated plan. The solo UI no longer
  // reads this — it derives its own from the stops on screen via
  // alternativesFor — but the group surface still does. alternatives[i] is the
  // ranked list of other venues
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
      // The Night flag admits late venues the type list misses (a Night
      // cafe = a late dessert spot, fine) — but NEVER a Restaurant: a
      // "Night" restaurant is late-night DINING, and slotting it last
      // builds drinks -> drinks -> dinner-at-10pm. Real shipped symptom
      // (Wine Bar -> Cigar Merchants -> Claridge's, 2026-07-27).
      return (
        FINISH_TYPES.includes(v.type) ||
        (v.timeOfDay === "Night" && !EAT_TYPES.includes(v.type))
      );
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
      s += 2 * tagHit(v, VIBE_KEYWORDS.chill);
      break;
    case "Lively":
      if (["Bar", "Pub", "Live Music"].includes(v.type)) s += 2;
      if (v.timeOfDay === "Night") s += 1;
      s += 2 * tagHit(v, VIBE_KEYWORDS.lively);
      break;
    case "Fancy":
      if (["Restaurant", "Wine Bar"].includes(v.type)) s += 1;
      s += PRICE_RANK[v.price] ?? 2; // pricier reads fancier
      s += 2 * tagHit(v, VIBE_KEYWORDS.fancy);
      break;
    case "Unique":
      if (["Listening Bar", "Live Music", "Culture", "Market"].includes(v.type))
        s += 2;
      s += 2 * tagHit(v, VIBE_KEYWORDS.unique);
      break;
  }
  s += (v.rating - 4) * 1.5; // gentle quality nudge
  return s;
}

// ── Distance / walk time ─────────────────────────────────────────────────

// Null-preserving wrapper over the ONE canonical haversine (lib/geo.ts) —
// this file used to carry its own copy of the formula (one of three in the
// repo, per the 2026-07-09 audit).
function haversineKm(a: Venue, b: Venue): number | null {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) {
    return null;
  }
  return geoHaversineKm({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng });
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
  // Which venue types the ROLE-RELAXED rung may draw from at all. The rung
  // exists to fill a thin slot with "something nearby" — but "anything
  // nearby" put a Cafe and a MARKET into an evening night (Luna Omakase ->
  // Beigel Bake -> Brick Lane Market, 2026-07-27). Relaxed picks must still
  // be plausible for the daypart.
  relaxedOk: (v: Venue) => boolean,
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
          (requireRole ? matchRole(v, role) : relaxedOk(v)) &&
          openOK(v) &&
          (maxKm == null || minKmToChosen(v, chosenVenues) <= maxKm),
      );
      const fresh = cands.filter((v) => !usedTypes.has(v.type));
      // Role-matched picks may repeat a type when nothing fresh remains (two
      // bars beats one stop). The ROLE-RELAXED rung may not: it exists to
      // fill a thin slot with "something nearby", and letting it repeat a
      // type is how a night got a SECOND restaurant as its finale (dinner
      // again at 10pm — real shipped symptom, 2026-07-27). Relaxed picks
      // must bring a fresh type or leave the slot honestly unfilled.
      const eligible = requireRole ? (fresh.length > 0 ? fresh : cands) : fresh;
      const ranked = eligible.slice().sort((a, b) => scoreOf(b) - scoreOf(a));
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
  // Evening relaxed fills come from drinks/night types ONLY — food's place
  // in an evening is Start, via its own rules; a cafe or market mid-night
  // reads as a broken plan. Day plans relax across the day templates.
  const relaxedOk = (v: Venue) =>
    daypart === "evening"
      ? DRINK_TYPES.includes(v.type) || FINISH_TYPES.includes(v.type)
      : DAY_THEN_TYPES.includes(v.type) || DAY_FINISH_TYPES.includes(v.type);
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
    // Start = dinner. EAT_FALLBACK (Cafe/Wine Bar) exists so a thin pool can
    // still open the night, but at equal rank a high-scoring wine bar
    // outseeded actual restaurants and the night became drinks -> drinks ->
    // dinner-last (real shipped symptom, 2026-07-27). The fallback is now a
    // WIDENING RUNG: seed from true eat types when any exist, fall back only
    // when none do. Day plans keep their own template untouched.
    const allStart = pool.filter((v) => matchRole(v, "Start"));
    const primaryStart =
      daypart === "evening"
        ? allStart.filter((v) => EAT_TYPES.includes(v.type))
        : allStart;
    const seedMatches = primaryStart.length > 0 ? primaryStart : allStart;
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
        relaxedOk,
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

  // Per-stop swap options (Stage 4.x — "change this one"). Delegated so that
  // the UI can compute the SAME options for a night the engine did not just
  // produce — a restored or reopened one — instead of reusing this array,
  // whose indices belong to these stops and no others.
  const alternatives = alternativesFor(pool, chosen, {
    vibe,
    budget,
    daypart,
    when,
    tasteScores,
    maxRadiusKm: Math.max(...radiusLadder),
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

/**
 * Is `v` within a short walk of EVERY venue in `neighbours`?
 *
 * 🧨 THIS, NOT "near at least one". The any-rule looks equivalent on a
 * three-stop night and is not: it lets a night walk itself apart one legal
 * hop at a time. Replace stop 0 to sit beside stop 1, then stop 1 to sit
 * beside stop 2, and stop 0 is now stranded — every individual replacement
 * passed, the route did not. A generated test found it at the seventh
 * replacement in a chain.
 *
 * Callers pass a stop's ADJACENT stops, so the constraint is exactly the walk
 * the user is shown: consecutive hops.
 */
export function withinWalkOfAll(
  v: Venue,
  neighbours: Venue[],
  maxKm: number = RADIUS_LADDER_KM[RADIUS_LADDER_KM.length - 1],
): boolean {
  // A null distance means one of them has no coordinates. The engine fails
  // OPEN on unknown geography everywhere else (walkMins uses an 8-min
  // fallback), so refusing here would silently drop every option beside a
  // venue we simply have no lat/lng for.
  return neighbours.every((n) => {
    const d = haversineKm(n, v);
    return d == null || d <= maxKm;
  });
}

/**
 * Is `v` within a short walk of at least one of `others`?
 *
 * The LOOSER rule, and no longer the one the option lists use — see
 * `withinWalkOfAll`, which replaced it after a generated test showed the
 * any-rule lets a night come apart one legal hop at a time. Kept because it is
 * still the right question to ask of a whole arrangement ("is every stop near
 * something?"), which is what the walkability tests assert.
 */
export function withinWalkOfAny(
  v: Venue,
  others: Venue[],
  maxKm: number = RADIUS_LADDER_KM[RADIUS_LADDER_KM.length - 1],
): boolean {
  return others.length === 0 || minKmToChosen(v, others) <= maxKm;
}

/**
 * The "change this one" options for a given set of stops.
 *
 * 🧨 WHY THIS IS EXPORTED, AND WHY THE UI MUST NOT REUSE `Plan.alternatives`.
 * That array is indexed to the stops the engine returned. A restored, claimed
 * or reopened night has DIFFERENT stops, so `alternatives[i]` there describes
 * some other night's stop i — offering it would swap in a venue chosen for a
 * walk that no longer exists, and could build a route nobody can walk. The
 * previous release hid the control entirely rather than risk that; this makes
 * the mismatch impossible instead, because the options are always derived from
 * the stops actually on screen.
 *
 * `computePlan` calls this too, so the two paths cannot drift apart.
 *
 * The pool is the CALLER'S: `computePlan` passes its own area-scoped, possibly
 * widened pool so its behaviour is unchanged, and the UI passes what it has.
 * No budget filtering happens here — the engine's widest rung deliberately
 * drops the budget constraint, and re-applying it would silently narrow it.
 */
export function alternativesFor(
  pool: Venue[],
  stops: { venue: Venue; role: PlanRole; arriveAt?: Date | null }[],
  opts: {
    vibe: PlanVibe;
    budget: PlanBudget;
    daypart: PlanDaypart;
    when?: Date;
    tasteScores?: Record<string, number> | null;
    /** Defaults to the engine's widest walk radius. */
    maxRadiusKm?: number;
  },
): Venue[][] {
  const { vibe, daypart, when, tasteScores } = opts;
  const maxRadius =
    opts.maxRadiusKm ?? RADIUS_LADDER_KM[RADIUS_LADDER_KM.length - 1];
  const scoreOf = (v: Venue) =>
    vibeScore(v, vibe) +
    (tasteScores ? PLAN_TASTE_WEIGHT * (tasteScores[v.id] ?? 0) : 0);
  const chosenIds = new Set(stops.map((c) => c.venue.id));
  return stops.map((c, i) => {
    // The stop's ADJACENT stops — the hops the user actually walks. Measuring
    // against "any other stop" let a night drift apart one legal replacement
    // at a time; see withinWalkOfAll.
    // 🧨 A stop with NO neighbours anchors on ITSELF. The engine leaves a role
    // unfilled rather than teleport, so a one-stop night is a real state — and
    // an empty neighbour list makes `withinWalkOfAll` vacuously true, which
    // meant the single stop of a Richmond night could be replaced by the
    // top-scoring restaurant in Soho, 15 km away, with nothing in the path
    // constraining it. Anchoring on the stop being replaced keeps a
    // replacement in the same part of town, which is the whole promise.
    const adjacent = [stops[i - 1], stops[i + 1]].filter(Boolean);
    const neighbours = (adjacent.length > 0 ? adjacent : [stops[i]]).map(
      (x) => x.venue,
    );
    return (
      pool
        .filter(
          (v) =>
            !chosenIds.has(v.id) &&
            roleMatchesForDaypart(v, c.role, daypart) &&
            (!when || !c.arriveAt || isOpenAt(v, c.arriveAt)) &&
            withinWalkOfAll(v, neighbours, maxRadius),
        )
        .sort((a, b) => scoreOf(b) - scoreOf(a))
        .slice(0, 8)
        // 🧨 AND IT MUST NOT CLOSE A LATER STOP. The check above asks whether the
        // CANDIDATE is open when you would reach it, which is necessary and not
        // sufficient: a candidate's dwell is its own, so swapping a 40-minute
        // cafe for a 90-minute restaurant pushes every later arrival back by
        // fifty minutes. Two of those and the finale is an hour and a half
        // later — at a venue that shut. Nothing warned, because the stop was
        // open when it was chosen and nothing re-asked. Applied AFTER the slice,
        // so the simulation runs over at most eight candidates rather than the
        // whole pool.
        .filter((v) => !closesALaterStop(stops, i, v, when))
    );
  });
}

/**
 * Would putting `candidate` at index `i` leave a LATER stop shut when the user
 * gets there?
 *
 * Replacing a stop changes its dwell, which moves every arrival after it. This
 * re-walks the night with the candidate in place and asks the question the
 * original selection asked, of the stops that selection cannot have known
 * about. With no clock (`when` absent) there are no arrivals to check and
 * nothing can be decided, so it answers no.
 */
function closesALaterStop(
  stops: { venue: Venue; role: PlanRole; arriveAt?: Date | null }[],
  i: number,
  candidate: Venue,
  when?: Date,
): boolean {
  if (!when || i >= stops.length - 1) return false;
  // 🧨 AGAINST THE NIGHT AS IT STANDS, not against perfection. Asking "is any
  // later stop shut?" outright meant that once a later stop was ALREADY shut —
  // which the new warning now advertises — every candidate for every earlier
  // stop was refused, so Change went dead on the two stops that could have
  // fixed it while the copy blamed walkability. A candidate is only at fault
  // for a stop it CLOSES; one that was already dark is not its doing.
  const alreadyShut = new Set(closedOnArrival(relinkSteps(stops, when)));
  const swapped = stops.map((s, j) => ({
    venue: j === i ? candidate : s.venue,
    role: s.role,
  }));
  return relinkSteps(swapped, when).some(
    (s, j) =>
      j > i &&
      s.arriveAt != null &&
      !isOpenAt(s.venue, s.arriveAt) &&
      !alreadyShut.has(j),
  );
}

/**
 * Would starting `shiftMins` earlier (negative) or later leave FEWER stops
 * shut on arrival?
 *
 * The lever this powers steps a night's start back 30 minutes at a time.
 * Unguarded, it made some nights strictly worse forever: closedOnArrival is
 * "not open at arrival", which is true in BOTH directions, so a music room
 * that OPENS at 23:00 with arrival 22:40 counts as closed — and every
 * earlier step moved the night further from the fix, with the copy
 * instructing exactly that. Extracted so the suite can break it on purpose;
 * the component composes it into the chip's visibility.
 *
 * Compares COUNTS: a shift that re-opens two stops and darkens one still
 * qualifies, which is the intended reading of "helps".
 */
export function shiftReducesClosed(
  stops: { venue: Venue; role: PlanRole }[],
  when: Date,
  shiftMins: number,
): boolean {
  const shifted = new Date(when.getTime() + shiftMins * 60_000);
  return (
    closedOnArrival(relinkSteps(stops, shifted)).length <
    closedOnArrival(relinkSteps(stops, when)).length
  );
}

/**
 * The indices of stops that will be SHUT when the user arrives.
 *
 * A night is not static: a replacement moves later arrivals, and undo restores
 * an arrangement that was valid when it was made. Either can leave a stop the
 * user kept — rather than one we offered — closed on arrival. Offering only open
 * candidates is half the job; the other half is saying so when a stop already
 * in the night stops working, instead of printing an arrival time under a
 * venue that will be dark.
 */
export function closedOnArrival(
  steps: { venue: Venue; arriveAt?: Date | null }[],
): number[] {
  const out: number[] = [];
  steps.forEach((s, i) => {
    if (s.arriveAt != null && !isOpenAt(s.venue, s.arriveAt)) out.push(i);
  });
  return out;
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
