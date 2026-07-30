/**
 * The canonical NightPlan — ONE shape for a night, with adapters at every edge.
 *
 * WHY THIS EXISTS. A night currently has three incompatible representations:
 *
 *   1. `Plan` (lib/plan-engine.ts) — what the engine returns. Full `Venue`
 *      objects, `arriveAt: Date`, plus `alternatives[][]` for swaps. Rich, and
 *      far too heavy to persist or to hand to an anonymous caller.
 *   2. `plans.steps` (the database) — `{venueId, role, dwellMins,
 *      walkToNextMins}`. Lossy: it carries no vibe, no budget, no daypart and
 *      no start time, which is why `openSaved` had to INFER the daypart from
 *      whether the title contained "Day Out".
 *   3. `AnonPlanStop` (lib/plan-preview-shape.ts) — flat card fields for the
 *      signed-out path, deliberately stripped of every moat-bearing field.
 *
 * Nothing converted cleanly between them, so each flow grew its own ad-hoc
 * reconstruction: `openSaved` rebuilt one shape, the anon stash rebuilt
 * another, and a refresh lost the night entirely.
 *
 * NightPlan is the interchange format. It is deliberately BORING: plain JSON,
 * no Date objects, no Venue objects, no functions. It stores venue REFERENCES
 * (id + slug) rather than venue data, which is what makes it safe to put in
 * localStorage and in a jsonb column, and what keeps it on the right side of
 * the anon moat — a NightPlan can be held by a signed-out browser without
 * carrying a single moat field.
 *
 * 🧨 THE ANON MOAT. This module must never import from `lib/queries` or embed
 * venue rows. `stops[]` holds ids and slugs; hydration into real venues happens
 * in the client from the catalogue it already legitimately has. If you find
 * yourself adding `name`, `vibeTags` or `imgUrl` here, you are rebuilding the
 * leak that lib/plan-preview-shape.ts exists to prevent.
 */
import type {
  PlanBudget,
  PlanDaypart,
  PlanRole,
  PlanVibe,
} from "@/lib/plan-engine";

/** Bump only for a shape change that old readers cannot tolerate. */
export const NIGHT_PLAN_VERSION = 2 as const;

/**
 * How long a stored night still counts as "the night I am planning".
 *
 * 🧨 The legacy anon stash carried `savedAt` and a 1-hour TTL; the first draft
 * of this model dropped both, which meant a night from three weeks ago would
 * be restored and rendered under "Tonight, the plan:" — with an hours total
 * over venues whose opening hours were only ever checked at generation time.
 * Twelve hours covers "I planned this afternoon, I am going out tonight"
 * without ever presenting last Saturday as tonight.
 */
export const NIGHT_PLAN_TTL_MS = 12 * 60 * 60 * 1000;

/** A single stop: a reference plus the timing the engine computed for it. */
export type NightPlanStop = {
  /** Catalogue id. Primary key for hydration. */
  venueId: string;
  /**
   * Slug as a SECOND key. Ids are stable today, but the catalogue is rebuilt
   * by ingest crons and a night stored for weeks is exactly where an id would
   * go stale. Hydration tries the id first and falls back to the slug, so one
   * of the two going missing degrades a stop rather than losing the night.
   */
  slug: string;
  role: PlanRole;
  dwellMins: number;
  /** null on the last stop. */
  walkToNextMins: number | null;
};

export type NightPlanSource = "generated" | "saved" | "anon";

export type NightPlan = {
  version: typeof NIGHT_PLAN_VERSION;
  /** When this night was built. Drives freshness — see NIGHT_PLAN_TTL_MS. */
  createdAt: string;
  title: string;
  area: string;
  vibe: PlanVibe;
  budget: PlanBudget;
  daypart: PlanDaypart;
  /**
   * ISO timestamp of the night's start, or null when no clock was set (the
   * server render has no local time). Stored as a STRING, never a Date: a
   * Date does not survive JSON, and every persistence path here is JSON.
   */
  startsAt: string | null;
  stops: NightPlanStop[];
  /** Where this came from. Drives nothing structural; used for analytics. */
  source: NightPlanSource;
  /**
   * The `plans.id` this was reopened from, when it was. Lets the UI say "this
   * is your saved night" without a second lookup.
   *
   * It does NOT mean "saving updates that row": `public.plans` grants
   * SELECT/INSERT/DELETE to `authenticated` and has no UPDATE policy, so a
   * re-save is a new row by construction. That is a deliberate scope boundary,
   * not an oversight — changing it needs a migration and a lifecycle decision.
   */
  savedRowId: string | null;
};

/** The legacy step shape still on disk for every row written before this. */
export type LegacySavedStep = {
  venueId: string;
  role: PlanRole;
  dwellMins: number;
  walkToNextMins: number | null;
  /** Added by this model; absent on every pre-existing row. */
  slug?: string;
};

