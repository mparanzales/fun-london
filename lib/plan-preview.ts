import "server-only";

// Anonymous plan preview — the engine runs SERVER-SIDE for signed-out
// visitors, because its inputs (vibe_tags, opening_hours) are moat columns
// the anon role cannot SELECT and the anon client must never receive.
//
// INVARIANT (reviewed exception — supabase-guardian gate, 2026-07-27; same
// class as fetchAllVenueSearchRows in queries.ts): this module reads moat
// columns with the SERVICE-ROLE key on behalf of ANONYMOUS visitors. That is
// acceptable ONLY because:
//   1. `import "server-only"` makes any client import a build error;
//   2. nothing raw ever escapes — the ONLY thing returned is the output of
//      toAnonPlanPayload (lib/plan-preview-shape.ts), which rebuilds stops
//      from rows via mapVenuePreview and an explicit allow-list, and is
//      pinned by lib/__tests__/plan-preview-guard.test.ts;
//   3. no service-role key configured → { ok: "unavailable" } — NEVER a
//      cookie-client fallback (a signed-in caller would widen the grants,
//      an anon caller would 42501 loudly — both wrong);
//   4. errors are caught and returned as flags, never thrown with rows
//      attached, and the payload is never logged.
// Widening what this module RETURNS is a moat decision, not a refactor.

import { createServiceClient } from "@/lib/supabase/admin";
import {
  VENUE_PLAN_COLUMNS,
  mapVenuePlan,
  type VenuePlanRow,
} from "@/lib/queries";
import {
  computePlan,
  type PlanVibe,
  type PlanBudget,
  type PlanDaypart,
} from "@/lib/plan-engine";
import { REGIONS, type PlanArea, type Region } from "@/lib/regions";
import {
  toAnonPlanPayload,
  type AnonPlanPayload,
} from "@/lib/plan-preview-shape";

// Module-level TTL cache (guardian C8, getVenueIndex pattern): a build is
// CPU-only in the warm path instead of a ~2,100-row read per request.
let cache: { at: number; rows: VenuePlanRow[] } | null = null;
const TTL_MS = 10 * 60 * 1000;

async function getPlanRows(): Promise<VenuePlanRow[] | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  const supabase = createServiceClient();
  if (!supabase) return null; // no key → caller renders a sign-in state
  const PAGE = 1000;
  const rows: VenuePlanRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("venues")
      .select(VENUE_PLAN_COLUMNS)
      .not("google_place_id", "is", null)
      .is("hidden_at", null)
      .not("img_url", "ilike", "%unsplash%")
      .neq("img_url", "")
      .order("rating", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`plan-preview rows: ${error.message}`);
    const page = (data ?? []) as VenuePlanRow[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  cache = { at: Date.now(), rows };
  return rows;
}

const VIBES: PlanVibe[] = ["Chill", "Lively", "Fancy", "Unique"];
const BUDGETS: PlanBudget[] = ["£", "££", "Any"];

export type AnonPlanInput = {
  vibe: string;
  budget: string;
  area: { kind: string; region?: string; name?: string };
  daypart?: string;
  whenISO?: string;
  offset?: number;
};

// PlanArea is a tagged union, not a string — validate the tag and each
// variant's payload instead of trusting the client's object shape.
function validArea(a: AnonPlanInput["area"]): PlanArea | null {
  if (!a || typeof a !== "object") return null;
  if (a.kind === "anywhere") return { kind: "anywhere" };
  if (a.kind === "region" && REGIONS.includes(a.region as Region))
    return { kind: "region", region: a.region as Region };
  if (
    a.kind === "neighbourhood" &&
    typeof a.name === "string" &&
    a.name.trim().length > 0 &&
    a.name.length <= 40
  )
    return { kind: "neighbourhood", name: a.name.trim() };
  return null;
}

export type AnonPlanResult =
  | ({ ok: true } & AnonPlanPayload)
  | { ok: false; reason: "unavailable" | "invalid" | "empty" | "error" };

export async function buildAnonPlanPreview(
  input: AnonPlanInput,
): Promise<AnonPlanResult> {
  try {
    // Validate EVERYTHING client-supplied (guardian C3). tasteScores is
    // hard-pinned null below and never accepted; offset is clamped to {0,1}
    // — exactly one free reshuffle (ux gate condition 2), no
    // enumeration-by-offset beyond it.
    if (!VIBES.includes(input.vibe as PlanVibe)) return invalid();
    if (!BUDGETS.includes(input.budget as PlanBudget)) return invalid();
    const area = validArea(input.area);
    if (!area) return invalid();
    const daypart: PlanDaypart | undefined =
      input.daypart === "day" || input.daypart === "evening"
        ? input.daypart
        : undefined;
    const offset = input.offset === 1 ? 1 : 0;
    // Clamp `when` to [now, now + 7d] (guardian C3): an unclamped date is an
    // opening-hours probe across arbitrary weeks.
    const now = new Date();
    let when = now;
    if (input.whenISO) {
      const parsed = new Date(input.whenISO);
      if (!isNaN(parsed.getTime())) {
        const max = now.getTime() + 7 * 24 * 60 * 60 * 1000;
        when = new Date(
          Math.min(Math.max(parsed.getTime(), now.getTime()), max),
        );
      }
    }

    const rows = await getPlanRows();
    if (!rows) return { ok: false, reason: "unavailable" };

    const rowsById = new Map(rows.map((r) => [r.id, r]));
    const plan = computePlan(rows.map(mapVenuePlan), {
      area,
      vibe: input.vibe as PlanVibe,
      budget: input.budget as PlanBudget,
      when,
      daypart,
      offset,
      tasteScores: null,
    });
    const payload = toAnonPlanPayload(plan, rowsById, now);
    if (!payload) return { ok: false, reason: "empty" };
    return { ok: true, ...payload };
  } catch {
    // Never rethrow: an error object here can carry rows into dev overlays
    // and log drains. The client renders a soft retry state.
    return { ok: false, reason: "error" };
  }
}

function invalid(): AnonPlanResult {
  return { ok: false, reason: "invalid" };
}
