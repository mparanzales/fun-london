"use client";

// Plan My Night — real recommender (Epic B). The setup form feeds the
// pure engine in lib/plan-engine.ts, which actually uses vibe + budget,
// scores venues for fit, and computes real walk times from coordinates.
//
// Extras over the old prototype port:
//   • "Try another combination" reshuffles within the same constraints.
//   • Signed-in users can save a night to public.plans and re-open it.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import {
  type LucideIcon,
  Sparkles,
  Flame,
  Gem,
  Drama,
  Map as MapIcon,
  MapPin,
  Clock,
  Footprints,
  RotateCw,
  Undo2,
  Check,
  Star,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  computePlan,
  alternativesFor,
  withinBudget,
  relinkSteps,
  isDaytimeHour,
  ANYWHERE,
  type Plan,
  type PlanBudget,
  type PlanRole,
  type PlanVibe,
  type PlanDaypart,
} from "@/lib/plan-engine";
import { regionOf, type PlanArea } from "@/lib/regions";
import {
  track,
  type SaveMode,
  type SwapMethod,
  type SetupControl,
} from "@/lib/analytics";
import { saveFailReason } from "@/lib/analytics-reasons";
import { writePlanHandoff, writeSignInTrigger } from "@/lib/analytics-keys";
import { recordSignal } from "@/lib/signals";
import { googleMapsWalkingUrl } from "@/lib/plan-maps";
import { PlanRouteMapLive } from "./plan-route-map-live";

import {
  fromEnginePlan,
  fromSavedRow,
  toSavedSteps,
  hydrateStops,
  isFresh,
  type NightPlan,
  type NightPlanSource,
} from "@/lib/night-plan";
import {
  readActivePlan,
  writeActivePlan,
  clearActivePlan,
  claimAnonPlan,
  ANON_PLAN_STASH_KEY,
  ANON_RESULT_KEY,
} from "@/lib/active-plan";
import { SwipeStop } from "./swipe-stop";
import {
  WhenPicker,
  AreaPicker,
  toISODate,
  toPlanArea,
  type WhenChoice,
  type AreaSel,
  Group,
} from "./plan-controls";
import type { Venue } from "@/lib/types";

const VIBES: { v: PlanVibe; icon: LucideIcon }[] = [
  { v: "Chill", icon: Sparkles },
  { v: "Lively", icon: Flame },
  { v: "Fancy", icon: Gem },
  { v: "Unique", icon: Drama },
];

const BUDGETS: PlanBudget[] = ["£", "££", "Any"];

// When + Area selection types/helpers (WhenChoice, WHENS, toISODate, AreaSel,
// toPlanArea) + the pickers themselves now live in ./plan-controls, shared with
// Plan Together's host settings so the two can't drift. resolveTiming below maps
// a WhenChoice to the solo plan's daypart + clock.

// Resolve a When choice into the daypart (plan shape) + the start clock the
// engine walks. `base` is the live clock, passed in so this stays pure and the
// caller controls hydration timing (no Date() before mount).
function resolveTiming(
  choice: WhenChoice,
  customDate: string,
  customTime: string,
  base: Date,
): { daypart: PlanDaypart; when: Date; tracksClock: boolean } {
  // 🧨 `tracksClock` belongs HERE, next to the branches, not at the call site.
  // Deriving it from `choice === "now"` under-detected by two thirds: "Today"
  // picked during the day, and "Tonight" picked when it is already evening,
  // both return `base` — the same snapshot of the clock — and were classed as
  // fixed times. Restoring one then pinned the When control to a stamp already
  // going stale, which is precisely what the flag exists to prevent. Computed
  // beside the branch it describes, it cannot drift from it.
  const at = (h: number, m = 0) => {
    const d = new Date(base);
    d.setHours(h, m, 0, 0);
    return d;
  };
  // 05:00–16:59 reads as "day"; from 5pm on — and through the small hours until
  // 5am — "evening" (a plan built at 1am is a night out). See isDaytimeHour.
  const isDayNow = isDaytimeHour(base.getHours());
  switch (choice) {
    case "day":
      // A daytime plan: use now if it's still daytime, else a representative 1pm.
      return {
        daypart: "day",
        when: isDayNow ? base : at(13),
        tracksClock: isDayNow,
      };
    case "evening":
      // A night out: use now if it's already evening, else 7pm tonight.
      return {
        daypart: "evening",
        when: isDayNow ? at(19) : base,
        tracksClock: !isDayNow,
      };
    case "custom": {
      // A specific calendar day + clock time. The day matters for the
      // open-at-arrival checks — venues keep different hours by weekday.
      const [h, m] = customTime.split(":").map(Number);
      const when = new Date(base);
      const [y, mo, d] = customDate.split("-").map(Number);
      if (y && mo && d) when.setFullYear(y, mo - 1, d);
      when.setHours(
        Number.isFinite(h) ? h : 20,
        Number.isFinite(m) ? m : 0,
        0,
        0,
      );
      return {
        daypart: isDaytimeHour(when.getHours()) ? "day" : "evening",
        when,
        // A specific calendar day and clock time: pinned by definition.
        tracksClock: false,
      };
    }
    default: // "now" — plan for this moment, shape follows the clock.
      return {
        daypart: isDayNow ? "day" : "evening",
        when: base,
        tracksClock: true,
      };
  }
}

// A render-ready plan shared by freshly-computed and re-opened-saved plans.
type DisplayPlan = {
  title: string;
  area: string;
  daypart: PlanDaypart;
  totalMins: number;
  steps: {
    venue: Venue;
    role: PlanRole;
    dwellMins: number;
    walkToNextMins: number | null;
    // Estimated arrival time (Stage 4.2). Present only on a freshly computed
    // plan; re-opened saved plans omit it (the time is relative to "now").
    arriveAt?: Date | null;
  }[];
};

type SavedPlanRow = {
  id: string;
  title: string;
  neighbourhood: string;
  steps: {
    venueId: string;
    role: PlanRole;
    dwellMins: number;
    walkToNextMins: number | null;
  }[];
};

function fmtHours(mins: number): string {
  const h = mins / 60;
  return `~${h.toFixed(1)} h total`;
}