// ── Guards ───────────────────────────────────────────────────────────────

const ROLES = new Set<PlanRole>(["Start", "Then", "Finish"]);
const VIBES = new Set<PlanVibe>(["Chill", "Lively", "Fancy", "Unique"]);
const BUDGETS = new Set<PlanBudget>(["£", "££", "Any"]);

function isStop(v: unknown): v is NightPlanStop {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.venueId === "string" &&
    s.venueId.length > 0 &&
    typeof s.slug === "string" &&
    ROLES.has(s.role as PlanRole) &&
    typeof s.dwellMins === "number" &&
    Number.isFinite(s.dwellMins) &&
    (s.walkToNextMins === null ||
      (typeof s.walkToNextMins === "number" &&
        Number.isFinite(s.walkToNextMins)))
  );
}

/**
 * Structural validation for anything crossing a trust boundary — localStorage
 * (user-writable) and jsonb (written by older code).
 *
 * Returns null rather than throwing: a corrupt stored night must degrade to
 * "no active plan", never to a crashed /plan route.
 */
export function parseNightPlan(value: unknown): NightPlan | null {
  if (typeof value !== "object" || value === null) return null;
  const p = value as Record<string, unknown>;
  if (p.version !== NIGHT_PLAN_VERSION) return null;
  if (typeof p.createdAt !== "string") return null;
  if (typeof p.title !== "string" || typeof p.area !== "string") return null;
  if (!VIBES.has(p.vibe as PlanVibe)) return null;
  if (!BUDGETS.has(p.budget as PlanBudget)) return null;
  if (p.daypart !== "day" && p.daypart !== "evening") return null;
  if (p.startsAt !== null && typeof p.startsAt !== "string") return null;
  if (!Array.isArray(p.stops) || p.stops.length === 0) return null;
  if (!p.stops.every(isStop)) return null;
  const source = p.source;
  if (source !== "generated" && source !== "saved" && source !== "anon") {
    return null;
  }
  if (p.savedRowId !== null && typeof p.savedRowId !== "string") return null;
  return {
    version: NIGHT_PLAN_VERSION,
    createdAt: p.createdAt,
    title: p.title,
    area: p.area,
    vibe: p.vibe as PlanVibe,
    budget: p.budget as PlanBudget,
    daypart: p.daypart,
    startsAt: p.startsAt as string | null,
    stops: p.stops as NightPlanStop[],
    source,
    savedRowId: p.savedRowId as string | null,
  };
}

// ── Adapters ─────────────────────────────────────────────────────────────

/** The minimum an engine plan must expose to be adapted. Structural on
 *  purpose, so this module never imports the engine's Venue. */
type EngineLike = {
  area: string;
  vibe: PlanVibe;
  budget: PlanBudget;
  daypart: PlanDaypart;
  steps: {
    venue: { id: string; slug: string };
    role: PlanRole;
    dwellMins: number;
    walkToNextMins: number | null;
    arriveAt: Date | null;
  }[];
};

/** Engine output (or the on-screen plan with swaps applied) -> canonical. */
export function fromEnginePlan(
  plan: EngineLike,
  opts: {
    title: string;
    source?: NightPlanSource;
    savedRowId?: string | null;
    /** Preserved across a re-persist so restoring does not reset freshness. */
    createdAt?: string;
  },
): NightPlan {
  return {
    version: NIGHT_PLAN_VERSION,
    createdAt: opts.createdAt ?? new Date().toISOString(),
    title: opts.title,
    area: plan.area,
    vibe: plan.vibe,
    budget: plan.budget,
    daypart: plan.daypart,
    // The first stop's arrival IS the night's start.
    startsAt: plan.steps[0]?.arriveAt?.toISOString() ?? null,
    stops: plan.steps.map((s) => ({
      venueId: s.venue.id,
      slug: s.venue.slug,
      role: s.role,
      dwellMins: s.dwellMins,
      walkToNextMins: s.walkToNextMins,
    })),
    source: opts.source ?? "generated",
    savedRowId: opts.savedRowId ?? null,
  };
}

/**
 * A saved row -> canonical, tolerating every row already on disk.
 *
 * 🧨 BACKWARD COMPATIBILITY IS THE POINT. Six rows exist in production across
 * three accounts, written before any of this. They carry no slug, no vibe, no
 * budget, no daypart and no start time. Rather than migrate them (which needs
 * a column add and a backfill nobody has budgeted), the missing fields are
 * recovered explicitly and the recovery is visible:
 *
 *   · daypart — from the title, which is exactly what `openSaved` already did.
 *     Preserved so reopened old nights keep reading the way they read today.
 *   · vibe/budget — genuinely absent, so they take the supplied defaults. They
 *     affect REGENERATION only (which alternatives the engine offers), never
 *     how the saved night renders, and both controls are on screen for the
 *     user to correct.
 *
 * Storing them exactly would mean four nullable columns on `public.plans`.
 * That is the right eventual fix and is deliberately NOT in this change: it is
 * a schema change, and this one ships without touching the database at all.
 */
