"use client";

// Plan My Night — real recommender (Epic B). The setup form feeds the
// pure engine in lib/plan-engine.ts, which actually uses vibe + budget,
// scores venues for fit, and computes real walk times from coordinates.
//
// Extras over the old prototype port:
//   • "Try another combination" reshuffles within the same constraints.
//   • Signed-in users can save a night to public.plans and re-open it.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Check,
  Star,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  computePlan,
  relinkSteps,
  isDaytimeHour,
  ANYWHERE,
  type Plan,
  type PlanBudget,
  type PlanRole,
  type PlanVibe,
  type PlanDaypart,
} from "@/lib/plan-engine";
import type { PlanArea } from "@/lib/regions";
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
import { ANON_PLAN_STASH_KEY } from "./anon-plan-flow";
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
): { daypart: PlanDaypart; when: Date } {
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
      return { daypart: "day", when: isDayNow ? base : at(13) };
    case "evening":
      // A night out: use now if it's already evening, else 7pm tonight.
      return { daypart: "evening", when: isDayNow ? at(19) : base };
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
      };
    }
    default: // "now" — plan for this moment, shape follows the clock.
      return { daypart: isDayNow ? "day" : "evening", when: base };
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

  // When set, the result view shows a re-opened saved plan instead of the
  // live-computed one. Cleared whenever the user edits inputs / tries again.
  const [openedSaved, setOpenedSaved] = useState<DisplayPlan | null>(null);
  // 🧨 WHERE the night on screen came from — NOT the same question as
  // "is `openedSaved` set".
  //
  // Both gates caught this: overloading `openedSaved` to mean both "reopened
  // from the Saved list" and "the active night" made every RESTORED night
  // inert. An anon visitor tapped "Save this night", signed in, had their
  // night faithfully restored, and found no Save button — the exact
  // conversion the transfer path exists for. Same for anyone who tapped a
  // stop and came back.
  //
  // Only a night reopened from a saved ROW is read-only. A restored generated
  // or claimed night keeps Save and Try-another; per-stop swaps stay hidden in
  // all three cases, because `computed.alternatives[i]` is relative to a
  // different set of stops and offering them could produce a night that is no
  // longer walkable.
  const [activeSource, setActiveSource] = useState<NightPlanSource | null>(
    null,
  );
  const isReopenedSaved = activeSource === "saved";
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
  // True when this night began life as an anonymous preview that was stashed
  // through the sign-in round trip. Replaces a SaveMode value that could never
  // be produced (the Save button is unmounted for a restored plan).
  const anonOriginRef = useRef(false);
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

  const display: DisplayPlan =
    openedSaved ?? toDisplay(computed, swaps, timing?.when);

  // Editorial eyebrow, same convention as the Explore header: 06:00–17:59 reads
  // "today,", 18:00–05:59 "tonight,". `now` is null until mount, so SSR + first
  // client render agree (default "tonight,") and it settles after mount.
  const eyebrow =
    now && now.getHours() >= 6 && now.getHours() < 18 ? "today," : "tonight,";

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
    const signature = display.steps.map((s) => s.venue.id).join("|");
    const alreadySaved = savedPlans.some(
      (p) => p.steps.map((s) => s.venueId).join("|") === signature,
    );
    const mode: SaveMode = alreadySaved
      ? "duplicate"
      : swapCount > 0
        ? "resave_after_swap"
        : offset > 0
          ? "resave_after_reshuffle"
          : "new";
    const attempt = ++saveAttemptRef.current;
    const saveProps = {
      area: display.area,
      vibe: computed.vibe,
      budget: computed.budget,
      daypart: computed.daypart,
      stops: display.steps.length, // legacy spelling, kept for continuity
      stop_count: display.steps.length,
      swapped: swapCount,
      poolStage: computed.poolStage, // legacy spelling
      pool_stage: computed.poolStage,
      poolSize: computed.poolSize, // legacy spelling
      pool_size: computed.poolSize,
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
    const kind = computed.daypart === "day" ? "day out" : "night";
    // `status` is destructured purely to bucket a failure (0 = never left the
    // device, 401/403 = expired session, 429 = throttled, 5xx = server).
    const { error, status } = await supabase.from("plans").insert({
      user_id: authUserId,
      title: display.title,
      neighbourhood: display.area,
      why_it_works: `A ${computed.vibe.toLowerCase()} ${where} ${kind}: ${names}.`,
      // Canonical adapter. Still an ARRAY with the same four legacy keys, plus
      // `slug` — so a row written today is readable by anything that predates
      // the model, including the account-data export. See lib/night-plan.ts.
      steps: toSavedSteps(
        fromEnginePlan(
          {
            ...computed,
            area: display.area,
            steps: display.steps.map((s) => ({
              ...s,
              arriveAt: s.arriveAt ?? null,
            })),
          },
          { title: display.title },
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
      const steps = dropped > 0 ? relinkSteps(stops, undefined) : stops;
      if (dropped > 0) {
        track("plan_restored_partial", {
          dropped,
          kept: steps.length,
          source: np.source,
        });
      }

      setOpenedSaved({
        title: np.title,
        area: np.area,
        daypart: np.daypart,
        totalMins: steps.reduce(
          (sum, s) => sum + s.dwellMins + (s.walkToNextMins ?? 0),
          0,
        ),
        steps,
      });
      setActiveSource(np.source);
      // Seed the vibe/budget controls so the brief behind the night is what
      // the user sees, and so "try again" regenerates something comparable
      // rather than whatever the controls happened to be left on.
      //
      // The AREA control is deliberately NOT seeded. It is an AreaSel union
      // (anywhere / nearYou / region / neighbourhood) and a NightPlan carries
      // only the resolved area STRING, so mapping back would have to guess
      // between "region" and "neighbourhood". Guessing wrong would silently
      // change what the engine generates next, and preserving generation
      // behaviour is a hard requirement here.
      setVibe(np.vibe);
      setBudget(np.budget);
      setStep("result");

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

  const openSaved = (row: SavedPlanRow) => {
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
  const restoredForRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    // Wait for the catalogue: hydrating against an empty list would drop every
    // stop and look identical to "there was nothing saved".
    if (venues.length === 0) return;
    if (restoredForRef.current === owner) return;
    restoredForRef.current = owner;

    const claimed = owner ? claimAnonPlan(owner) : null;
    if (claimed) {
      anonOriginRef.current = true;
      // The canonical claim has won. Drop the legacy one-shot stash so the
      // older effect below cannot restore a coarser copy of the same night
      // over the top of it and double-fire the analytics.
      try {
        window.localStorage.removeItem(ANON_PLAN_STASH_KEY);
      } catch {
        /* private mode */
      }
      if (activate(claimed)) {
        track("plan_anon_claimed", { stops: claimed.stops.length });
        return;
      }
      // Every venue has gone. The anon copy is already destroyed by the claim,
      // so drop the owner copy too rather than retrying it on every mount.
      clearActivePlan(owner);
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
    const np = openedSaved
      ? null
      : fromEnginePlan(
          {
            ...computed,
            steps: display.steps.map((s) => ({
              ...s,
              arriveAt: s.arriveAt ?? null,
            })),
          },
          { title: display.title },
        );
    if (np) writeActivePlan(owner, np);
  }, [step, openedSaved, computed, display, owner]);

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
      setOpenedSaved({
        title: `${stash.area || "London"} ${daypart === "day" ? "Day Out" : "Night"}`,
        area: stash.area || "London",
        daypart,
        totalMins,
        steps,
      });
      setStep("result");
      // This night came from an anonymous preview. Recorded as a boolean on the
      // save events rather than a SaveMode value, because the Save button is
      // unmounted while a restored plan is on screen (see the report in the PR).
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
    setOpenedSaved(null);
    setSaveState("idle");
    setSwaps({});
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
    const alts = computed.alternatives[i] ?? [];
    if (alts.length === 0) return;
    setSwaps((prev) => {
      // Positions 0..len-1: 0 = original venue, 1..len-1 = alternatives.
      const len = alts.length + 1;
      const pos = ((((prev[i] ?? -1) + 1 + dir) % len) + len) % len;
      const idx = pos - 1; // −1 = back to the original
      const next = { ...prev };
      if (idx < 0) delete next[i];
      else next[i] = idx;
      return next;
    });
    setSaveState("idle");
    // `method` is passed in by the caller, never derived from `dir`: a LEFT
    // swipe and the Change button's default argument both produce dir === 1.
    // `stop_role` ships alongside stop_index because the group surface filters
    // roles by hearted moods, so index 0 there is not necessarily the opener.
    // Without the role, solo and group merge into a wrong conclusion.
    track("plan_swap", {
      stop: i, // legacy spelling, kept so existing insights keep working
      stop_index: i,
      stop_role: computed.steps[i]?.role ?? null,
      dir,
      method,
    });
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
              setOpenedSaved(null);
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
            setOpenedSaved(null);
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
              {!isReopenedSaved &&
                (computed.alternatives[i]?.length ?? 0) > 0 && (
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
              enabled={
                !openedSaved && (computed.alternatives[i]?.length ?? 0) > 0
              }
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

      {/* Actions — try another + save (live plans only, not re-opened) */}
      {!isReopenedSaved && (
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

          {authUserId ? (
            <button
              type="button"
              onClick={onSave}
              disabled={saveState !== "idle"}
              className="w-full h-12 rounded-2xl bg-primary text-primary-fg text-[14px] font-extrabold disabled:opacity-70"
            >
              {saveState === "saved" ? (
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
      )}
    </div>
  );
}

// Group moved to ./plan-controls (shared with the anon setup).