// "11:01 pm" — the estimated arrival time at a stop (Stage 4.2).
function fmtTime(d: Date): string {
  return d
    .toLocaleTimeString("en-GB", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .toLowerCase();
}

// A descriptive name for saving + the saved-list (NOT the result header, which
// is the dynamic "Tonight/Today, the plan:"). plan.area is the RESOLVED pocket
// the night landed in, so a saved night reads as a real place: "Chill Night in
// Shoreditch" even when the user only picked "East" or "Anywhere".
function titleFor(plan: Plan, area: string): string {
  const kind = plan.daypart === "day" ? "Day Out" : "Night";
  const where = area === ANYWHERE ? "London" : area;
  return `${plan.vibe} ${kind} in ${where}`;
}

// A live plan, with any per-stop swaps applied. swaps[i] is the chosen
// alternative index for stop i (absent / -1 = keep the original). Swapping a
// venue changes its dwell, the walk to/from it and every downstream arrival, so
// the whole sequence is relinked (lib/plan-engine.relinkSteps) to stay honest.
// The resolved pocket (and title) follow the possibly-swapped first stop.
function toDisplay(
  plan: Plan,
  swaps: Record<number, number> = {},
  when?: Date,
): DisplayPlan {
  const items = plan.steps.map((s, i) => {
    const alt = swaps[i];
    const v = alt != null && alt >= 0 ? plan.alternatives[i]?.[alt] : undefined;
    return { venue: v ?? s.venue, role: s.role };
  });
  const steps = relinkSteps(items, when);
  const totalMins = steps.reduce(
    (sum, s) => sum + s.dwellMins + (s.walkToNextMins ?? 0),
    0,
  );
  const area = steps[0]?.venue.neighbourhood || plan.area;
  return {
    title: titleFor(plan, area),
    area,
    daypart: plan.daypart,
    totalMins,
    steps,
  };
}

/**
 * useLayoutEffect on the client, useEffect on the server.
 *
 * React warns that useLayoutEffect does nothing during SSR — true, and
 * harmless here, since the restore it drives reads localStorage and could
 * never have run on the server anyway. This keeps the warning out of the logs
 * without giving up the before-paint timing that removes the setup-form flash.
 */
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function PlanFlow({
  venues,
  authUserId,
  tasteScores,
}: {
  venues: Venue[];
  authUserId: string | null;
  tasteScores: Record<string, number> | null;
}) {
  const [step, setStep] = useState<"setup" | "result">("setup");
  const [when, setWhen] = useState<WhenChoice>("now");
  // For the "Pick a day" path: a calendar date (YYYY-MM-DD, "" = today) + time.
  const [customDate, setCustomDate] = useState<string>("");
  const [customTime, setCustomTime] = useState<string>("20:00");
  // WHERE. Defaults to Anywhere — never a single neighbourhood — so the engine
  // is free to find the best walkable pocket. (See AreaSel above.)
  const [areaSel, setAreaSel] = useState<AreaSel>({ kind: "anywhere" });
  // Set when the user picks "Near you" and the browser grants location — the
  // engine then keeps the night within a short walk of this point. Cleared
  // whenever another area is chosen.
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const [geoState, setGeoState] = useState<"idle" | "pending" | "denied">(
    "idle",
  );
  const [vibe, setVibe] = useState<PlanVibe>("Chill");
  const [budget, setBudget] = useState<PlanBudget>("££");
  const [offset, setOffset] = useState(0);
  // Per-stop swaps on the live plan: stop index → chosen alternative index
  // (absent = keep the original). Reset whenever the base plan changes.
  const [swaps, setSwaps] = useState<Record<number, number>>({});

  // The night on screen INSTEAD of the live-computed one: restored from the
  // store, claimed from an anonymous session, or re-opened from the Saved
  // list. Null means "show whatever the engine just computed".
  //
  // 🧨 ONE state, not two. The night and WHERE IT CAME FROM are a single fact,
  // and the first version of this stored them apart — `openedSaved` for the
  // plan, `activeSource` for its origin. Three call sites cleared the plan and
  // left the source behind, so after Reopen saved -> Edit -> Build the screen
  // showed a freshly generated night still locked read-only: no Save, no Try
  // another, no per-stop Change. Adding a fourth clear would have fixed that
  // instance and left the next one to be discovered the same way. Held in one
  // object, the desync is unrepresentable.
  //
  // Only a night reopened from a saved ROW is read-only, and even that now
  // means "no Save" rather than "no changes" — see `alternatives` below, which
  // gives EVERY night on screen real swap options computed from its own stops.
  //
  // `base` is the night as it was activated. Per-stop replacements are held in
  // `swaps` on top of it, exactly as they are for a live night on top of
  // `computed`, so one mechanism serves both and one Undo unwinds both.
  const [active, setActive] = useState<{
    base: DisplayPlan;
    source: NightPlanSource;
  } | null>(null);
  const openedSaved = active?.base ?? null;
  const isReopenedSaved = active?.source === "saved";
  // Previous `swaps` states, newest last. One entry per replacement, so Undo
  // walks back through them rather than only reverting the last one — a user
  // who taps Change four times and dislikes the third needs more than a single
  // step back, and the alternative (cycling forward until it wraps) makes them
  // count positions in a list they cannot see.
  const [undoStack, setUndoStack] = useState<Record<number, number>[]>([]);
  const [savedPlans, setSavedPlans] = useState<SavedPlanRow[]>([]);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
    "idle",
  );

  // ── Analytics-only refs (no product behaviour depends on these) ──────
  // Fire-once latch for plan_setup_started. A ref, not state: flipping it must
  // not re-render, and it must survive the input edits that reset saveState.
  const setupStartedRef = useRef(false);
  // Save attempt counter. Lives outside saveState because saveState is reset to
  // "idle" by every input edit and by a reshuffle, so it cannot count retries.
  const saveAttemptRef = useRef(0);
  // True when this night began life as an anonymous preview carried through
  // the sign-in round trip. Rides on the save events as `anon_origin`; the
  // `plan_origin` dimension carries the finer distinction between a live,
  // restored, claimed and reopened night.
  const anonOriginRef = useRef(false);
  // Standing the restored night down also ends its provenance. Without this,
  // claim -> "Try another combination" -> Save sent anon_origin: true on a
  // night generated ten seconds earlier — a wrong dimension, which this file
  // argues elsewhere is worse than a missing one.
  const standDown = useCallback(() => {
    setActive(null);
    anonOriginRef.current = false;
    activeSourcePlanRef.current = null;
    // The replacement history belongs to the night being stood down.
    setUndoStack([]);
  }, []);
  // 🧨 Freshness is measured from GENERATION, not from the last write. The
  // effect below re-persists on every swap, and stamping a fresh createdAt
  // there would push the 12h window out each time the user fiddled with a
  // stop — a Friday night would still read as fresh on Sunday. Keyed on the
  // engine result's identity, so it survives swaps and resets exactly when the
  // engine actually produces a different night.
  const genStampRef = useRef<{ src: Plan | null; at: string }>({
    src: null,
    at: "",
  });
  // Whether the saved-plans list actually loaded. loadSavedPlans swallows its
  // error, so without this a failed load would make every save look like "new".
  const savedListLoadedRef = useRef(false);

  // Current time, set AFTER mount so the open-now plan filter can't cause an
  // SSR/client hydration mismatch: the server renders fail-open (when=undefined),
  // then the client applies real opening hours once mounted.
  const [now, setNow] = useState<Date | undefined>(undefined);
  useEffect(() => setNow(new Date()), []);

  const venueBySlug = useMemo(() => {
    const m = new Map<string, Venue>();
    for (const v of venues) m.set(v.slug, v);
    return m;
  }, [venues]);

  const venueById = useMemo(() => {
    const m = new Map<string, Venue>();
    for (const v of venues) m.set(v.id, v);
    return m;
  }, [venues]);

  // Today's date (YYYY-MM-DD), known post-mount — the floor for the date picker
  // (no planning the past) and its default when the user hasn't picked one.
  const todayISO = now ? toISODate(now) : "";

  // Resolve the When answer into (daypart, start clock) once the live clock is
  // known (post-mount). null before mount → engine infers + fails open on hours,
  // matching the SSR render so there's no hydration mismatch.
  const timing = useMemo(
    () =>
      now ? resolveTiming(when, customDate || todayISO, customTime, now) : null,
    [when, customDate, todayISO, customTime, now],
  );

  const computed = useMemo(
    () =>
      computePlan(venues, {
        area: toPlanArea(areaSel),
        vibe,
        budget,
        offset,
        when: timing?.when,
        daypart: timing?.daypart,
        center: areaSel.kind === "nearYou" ? center : null,
        tasteScores,
      }),
    [venues, areaSel, vibe, budget, offset, timing, center, tasteScores],
  );

  /**
   * Swap options for the night on screen.
   *
   * 🧨 A RESTORED NIGHT GETS ITS OWN, computed from its own stops. It used to
   * get none: `computed.alternatives` is indexed to the stops the ENGINE last
   * produced, so on any other night `alternatives[i]` describes a different
   * stop i entirely, and offering it could swap in a venue picked for a walk
   * that no longer exists. The previous release hid the control rather than
   * risk that, which left a night you could look at and not touch — and the
   * swipe silently did nothing, which reads as a dead target rather than as a
   * decision. `alternativesFor` makes the mismatch impossible instead: the
   * options are always derived from the stops they belong to.
   *
   * Derived from `base`, not from `display`, for the same reason the live path
   * indexes `computed`: if the list were recomputed after each replacement,
   * position 2 would mean a different venue every time and cycling could never
   * return you to where you started.
   */
  const activeAlternatives = useMemo(() => {
    if (!active) return null;
    // Mirror the engine's own widening: keep the budget unless honouring it
    // would leave too little to choose from.
    const inBudget = venues.filter((v) => withinBudget(v.price, budget));
    return alternativesFor(
      inBudget.length >= 3 ? inBudget : venues,
      active.base.steps,
      {
        vibe,
        budget,
        daypart: active.base.daypart,
        when: timing?.when,
        tasteScores,
      },
    );
  }, [active, venues, budget, vibe, timing, tasteScores]);

  const alternatives = activeAlternatives ?? computed.alternatives;

  // Memoised because the persist effect below depends on it: an unmemoised
  // `display` is a new object every render, so the effect's dep array never
  // matched and a synchronous localStorage write fired on every single render
  // of the result screen.
  const display: DisplayPlan = useMemo(() => {
    if (!active) return toDisplay(computed, swaps, timing?.when);
    // Same shape as toDisplay, over the restored night's own base and options.
    // relinkSteps is what keeps a replacement honest: it recomputes dwell, the
    // walk to the NEXT stop and every arrival after it, in place, so the route
    // stays coherent and the map (which renders display.steps) follows.
    const items = active.base.steps.map((s, i) => {
      const alt = swaps[i];
      const v =
        alt != null && alt >= 0 ? activeAlternatives?.[i]?.[alt] : undefined;
      return { venue: v ?? s.venue, role: s.role };
    });
    const steps = relinkSteps(items, timing?.when);
    return {
      // Title and area stay the night's own. A reopened "Fancy Night in
      // Shoreditch" that swaps one stop is still that night; re-deriving them
      // from the first stop the way a freshly generated plan does would rename
      // the thing the user saved out from under them.
      title: active.base.title,
      area: active.base.area,
      daypart: active.base.daypart,
      totalMins: steps.reduce(
        (sum, s) => sum + s.dwellMins + (s.walkToNextMins ?? 0),
        0,
      ),
      steps,
    };
  }, [active, activeAlternatives, computed, swaps, timing]);

  // Editorial eyebrow, same convention as the Explore header: 06:00–17:59 reads
  // "today,", 18:00–05:59 "tonight,". `now` is null until mount, so SSR + first
  // client render agree (default "tonight,") and it settles after mount.
  const eyebrow =
    now && now.getHours() >= 6 && now.getHours() < 18 ? "today," : "tonight,";

  // 🧨 DERIVED, not per-mount state. `saveState` resets to "idle" on every
  // mount, so a night that had been saved came back after a refresh or a tap
  // through to a venue reading "Save this night" — and tapping it inserted a
  // SECOND identical row. `public.plans` is insert-only and the app has no
  // delete, so "Your saved nights" filled with duplicates the user could not
  // remove, degrading the entry point to the whole saved-night loop. The
  // signature was already computed inside onSave for analytics; it just never
  // reached the button.
  // Known limits, both failing SAFE: the signature is venue ids in order, so
  // the same three venues rebuilt for a different DAY read as already saved
  // (plans stores no start time to tell them apart); and it is false while
  // loadSavedPlans is still in flight, so a fast double-tap can still
  // duplicate. Under-saving is recoverable in one tap; the duplicate rows this
  // replaced were not recoverable at all.
  const planSignature = display.steps.map((s) => s.venue.id).join("|");
  const alreadySaved = savedPlans.some(
    (p) => p.steps.map((s) => s.venueId).join("|") === planSignature,
  );

  // ── Saved plans (signed-in only) ────────────────────────────────────
  const loadSavedPlans = useCallback(async () => {
    if (!authUserId) return;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("plans")
      .select("id,title,neighbourhood,steps")
      .eq("user_id", authUserId)
      .order("created_at", { ascending: false });
    if (error) {
      console.error("[plans] load failed:", error);
      savedListLoadedRef.current = false;
      return;
    }
    savedListLoadedRef.current = true;
    setSavedPlans((data as SavedPlanRow[]) ?? []);
  }, [authUserId]);

  useEffect(() => {
    void loadSavedPlans();
  }, [loadSavedPlans]);

  const onSave = async () => {
    if (!authUserId || saveState === "saving") return;
    setSaveState("saving");

    // ── Analytics: the save split ────────────────────────────────────
    // Coarse shape shared by all three save events. Deliberately identical to
    // the prop bag the legacy plan_save already sent, so a dashboard can be
    // migrated without losing a dimension. No title, no venue names, no ids.
    const swapCount = Object.values(swaps).filter((v) => v >= 0).length;
    const mode: SaveMode = alreadySaved
      ? "duplicate"
      : swapCount > 0
        ? "resave_after_swap"
        : offset > 0
          ? "resave_after_reshuffle"
          : "new";
    const attempt = ++saveAttemptRef.current;
    // 🧨 PROVENANCE. `display` is the night being saved; `computed` is the
    // night the engine last generated. For a live plan they are the same. For
    // a RESTORED one they are not — a restored generated or claimed night is
    // savable (that is the whole conversion path), and the engine has kept
    // running behind it against controls that were only partly re-seeded: the
    // area deliberately is not, so `computed.daypart` can read "day" under an
    // evening night. So everything describing the saved night comes from
    // `display` or from the controls the user can see, and the pool statistics
    // — which describe a generation that did not produce this night — are null
    // rather than borrowed. A wrong dimension is worse than a missing one; a
    // dashboard will happily break down by it.
    const live = active === null;
    const saveProps = {
      area: display.area,
      vibe,
      budget,
      daypart: display.daypart,
      stops: display.steps.length, // legacy spelling, kept for continuity
      stop_count: display.steps.length,
      swapped: swapCount,
      poolStage: live ? computed.poolStage : null, // legacy spelling
      pool_stage: live ? computed.poolStage : null,
      poolSize: live ? computed.poolSize : null, // legacy spelling
      pool_size: live ? computed.poolSize : null,
      // live | generated | anon | saved — lets the null pool stats above be
      // read as "not applicable" rather than "instrumentation broke".
      plan_origin: active?.source ?? "live",
      mode,
      attempt,
      anon_origin: anonOriginRef.current,
      saved_list_loaded: savedListLoadedRef.current,
    };
    // Intent. Fires AFTER the guard above, so the count can be compared
    // directly against the insert count. Firing above the guard would
    // double-count a double tap that the guard already swallowed.
    track("plan_save_tapped", saveProps);

    const supabase = createClient();
    // Save what's ON SCREEN — i.e. with any per-stop swaps applied (`display`).
    const names = display.steps.map((s) => s.venue.name).join(" → ");
    const where = display.area === ANYWHERE ? "London" : display.area;
    const kind = display.daypart === "day" ? "day out" : "night";
    // `status` is destructured purely to bucket a failure (0 = never left the
    // device, 401/403 = expired session, 429 = throttled, 5xx = server).
    const { error, status } = await supabase.from("plans").insert({
      user_id: authUserId,
      title: display.title,
      neighbourhood: display.area,
      why_it_works: `A ${vibe.toLowerCase()} ${where} ${kind}: ${names}.`,
      // Canonical adapter. Still an ARRAY with the same four legacy keys, plus
      // `slug` — so a row written today is readable by anything that predates
      // the model, including the account-data export. See lib/night-plan.ts.
      // 🧨 Built from what is ON SCREEN, never spread from `computed`. The
      // spread put the LIVE engine run's vibe, budget and daypart on a
      // restored night's adapter — the exact "stale generation metadata" this
      // model exists to remove. It leaked nothing only because toSavedSteps
      // throws those three away; the moment anyone widens it (which the
      // schema note in lib/night-plan.ts anticipates), a reopened evening
      // night saves as a day out with no test failing.
      steps: toSavedSteps(
        fromEnginePlan(
          {
            area: display.area,
            vibe,
            budget,
            daypart: display.daypart,
            steps: display.steps.map((s) => ({
              ...s,
              arriveAt: s.arriveAt ?? null,
            })),
          },
          {
            title: display.title,
            offset,
            tracksClock: timing?.tracksClock ?? true,
          },
        ),
      ),
    });
    if (error) {
      console.error("[plans] save failed:", error);
      setSaveState("idle");
      // Only the mapped category and the SQLSTATE code. Never error.message,
      // never error.details (a full stack trace on the network path), never
      // error.hint. See lib/analytics-reasons.ts.
      track("plan_save_failed", {
        ...saveProps,
        reason: saveFailReason(error.code, status),
        pg_error_code: typeof error.code === "string" ? error.code : "none",
      });
      return;
    }
    setSaveState("saved");
    recordSignal("plan_completed", { surface: "plan" });
    // Fires only after the insert came back clean, so this is confirmed
    // persistence rather than intent.
    track("plan_save_succeeded", saveProps);
    // DEPRECATED dual-emit until 2026-09-30. Every existing PostHog insight and
    // Vercel series keys on "plan_save", so it cannot be renamed in place. New
    // dashboards must count plan_save_succeeded and must NOT also count this,
    // or every save appears twice.
    track("plan_save", saveProps);
    void loadSavedPlans();
  };

  // ── The active night ────────────────────────────────────────────────
  //
  // One path for every way a night arrives: generated, restored after a
  // refresh, reopened from Saved, or claimed after signing in. They all become
  // a NightPlan first (lib/night-plan.ts) and are hydrated against THIS
  // catalogue, so there is a single place where a stale venue id is handled.
  const owner = authUserId ?? null;

  const activate = useCallback(
    (np: NightPlan): boolean => {
      const { stops, dropped } = hydrateStops<Venue>(np, {
        byId: (id) => venueById.get(id),
        bySlug: (slug) => venueBySlug.get(slug),
      });
      // A night whose venues have all left the catalogue is not a night.
      if (stops.length === 0) return false;

      // 🧨 RELINK when a stop was dropped. Without this the survivors keep the
      // walk time that was measured to the venue that just disappeared, and
      // the header keeps the full night's duration — so a 3-stop night that
      // loses its middle stop renders "~6 min walk" between two venues that
      // may be 25 minutes apart, while the map draws the real leg. A short
      // night is honest; a wrong walk time is not.
      // 🧨 ALWAYS relink, and relink from the night's OWN start time. A
      // NightPlan stores `startsAt` but no per-stop arrivals, so a restored
      // night rendered with no "arrive ~7:00 pm" line at all: the same night
      // lost its clock the moment you refreshed or tapped through to a venue.
      // relinkSteps recomputes arrivals from the start, and — the reason it
      // was already called on the dropped path — keeps walk times honest when
      // a stop has left the catalogue.
      // 🧨 ...but only while the night is still ahead of us. Restoring a
      // 2pm day-out at 10pm rendered "arrive ~2:00 pm" under "Today, the
      // plan:" — confidently wrong, where showing nothing is merely vague. If
      // the whole night has already finished, drop the clock and keep the
      // stops. A night still IN PROGRESS keeps its times: the remaining stops
      // are the point.
      const start = np.startsAt ? new Date(np.startsAt) : undefined;
      let steps = relinkSteps(stops, start);
      if (start) {
        const endsAt =
          start.getTime() +
          steps.reduce(
            (sum, s) => sum + s.dwellMins + (s.walkToNextMins ?? 0),
            0,
          ) *
            60_000;
        if (endsAt < Date.now()) steps = relinkSteps(stops, undefined);
      }
      if (dropped > 0) {
        track("plan_restored_partial", {
          dropped,
          kept: steps.length,
          source: np.source,
        });
      }

      setActive({
        base: {
          title: np.title,
          area: np.area,
          daypart: np.daypart,
          totalMins: steps.reduce(
            (sum, s) => sum + s.dwellMins + (s.walkToNextMins ?? 0),
            0,
          ),
          steps,
        },
        source: np.source,
      });
      // Seed the vibe/budget controls so the brief behind the night is what
      // the user sees, and so "try again" regenerates something comparable
      // rather than whatever the controls happened to be left on.
      //
      // 🧨 The AREA control IS seeded now, as a neighbourhood. It deliberately
      // was not, on the reasoning that a NightPlan carries only the resolved
      // area STRING so mapping back has to guess between "region" and
      // "neighbourhood". That reasoning was sound while nothing on a restored
      // night could regenerate. "Try another combination" is on every night
      // now, so NOT guessing is itself a guess — and the worse one: reopening
      // "A Lively Night in Shoreditch" and tapping it returned a night
      // anywhere in London, which is not another take on THIS night at all.
      // A wrong guess widens the pool and the engine still returns a night; no
      // guess changes the brief out from under the user.
      activeSourcePlanRef.current = np;
      // A newly activated night starts with no replacements and no history.
      setSwaps({});
      setUndoStack([]);
      setVibe(np.vibe);
      setBudget(np.budget);
      // The night's own daypart, so "Try another combination" regenerates
      // against the brief on screen rather than against "Right now". Left at
      // "now", a restored evening night reshuffled into a daytime one under a
      // header still reading "Tonight,". WhenChoice's "day"/"evening" map 1:1
      // onto the daypart; the AREA control still cannot be mapped back (see
      // above), which is why this is a partial re-seed rather than a full one.
      // 🧨 ...and its DATE, when it has one. `setWhen(daypart)` alone meant a
      // night built for next Saturday 20:00 restored perfectly — right stops,
      // right arrivals — and then "Try another combination" regenerated for
      // TONIGHT: different venues, different opening-hours filtering, and no
      // date anywhere on screen to reveal the swap. startsAt is already
      // stored; the controls just were not being fed from it.
      // 🧨 Seed the clock whenever the night was planned for a SPECIFIC time,
      // not only when that time is on another day. Gating on the date alone
      // meant a night built for today at 22:00 restored as `when: "evening"`
      // and reshuffled from 19:00 — a silent three-hour swap, the same class
      // of bug this block exists to fix, just inside one day.
      //
      // A "Right now" night is the exception: its start is its build time, so
      // it must keep tracking the live clock rather than pinning to a stamp
      // that is already going stale. The night records that intent itself
      // (`tracksClock`) — see lib/night-plan.ts for why inferring it from the
      // two timestamps was wrong on this surface.
      const startDate = np.startsAt ? new Date(np.startsAt) : null;
      const wasRightNow = np.tracksClock;
      // A night still running after midnight would seed YESTERDAY, below the
      // picker's floor, and then plan for a time already past.
      const inThePast =
        !!startDate && toISODate(startDate) < toISODate(new Date());
      if (startDate && !wasRightNow && !inThePast) {
        setWhen("custom");
        setCustomDate(toISODate(startDate));
        setCustomTime(
          `${String(startDate.getHours()).padStart(2, "0")}:${String(
            startDate.getMinutes(),
          ).padStart(2, "0")}`,
        );
      } else {
        setWhen(np.daypart);
      }
      // Resume the reshuffle sequence rather than replaying it. computePlan is
      // deterministic per offset, so restoring at 0 made someone who had
      // reshuffled three times re-reject those same three nights.
      setOffset(np.offset);
      // Only when `regionOf` resolves it. REGION_OF is a hand-maintained map
      // over a crawl-grown catalogue, so an unmapped neighbourhood is normal —
      // and it renders the Area chip highlighted but labelled the literal word
      // "Area", with no drill-down, pinning the user to a selection they can
      // neither see nor change. The engine copes (it widens the pool); the
      // picker does not.
      const region = np.area ? regionOf(np.area) : null;
      setAreaSel(
        region
          ? { kind: "neighbourhood", name: np.area }
          : { kind: "anywhere" },
      );
      setStep("result");

      // 🧨 A REOPENED SAVED ROW IS NOT PERSISTED HERE. The active slot holds
      // the night you are WORKING on; a saved row is already durable in the
      // database and one tap away in "Your saved nights". Storing it made the
      // read-only state sticky: for the next 12 hours every visit to /plan
      // landed on a night with no Save, no Try another and no per-stop
      // Change, and the only way out was Edit -> Build. Glancing at a saved
      // night should not take the surface hostage.
      if (np.source === "saved") {
        // Entries written by the build BEFORE this rule existed are still in
        // people's browsers, and returning early would leave them there —
        // read-only stickiness for another 12 hours post-deploy. But clear
        // ONLY a stored saved night: an unconditional clear meant that
        // glancing at a saved night destroyed the unsaved one you had in
        // progress, which is a worse bug than the one being fixed.
        if (readActivePlan(owner)?.source === "saved") clearActivePlan(owner);
        return true;
      }

      // Re-persist from the HYDRATED venues, so an anon-origin night (whose
      // ids are slugs) is re-keyed to real catalogue ids, and so a night that
      // lost stops is stored in its relinked form rather than its stale one.
      writeActivePlan(owner, {
        ...np,
        stops: steps.map((s) => ({
          venueId: s.venue.id,
          slug: s.venue.slug,
          role: s.role,
          dwellMins: s.dwellMins,
          walkToNextMins: s.walkToNextMins,
        })),
      });
      return true;
    },
    [venueById, venueBySlug, owner],
  );

  // A saved row the user tapped while an unsaved night was still in the active
  // slot. Held until they choose, rather than resolved by guessing.
  const [pendingSaved, setPendingSaved] = useState<SavedPlanRow | null>(null);

  const openSaved = (row: SavedPlanRow) => {
    // 🧨 REOPENING USED TO DESTROY AN UNSAVED NIGHT IN SILENCE. Two taps from a
    // live result — "← Edit", then a row in this list — overwrote the active
    // slot, and the night built ten seconds earlier was unrecoverable by
    // refresh or Back. Both nights are legitimate here, so this asks instead
    // of picking one: the saved row is durable in the database and losing it
    // costs nothing, while the night in the slot exists nowhere else.
    const existing = readActivePlan(owner);
    const existingSig = existing?.stops.map((s) => s.venueId).join("|");
    const atRisk =
      !!existing &&
      existing.source !== "saved" &&
      !savedPlans.some(
        (p) => p.steps.map((s) => s.venueId).join("|") === existingSig,
      );
    if (atRisk && !pendingSaved) {
      setPendingSaved(row);
      track("plan_reopen_conflict", { stops: existing.stops.length });
      return;
    }
    setPendingSaved(null);
    reallyOpenSaved(row);
  };

  const reallyOpenSaved = (row: SavedPlanRow) => {
    // Saved rows carry no vibe or budget (see lib/night-plan.ts), so the
    // current control values stand in. They affect regeneration only.
    const np = fromSavedRow(
      {
        id: row.id,
        title: row.title,
        neighbourhood: row.neighbourhood,
        steps: row.steps,
      },
      { vibe, budget },
    );
    if (!np) return;
    activate(np);
  };

  // ── Restore, and claim an anonymous night ───────────────────────────
  //
  // Runs once per owner. Two things happen here, in order:
  //
  //   1. If this browser has an anonymous night and the user has just signed
  //      in, it is CLAIMED into their own slot. This is the "I built a night,
  //      then signed up to save it" path — previously a bespoke one-shot
  //      stash, now the same store as everything else.
  //   2. Otherwise, whatever night this owner already had is restored.
  //
  // Owner-scoped keys mean a signed-out visitor can never restore the previous
  // user's night on a shared browser (lib/active-plan.ts).
  // The NightPlan a restored night came from, so re-persisting it after a
  // replacement carries its own createdAt, source, offset and clock intent
  // instead of minting fresh ones — which would restart the freshness window
  // and relabel its provenance on every change.
  const activeSourcePlanRef = useRef<NightPlan | null>(null);
  const restoredForRef = useRef<string | null | undefined>(undefined);
  // 🧨 BEFORE THE BROWSER PAINTS, not after. `step` initialises to "setup", so
  // running this as a normal effect meant the setup form was painted first and
  // then replaced — on the refresh, the walk back from a venue page and the
  // post-sign-in landing, i.e. the three moments this whole feature exists
  // for, the first thing on screen was the tall questionnaire the user had
  // already filled in. It read as "it forgot", which is precisely the feeling
  // being removed. useLayoutEffect runs synchronously after the DOM is
  // committed and before paint, so the swap is never visible; browser scroll
  // restoration then lands on the result markup rather than the form.
  useIsomorphicLayoutEffect(() => {
    // Wait for the catalogue: hydrating against an empty list would drop every
    // stop and look identical to "there was nothing saved".
    if (venues.length === 0) return;
    if (restoredForRef.current === owner) return;
    restoredForRef.current = owner;

    // 🧨 The signed-out result screen is anon-scoped and must not survive into
    // a signed-in session — otherwise it is still there after sign-out, ready
    // to rehydrate onto the next person on this browser. claimAnonPlan clears
    // it when there is something to claim; this covers the case where there
    // was not (a failed canonical write, an older build), so no path leaves it
    // behind.
    if (owner) {
      try {
        window.localStorage.removeItem(ANON_RESULT_KEY);
      } catch {
        /* private mode */
      }
    }
    const claimed = owner ? claimAnonPlan(owner) : null;
    if (claimed) {
      // The canonical claim has won. Drop the legacy one-shot stash so the
      // older effect below cannot restore a coarser copy of the same night
      // over the top of it and double-fire the analytics.
      try {
        window.localStorage.removeItem(ANON_PLAN_STASH_KEY);
      } catch {
        /* private mode */
      }
      // 🧨 THE CLAIM IS SUBJECT TO THE SAME FRESHNESS GATE AS A RESTORE. It
      // was not, and an anonymous night is the one most likely to be old:
      // someone builds a night on a Tuesday, does not sign in, and creates an
      // account three weeks later. That claim put a three-week-old night on
      // the result screen under "Tonight, the plan:" with opening hours
      // checked three weeks ago, counted it as a conversion, and then — since
      // it re-persists with the ORIGINAL createdAt — had the next mount's
      // restore path reject it as stale. The night appeared exactly once and
      // silently vanished. isFresh must be checked at BOTH call sites; the
      // unit test on isFresh cannot see which ones exist.
      //
      // claimAnonPlan is destructive on the anon side before we get here, so
      // a stale claim clears the owner slot rather than being handed back.
      if (!isFresh(claimed) || !activate(claimed)) {
        clearActivePlan(owner);
        return;
      }
      anonOriginRef.current = true;
      track("plan_anon_claimed", { stops: claimed.stops.length });
      return;
    }
    const existing = readActivePlan(owner);
    if (!existing) return;
    // A stale night must not be restored onto the result screen under
    // "Tonight, the plan:" with opening hours that were checked days ago.
    if (!isFresh(existing)) {
      clearActivePlan(owner);
      return;
    }
    if (!activate(existing)) clearActivePlan(owner);
  }, [owner, venues.length, activate]);

  // Persist whatever is on screen, so a refresh, a tap through to a venue and
  // the journey back, or the sign-in round trip all return to the same night.
  useEffect(() => {
    if (step !== "result") return;
    // A REOPENED SAVED ROW is never stored as the active night — the row is
    // already durable in the database, and storing it made the read-only state
    // land on every later visit to /plan.
    if (active?.source === "saved") return;
    // Any other restored night IS re-persisted, from `display`, so a per-stop
    // replacement survives a refresh and the walk to a venue page. Writing
    // from `computed` here would overwrite it with the unrelated night the
    // engine happens to be holding, which is why this used to bail out
    // entirely — correct while a restored night could not be changed, wrong
    // now that it can.
    if (active) {
      const src = activeSourcePlanRef.current;
      // No source plan means the night came from the legacy one-shot stash,
      // which carries none of these fields. Leave it alone rather than mint a
      // NightPlan with invented provenance.
      if (!src || display.steps.length === 0) return;
      writeActivePlan(owner, {
        ...src,
        title: display.title,
        area: display.area,
        daypart: display.daypart,
        startsAt: display.steps[0]?.arriveAt?.toISOString() ?? null,
        stops: display.steps.map((s) => ({
          venueId: s.venue.id,
          slug: s.venue.slug,
          role: s.role,
          dwellMins: s.dwellMins,
          walkToNextMins: s.walkToNextMins,
        })),
      });
      return;
    }
    // 🧨 A zero-stop result is the dead-end screen, not a night. This effect
    // runs ABOVE that screen's early return, so without this a good stored
    // night was destroyed by a failed build: Edit -> pick an empty area ->
    // Build wrote `stops: []` over it, and the next load could not parse the
    // result and cleared the slot. Losing the night to a search that found
    // nothing is the worst possible moment to lose it.
    if (display.steps.length === 0) return;
    if (genStampRef.current.src !== computed) {
      genStampRef.current = { src: computed, at: new Date().toISOString() };
    }
    writeActivePlan(
      owner,
      fromEnginePlan(
        {
          ...computed,
          // 🧨 `display.area`, not `computed.area`. toDisplay re-derives the
          // area from the FIRST STOP, so once a swap changes stop 1 the header
          // reads "Soho" while the engine's resolved pocket still says
          // "Fitzrovia". Persisting the engine's value made a restored night
          // rename itself on reload.
          area: display.area,
          steps: display.steps.map((s) => ({
            ...s,
            arriveAt: s.arriveAt ?? null,
          })),
        },
        {
          title: display.title,
          createdAt: genStampRef.current.at,
          offset,
          tracksClock: timing?.tracksClock ?? true,
        },
      ),
    );
    // `offset` and `timing` are both already implied by `computed` (it takes
    // the offset and derives from the same timing), but listed so the
    // persisted reshuffle position and clock intent cannot silently go stale
    // if that ever stops being true.
  }, [step, active, computed, display, owner, offset, timing]);

  // Hydrate a night built while signed OUT. The anon /plan flow stashes its
  // result in localStorage before the sign-in round-trip (three navigations
  // through /auth/callback destroy all client state); without this, a user
  // who signs up specifically to SAVE the night they just built lands back
  // on empty setup controls — the gate review's single worst conversion
  // moment (ux condition 1, 2026-07-27). Same resolution path as openSaved:
  // slugs → this catalogue → a DisplayPlan, then straight to the result.
  useEffect(() => {
    if (!authUserId) return;
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(ANON_PLAN_STASH_KEY);
      if (raw) window.localStorage.removeItem(ANON_PLAN_STASH_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    try {
      const stash = JSON.parse(raw) as {
        stops?: {
          slug: string;
          role: string;
          dwellMins: number;
          walkToNextMins: number | null;
        }[];
        area?: string;
        daypart?: string;
        savedAt?: number;
      };
      if (!stash?.savedAt || Date.now() - stash.savedAt > 60 * 60 * 1000)
        return;
      const bySlug = new Map(venues.map((v) => [v.slug, v]));
      const steps = (stash.stops ?? [])
        .map((s) => {
          const venue = bySlug.get(s.slug);
          return venue
            ? {
                venue,
                role: s.role as PlanRole,
                dwellMins: s.dwellMins,
                walkToNextMins: s.walkToNextMins,
              }
            : null;
        })
        .filter((s): s is DisplayPlan["steps"][number] => s !== null);
      if (steps.length === 0) return;
      const totalMins = steps.reduce(
        (sum, s) => sum + s.dwellMins + (s.walkToNextMins ?? 0),
        0,
      );
      const daypart = stash.daypart === "day" ? "day" : "evening";
      setActive({
        base: {
          title: `${stash.area || "London"} ${daypart === "day" ? "Day Out" : "Night"}`,
          area: stash.area || "London",
          daypart,
          totalMins,
          steps,
        },
        // The legacy stash only ever held an anonymous preview.
        source: "anon",
      });
      setStep("result");
      // This night came from an anonymous preview. Recorded as a boolean on
      // the save events rather than a SaveMode value, alongside `plan_origin`.
      anonOriginRef.current = true;
      track("plan_stash_restored", { stops: steps.length });
    } catch {
      /* corrupt stash — ignore */
    }
    // Run once per signed-in mount; venues is stable for the page's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUserId]);

  // Editing any input invalidates a re-opened saved plan, the saved flag, and
  // any per-stop swaps (the base plan is about to change).
  const editInputs = (fn: () => void, control: SetupControl = "where") => {
    // plan_setup_started, fired ONCE. editInputs is the single choke point for
    // every setup control on this surface (When, Where, Vibe, Budget) and is
    // called from nothing else, so the latch here cannot be reached by a page
    // load, by the stash/saved-plan restore paths, or by the Build button.
    //
    // Known and accepted: the latch is per-MOUNT. A visitor who builds
    // anonymously, signs in, and lands on a fresh PlanFlow can produce a second
    // event. And a visitor who accepts every default emits plan_generate with
    // no preceding setup event, so setup -> generate is a leaky funnel by
    // construction. Both are documented in the event dictionary; neither is
    // fixable without firing on Build, which would defeat the point.
    if (!setupStartedRef.current) {
      setupStartedRef.current = true;
      // 🧨 The payload carries WHICH CONTROL was touched first, and no
      // dimension values. The obvious version of this event sent area_kind /
      // vibe / budget / when, and every one of them was WRONG BY
      // CONSTRUCTION: track() runs before fn() applies the selection, and the
      // latch fires only once, so all four were pinned to the mount-time
      // defaults on 100% of events. A property that is constant on every event
      // is worse than a missing one, because a dashboard will happily break
      // down by it. The chosen values already ride on plan_generate.
      track("plan_setup_started", {
        plan_surface: "solo",
        first_control: control,
      });
    }
    standDown();
    setSaveState("idle");
    setSwaps({});
    setUndoStack([]);
    fn();
  };

  // "Change this one" — cycle stop `i` through its alternatives (dir +1 = next,
  // −1 = previous), wrapping through the original. relinkSteps (via toDisplay)
  // keeps the walk + arrivals + map honest after the swap.
  const onSwap = (
    i: number,
    dir: 1 | -1 = 1,
    method: SwapMethod = "button",
  ) => {
    // `alternatives`, not `computed.alternatives`: on a restored night these
    // are computed from that night's own stops, and on a live one they ARE
    // computed.alternatives, so this single path serves both.
    const alts = alternatives[i] ?? [];
    if (alts.length === 0) return;
    // 🧨 COMPUTED HERE, NOT INSIDE A setSwaps UPDATER. The first version
    // pushed the undo entry from inside the updater, on the reasoning that it
    // could not then capture a stale `swaps`. But a state updater must be
    // pure: StrictMode double-invokes it (this repo enables it), so every
    // replacement recorded TWO undo entries and the first tap of Undo appeared
    // to do nothing. Each replacement is its own click and therefore its own
    // render, so reading `swaps` from the closure is correct.
    const prev = swaps;
    // Positions 0..len-1: 0 = original venue, 1..len-1 = alternatives.
    const len = alts.length + 1;
    const pos = ((((prev[i] ?? -1) + 1 + dir) % len) + len) % len;
    const idx = pos - 1; // −1 = back to the original
    const next = { ...prev };
    if (idx < 0) delete next[i];
    else next[i] = idx;
    setSwaps(next);
    // Where we came FROM, so Undo restores this exact arrangement.
    setUndoStack((stack) => [...stack, prev]);
    setSaveState("idle");
    // `method` is passed in by the caller, never derived from `dir`: a LEFT
    // swipe and the Change button's default argument both produce dir === 1.
    // `stop_role` ships alongside stop_index because the group surface filters
    // roles by hearted moods, so index 0 there is not necessarily the opener.
    // Without the role, solo and group merge into a wrong conclusion.
    track("plan_swap", {
      stop: i, // legacy spelling, kept so existing insights keep working
      stop_index: i,
      // From the night ON SCREEN. Reading computed.steps here would report the
      // live engine's role for a stop the user is changing on a restored one.
      stop_role: display.steps[i]?.role ?? null,
      dir,
      method,
    });
  };

  // Step back through replacements, one at a time. Not a full reset: undoing
  // to the original is what tapping Change until it wraps already does, and
  // the thing a user actually wants is "that last one was worse".
  const undoReplace = () => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack((stack) => stack.slice(0, -1));
    setSwaps(prev);
    setSaveState("idle");
    track("plan_swap_undo", { remaining: undoStack.length - 1 });
  };

  // "Near you" — ask the browser for location and keep the night within walking
  // distance of it. On denial/failure fall back to Anywhere so a plan still
  // builds (just London-wide) rather than dead-ending. Anywhere / region / spot
  // selections go through AreaPicker → onChange, which clears any near-you point.
  const pickNearYou = () => {
    editInputs(() => {
      setAreaSel({ kind: "nearYou" });
    }, "where");
    if (center) return; // already located — just reselect
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoState("denied");
      return;
    }
    setGeoState("pending");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoState("idle");
      },
      () => {
        setGeoState("denied");
        // Geolocation denial, not a user selection: do not let it be the
        // first_control value.
        editInputs(() => setAreaSel({ kind: "anywhere" }), "where");
      },
      { timeout: 8000, maximumAge: 300_000 },
    );
  };

  // The effective (daypart, clock, area, centre) for a build/reshuffle click —
  // uses the live wall clock at click time, same resolution as the memoised
  // preview.
  const planOpts = (offsetOverride: number) => {
    const now = new Date();
    const t = resolveTiming(
      when,
      customDate || toISODate(now),
      customTime,
      now,
    );
    return {
      area: toPlanArea(areaSel),
      vibe,
      budget,
      offset: offsetOverride,
      when: t.when,
      daypart: t.daypart,
      center: areaSel.kind === "nearYou" ? center : null,
      tasteScores,
    };
  };

  // ── Setup screen ────────────────────────────────────────────────────
  if (step === "setup") {
    return (
      <div>
        <div className="px-5 pt-8 pb-5">
          <h1 className="flex items-baseline gap-2.5 m-0 leading-none">
            <span
              className="text-xl italic font-medium text-muted-fg lowercase"
              suppressHydrationWarning
            >
              {eyebrow}
            </span>
            <span className="text-[32px] font-extrabold fl-grad-text lowercase tracking-tight">
              the plan
            </span>
          </h1>
          <div className="text-[13px] text-muted-fg mt-2">
            Tell us a few things. We&apos;ll plan the rest.
          </div>
        </div>

        <Group label="When">
          <WhenPicker
            choice={when}
            dateStr={customDate}
            timeStr={customTime}
            minDate={todayISO}
            onChange={({ choice, dateStr, timeStr }) =>
              editInputs(() => {
                setWhen(choice);
                setCustomDate(dateStr);
                setCustomTime(timeStr);
              }, "when")
            }
          />
        </Group>

        <Group label="Vibe">
          <div className="grid grid-cols-2 gap-2">
            {VIBES.map((v) => {
              const on = vibe === v.v;
              return (
                <button
                  key={v.v}
                  type="button"
                  onClick={() => editInputs(() => setVibe(v.v), "vibe")}
                  className={
                    "px-3.5 py-3 rounded-[14px] border-[1.5px] text-fg text-left flex items-center gap-2 text-[13px] font-bold " +
                    (on
                      ? "border-accent bg-accent/10"
                      : "border-border bg-card")
                  }
                >
                  <v.icon className="w-5 h-5" strokeWidth={1.75} aria-hidden />
                  {v.v}
                </button>
              );
            })}
          </div>
        </Group>

        <Group label="Area">
          <AreaPicker
            value={areaSel}
            venues={venues}
            onChange={(a) =>
              editInputs(() => {
                setAreaSel(a);
                setCenter(null);
                setGeoState("idle");
              }, "where")
            }
            nearYou={{ state: geoState, onPick: pickNearYou }}
          />
        </Group>

        <Group label="Budget">
          <div className="grid grid-cols-3 gap-2">
            {BUDGETS.map((b) => {
              const on = budget === b;
              return (
                <button
                  key={b}
                  type="button"
                  onClick={() => editInputs(() => setBudget(b), "budget")}
                  className={
                    "h-11 rounded-xl border-[1.5px] text-fg font-extrabold text-[13px] " +
                    (on
                      ? "border-accent bg-accent/10"
                      : "border-border bg-card")
                  }
                >
                  {b}
                </button>
              );
            })}
          </div>
        </Group>

        <div className="px-5 pt-5">
          <button
            type="button"
            onClick={() => {
              // Compute with the offset this click will apply (0) so the event
              // reflects the plan actually shown — useMemo's `computed` is a
              // render behind the setOffset below.
              //
              // The timer wraps ONLY computePlan. It is the actual elapsed
              // work: a local, synchronous engine call over the in-props
              // catalogue. The setState calls below are React scheduling, not
              // work the user waited on, and animation timing is never used to
              // manufacture a number.
              const t0 = performance.now();
              const result = computePlan(venues, planOpts(0));
              const duration_ms = Math.round(performance.now() - t0);
              setOffset(0);
              setSwaps({});
              setUndoStack([]);
              standDown();
              // Build produces a DIFFERENT night, so the save flag from the
              // last one must not follow it. Without this: Build -> Try
              // another -> Save -> Edit -> Build left the button reading
              // "Saved to your nights", disabled, on a night that had never
              // been saved — the app refusing to save while claiming it
              // already had.
              setSaveState("idle");
              setStep("result");
              recordSignal("plan_started", { surface: "plan" });
              const genProps = {
                area: result.area, // resolved walkable pocket
                areaKind: areaSel.kind, // legacy spelling, kept for insights
                area_kind: areaSel.kind, // anywhere | nearYou | region | neighbourhood
                vibe,
                budget,
                daypart: result.daypart, // day out vs night
                stops: result.steps.length, // legacy spelling
                stop_count: result.steps.length, // 0-3 stops filled
                full: result.steps.length === 3, // did it fill a complete night?
                poolStage: result.poolStage, // legacy spelling
                pool_stage: result.poolStage, // area | budget | all (had to widen?)
                poolSize: result.poolSize, // legacy spelling
                pool_size: result.poolSize, // candidates the engine chose from
                duration_ms,
              };
              // A night with zero stops is a FAILURE the user sees, even though
              // nothing threw. Until now this emitted plan_generate regardless,
              // so every no-result was counted as a success.
              if (result.steps.length === 0) {
                track("plan_generate_failed", {
                  ...genProps,
                  reason: "no_result",
                });
              } else {
                track("plan_generate", genProps);
              }
            }}
            className="w-full h-[52px] rounded-2xl bg-primary text-primary-fg text-[15px] font-extrabold shadow-[0_6px_14px_rgba(0,0,0,0.12)]"
          >
            Build the plan{" "}
            <Sparkles
              className="w-4 h-4 inline-block align-[-3px]"
              strokeWidth={1.75}
              aria-hidden
            />
          </button>
        </div>

        {/* Saved nights — signed-in re-open */}
        {savedPlans.length > 0 && (
          <Group label="Your saved nights">
            {pendingSaved && (
              <div className="mb-2.5 rounded-2xl border border-border bg-card p-4">
                <div className="text-[14px] font-extrabold text-heading">
                  You have a night in progress
                </div>
                <p className="text-[12px] text-muted-fg mt-1 leading-relaxed">
                  Opening <b className="text-heading">{pendingSaved.title}</b>{" "}
                  replaces the night you were building. Your saved nights stay
                  saved either way.
                </p>
                <div className="flex flex-col gap-2 mt-3">
                  <button
                    type="button"
                    onClick={() => {
                      const row = pendingSaved;
                      setPendingSaved(null);
                      reallyOpenSaved(row);
                      track("plan_reopen_conflict_resolved", {
                        choice: "open_saved",
                      });
                    }}
                    className="h-11 rounded-2xl bg-primary text-primary-fg text-[14px] font-extrabold"
                  >
                    Open the saved night
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPendingSaved(null);
                      track("plan_reopen_conflict_resolved", {
                        choice: "keep_current",
                      });
                    }}
                    className="h-11 rounded-2xl border-[1.5px] border-border bg-card text-[14px] font-extrabold text-fg"
                  >
                    Keep the one I&apos;m building
                  </button>
                </div>
              </div>
            )}
            <div className="flex flex-col gap-2">
              {savedPlans.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => openSaved(p)}
                  className="text-left bg-card border border-border rounded-2xl px-4 py-3"
                >
                  <div className="text-[14px] font-extrabold text-heading">
                    {p.title}
                  </div>
                  <div className="text-[11px] text-muted-fg mt-0.5">
                    {p.steps.length} stops · tap to re-open
                  </div>
                </button>
              ))}
            </div>
          </Group>
        )}
      </div>
    );
  }

  // ── Result screen ───────────────────────────────────────────────────
  // Guard: if the chosen area/vibe/budget yields no venues (e.g. an empty or
  // over-filtered catalogue), there's nothing to route — show a friendly
  // dead-end with a way back instead of a "Night in " header with zero stops.
  if (display.steps.length === 0) {
    return (
      <div className="px-5 py-16 text-center">
        <MapIcon
          className="w-10 h-10 text-muted-fg mb-3"
          strokeWidth={1.75}
          aria-hidden
        />
        <h2 className="text-xl font-extrabold text-heading mb-1.5">
          No plan for that combo
        </h2>
        <p className="text-sm text-muted-fg max-w-[300px] mx-auto leading-relaxed mb-6">
          We couldn&apos;t pull together enough spots for{" "}
          {display.area ? <b>{display.area}</b> : "that mix"} right now. Try a
          different area or vibe.
        </p>
        <button
          type="button"
          onClick={() => {
            standDown();
            setStep("setup");
          }}
          className="h-11 px-5 rounded-2xl bg-primary text-white font-extrabold text-[15px]"
        >
          Adjust my plan
        </button>
      </div>
    );
  }

  // Real turn-by-turn for the whole night (null when no stop has coordinates).
  const mapsUrl = googleMapsWalkingUrl(
    display.steps.map((s) => ({
      lat: s.venue.lat,
      lng: s.venue.lng,
      name: s.venue.name,
    })),
  );

  return (
    <div>
      <div
        className="px-5 pt-5 pb-5.5 text-white"
        style={{
          background:
            "linear-gradient(135deg, var(--fl-primary), var(--fl-accent))",
        }}
      >
        <button
          type="button"
          onClick={() => setStep("setup")}
          className="bg-white/15 text-white rounded-lg px-2.5 py-1 text-[11px] font-bold mb-2.5"
        >
          ← Edit
        </button>
        <h2 className="text-[22px] font-extrabold m-0">
          {display.daypart === "day"
            ? "Today, the plan:"
            : "Tonight, the plan:"}
        </h2>
        <div className="text-xs opacity-90 mt-1.5">
          <MapPin
            className="w-3.5 h-3.5 inline-block align-[-3px]"
            strokeWidth={1.75}
            aria-hidden
          />{" "}
          {display.area === ANYWHERE
            ? "Across London"
            : `Around ${display.area}`}{" "}
          ·{" "}
          <Clock
            className="w-3.5 h-3.5 inline-block align-[-3px]"
            strokeWidth={1.75}
            aria-hidden
          />{" "}
          {fmtHours(display.totalMins)}
        </div>
        {undoStack.length > 0 && (
          <button
            type="button"
            onClick={undoReplace}
            className="mt-2.5 inline-flex items-center gap-1.5 bg-white/15 text-white rounded-lg px-2.5 py-1 text-[11px] font-bold"
          >
            <Undo2 className="w-3.5 h-3.5" strokeWidth={2} aria-hidden />
            Undo change
          </button>
        )}
      </div>

      {/* fl-stagger: stops rise in sequence when a plan lands (the system's
          existing per-item entrance; reduced-motion collapses it to instant). */}
      <div className="px-5 py-4 flex flex-col gap-2.5 fl-stagger">
        {display.steps.map((s, i) => (
          <div key={`${s.venue.id}-${i}`}>
            <div className="flex items-center gap-3 mb-1.5">
              <div className="w-[26px] h-[26px] rounded-full border-2 border-accent text-accent grid place-items-center text-xs font-extrabold">
                {i + 1}
              </div>
              <div className="text-[11px] font-extrabold tracking-[0.12em] text-muted-fg uppercase">
                {s.role}
              </div>
              {(alternatives[i]?.length ?? 0) > 0 && (
                <button
                  type="button"
                  onClick={() => onSwap(i, 1, "button")}
                  aria-label={`Change the ${s.role} stop`}
                  className="ml-auto inline-flex items-center gap-1 text-[11px] font-bold text-accent"
                >
                  <RotateCw
                    className="w-3.5 h-3.5"
                    strokeWidth={2}
                    aria-hidden
                  />
                  Change
                </button>
              )}
            </div>
            <SwipeStop
              enabled={(alternatives[i]?.length ?? 0) > 0}
              onSwipe={(dir) => onSwap(i, dir, "swipe")}
            >
              <Link
                href={`/venue/${s.venue.slug}`}
                // Booking attribution, carried in sessionStorage rather than the
                // URL: a query param here would opt the venue route out of
                // static rendering and kill the /anon/venue/[slug] ISR cache.
                // Slug + 0-based stop index only.
                onClick={() => writePlanHandoff(s.venue.slug, i)}
                className="block bg-card border border-border rounded-2xl overflow-hidden transition-transform duration-300 ease-out lg:hover:-translate-y-0.5"
              >
                <div
                  className="h-[120px]"
                  style={{ background: `url(${s.venue.imgUrl}) center/cover` }}
                />
                <div className="p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[15px] font-extrabold text-heading">
                      {s.venue.name}
                    </div>
                    <span className="text-[11px] font-bold text-primary whitespace-nowrap">
                      View →
                    </span>
                  </div>
                  <div className="text-[11px] text-muted-fg mt-1 flex items-center gap-1.5 flex-wrap">
                    <span className="text-accent font-bold">
                      {s.venue.type}
                    </span>
                    <span>·</span>
                    <span>
                      <Star
                        className="w-3.5 h-3.5 inline-block align-[-3px]"
                        strokeWidth={1.75}
                        fill="currentColor"
                        aria-hidden
                      />{" "}
                      {s.venue.rating}
                    </span>
                    <span>·</span>
                    <span>{s.venue.price}</span>
                    <span>·</span>
                    <span>
                      <Clock
                        className="w-3.5 h-3.5 inline-block align-[-3px]"
                        strokeWidth={1.75}
                        aria-hidden
                      />{" "}
                      ~{s.dwellMins} min
                    </span>
                    {s.arriveAt && (
                      <>
                        <span>·</span>
                        <span className="font-bold text-fg">
                          arrive ~{fmtTime(s.arriveAt)}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-fg italic mt-1">
                    &quot;{s.venue.vibe}&quot;
                  </div>
                  {s.venue.planNote && (
                    <div className="text-[12px] text-fg mt-1.5 flex items-start gap-1 leading-snug">
                      <Sparkles
                        className="w-3.5 h-3.5 mt-px shrink-0 text-accent"
                        strokeWidth={1.75}
                        aria-hidden
                      />
                      <span>{s.venue.planNote}</span>
                    </div>
                  )}
                </div>
              </Link>
            </SwipeStop>
            {s.walkToNextMins != null && (
              <div className="ml-3 text-[11px] text-muted-fg py-1.5 pl-3 border-l-2 border-dashed border-border">
                <Footprints
                  className="w-3.5 h-3.5 inline-block align-[-3px]"
                  strokeWidth={1.75}
                  aria-hidden
                />{" "}
                ~{s.walkToNextMins} min walk
              </div>
            )}
          </div>
        ))}
      </div>

      {/* The walk on a map + real turn-by-turn in Google Maps (both live and
          re-opened saved plans). */}
      {mapsUrl && (
        <div className="px-5 pb-3">
          <div className="text-[11px] font-extrabold tracking-[0.12em] text-muted-fg uppercase mb-2.5">
            The walk
          </div>
          <PlanRouteMapLive steps={display.steps} />
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              recordSignal("outbound_click", { surface: "plan" });
              track("plan_open_maps", { stops: display.steps.length });
            }}
            className="mt-2.5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl border-[1.5px] border-border bg-card text-[14px] font-extrabold text-fg"
          >
            <MapIcon className="w-4 h-4" strokeWidth={1.75} aria-hidden />
            Open in Google Maps
          </a>
        </div>
      )}

      {/* Actions. "Try another combination" shows on EVERY night, including a
          re-opened saved one: it is not an edit of the saved row, it is "give
          me a different night", and it stands the re-opened night down first.
          Without it a re-opened night had no forward action on the whole
          screen — the one thing this product does was the one button missing.
          Save stays hidden for a saved row: the plans write is insert-only,
          so re-saving means a duplicate row rather than an update. */}
      {
        <div className="px-5 pb-2 flex flex-col gap-2.5">
          <button
            type="button"
            onClick={() => {
              const nextOffset = offset + 1;
              const t0 = performance.now();
              const result = computePlan(venues, planOpts(nextOffset));
              const duration_ms = Math.round(performance.now() - t0);
              setSaveState("idle");
              setSwaps({});
              setUndoStack([]);
              // 🧨 Stand down the restored night. Without this the button was
              // visible but inert on any restored or claimed night: `display`
              // kept returning the stored plan while `computed` moved on, so
              // the screen never changed and plan_reshuffle fired anyway —
              // counting a reshuffle the user never saw.
              standDown();
              setOffset(nextOffset);
              const reshuffleProps = {
                area: result.area, // resolved walkable pocket
                areaKind: areaSel.kind, // legacy spelling
                area_kind: areaSel.kind,
                vibe,
                budget,
                daypart: result.daypart,
                stops: result.steps.length, // legacy spelling
                stop_count: result.steps.length,
                full: result.steps.length === 3,
                poolStage: result.poolStage, // legacy spelling
                pool_stage: result.poolStage,
                poolSize: result.poolSize, // legacy spelling
                pool_size: result.poolSize,
                duration_ms,
                offset: nextOffset, // separates reshuffle failures from first builds
              };
              if (result.steps.length === 0) {
                track("plan_generate_failed", {
                  ...reshuffleProps,
                  reason: "no_result",
                });
              } else {
                track("plan_reshuffle", reshuffleProps);
              }
            }}
            className="w-full h-12 rounded-2xl border-[1.5px] border-accent text-accent text-[14px] font-extrabold"
          >
            Try another combination{" "}
            <RotateCw
              className="w-4 h-4 inline-block align-[-3px]"
              strokeWidth={1.75}
              aria-hidden
            />
          </button>

          {isReopenedSaved ? null : authUserId ? (
            <button
              type="button"
              onClick={onSave}
              disabled={saveState !== "idle" || alreadySaved}
              className="w-full h-12 rounded-2xl bg-primary text-primary-fg text-[14px] font-extrabold disabled:opacity-70"
            >
              {saveState === "saved" || alreadySaved ? (
                <>
                  Saved to your nights{" "}
                  <Check
                    className="w-4 h-4 inline-block align-[-3px]"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                </>
              ) : saveState === "saving" ? (
                "Saving…"
              ) : (
                "Save this night"
              )}
            </button>
          ) : (
            <Link
              href="/sign-in?return=/plan"
              onClick={() => writeSignInTrigger("plan_save")}
              className="w-full h-12 rounded-2xl bg-muted text-muted-fg text-[14px] font-extrabold flex items-center justify-center"
            >
              Sign in to save this night
            </Link>
          )}
        </div>
      }
    </div>
  );
}

// Group moved to ./plan-controls (shared with the anon setup).