export function fromSavedRow(
  row: {
    id: string;
    title: string;
    neighbourhood: string;
    steps: unknown;
  },
  defaults: { vibe: PlanVibe; budget: PlanBudget },
): NightPlan | null {
  if (!Array.isArray(row.steps) || row.steps.length === 0) return null;

  const stops: NightPlanStop[] = [];
  for (const raw of row.steps as LegacySavedStep[]) {
    if (typeof raw !== "object" || raw === null) continue;
    if (typeof raw.venueId !== "string" || !ROLES.has(raw.role)) continue;
    stops.push({
      venueId: raw.venueId,
      // Pre-existing rows have no slug. Empty string is honest: hydration
      // falls back to the id, and a stop that resolves by neither is dropped
      // rather than rendered as a hole.
      slug: typeof raw.slug === "string" ? raw.slug : "",
      role: raw.role,
      dwellMins: typeof raw.dwellMins === "number" ? raw.dwellMins : 0,
      walkToNextMins:
        typeof raw.walkToNextMins === "number" ? raw.walkToNextMins : null,
    });
  }
  if (stops.length === 0) return null;

  return {
    version: NIGHT_PLAN_VERSION,
    // Reopening a saved night is an act of intent, so it counts as fresh from
    // this moment. The row's own created_at is when it was SAVED, which says
    // nothing about whether the user wants it tonight.
    createdAt: new Date().toISOString(),
    title: row.title,
    area: row.neighbourhood,
    vibe: defaults.vibe,
    budget: defaults.budget,
    // Same inference `openSaved` has always used, kept so reopening an old
    // night does not silently change its header.
    daypart: row.title.includes("Day Out") ? "day" : "evening",
    startsAt: null,
    stops,
    source: "saved",
    savedRowId: row.id,
  };
}

/**
 * Canonical -> the `plans.steps` payload.
 *
 * 🧨 Stays an ARRAY, and every element keeps the four legacy keys in place.
 * `slug` is additive. That means a row written today is still readable by any
 * code that predates this model, and the account-data export
 * (app/(main)/profile/actions.ts) keeps working untouched. Changing the top
 * level to an object would have been tidier and would have broken both.
 */
export function toSavedSteps(plan: NightPlan): LegacySavedStep[] {
  return plan.stops.map((s) => ({
    venueId: s.venueId,
    role: s.role,
    dwellMins: s.dwellMins,
    walkToNextMins: s.walkToNextMins,
    slug: s.slug,
  }));
}

/**
 * Hydrate stops into whatever venue objects the caller holds.
 *
 * Generic so this module never imports a Venue type — the anon flow hydrates
 * card-level previews, the signed-in flow hydrates full catalogue venues, and
 * neither shape belongs here.
 *
 * Resolution is id first, then slug. A stop that resolves by neither is
 * DROPPED, and the caller is told how many were lost: a night quietly rendered
 * with two of its three stops is worse than one that says so.
 */
export function hydrateStops<V>(
  plan: NightPlan,
  lookup: {
    byId: (id: string) => V | undefined;
    bySlug: (slug: string) => V | undefined;
  },
): {
  stops: {
    venue: V;
    role: PlanRole;
    dwellMins: number;
    walkToNextMins: number | null;
  }[];
  dropped: number;
} {
  const stops = [];
  let dropped = 0;
  for (const s of plan.stops) {
    const venue =
      lookup.byId(s.venueId) ?? (s.slug ? lookup.bySlug(s.slug) : undefined);
    if (!venue) {
      dropped++;
      continue;
    }
    stops.push({
      venue,
      role: s.role,
      dwellMins: s.dwellMins,
      walkToNextMins: s.walkToNextMins,
    });
  }
  return { stops, dropped };
}

/** Total minutes across the night: dwell plus walking. */
export function totalMins(plan: NightPlan): number {
  return plan.stops.reduce(
    (sum, s) => sum + s.dwellMins + (s.walkToNextMins ?? 0),
    0,
  );
}

/**
 * Is this night still the one the user is planning, or a stale leftover?
 *
 * A stale night must not be restored onto the result screen under "Tonight,
 * the plan:" — see NIGHT_PLAN_TTL_MS.
 */
export function isFresh(plan: NightPlan, now: number = Date.now()): boolean {
  const created = Date.parse(plan.createdAt);
  if (!Number.isFinite(created)) return false;
  // A clock that has gone backwards (timezone change, device clock reset)
  // must not make a night immortal.
  return now - created >= 0 && now - created < NIGHT_PLAN_TTL_MS;
}
