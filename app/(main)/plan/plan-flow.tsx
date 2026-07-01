"use client";

// Plan My Night — real recommender (Epic B). The setup form feeds the
// pure engine in lib/plan-engine.ts, which actually uses vibe + budget,
// scores venues for fit, and computes real walk times from coordinates.
//
// Extras over the old prototype port:
//   • "Try another combination" reshuffles within the same constraints.
//   • Signed-in users can save a night to public.plans and re-open it.

import { useCallback, useEffect, useMemo, useState } from "react";
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
  Zap,
  Sun,
  Moon,
  Globe,
  Navigation,
  ChevronDown,
  CalendarClock,
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
import { REGIONS, regionOf, type Region, type PlanArea } from "@/lib/regions";
import { track } from "@/lib/analytics";
import { recordSignal } from "@/lib/signals";
import { googleMapsWalkingUrl } from "@/lib/plan-maps";
import { PlanRouteMapLive } from "./plan-route-map-live";
import type { Venue } from "@/lib/types";

const VIBES: { v: PlanVibe; icon: LucideIcon }[] = [
  { v: "Chill", icon: Sparkles },
  { v: "Lively", icon: Flame },
  { v: "Fancy", icon: Gem },
  { v: "Unique", icon: Drama },
];

const BUDGETS: PlanBudget[] = ["£", "££", "Any"];

// ── When ────────────────────────────────────────────────────────────────
// The first question. It drives BOTH the plan shape (a day out vs a night —
// different venue types fill each stop) and the clock the engine walks for the
// open-at-arrival checks. "Now" adapts to the real time; the others force a
// daypart; "Pick a time" reveals a time input.
type WhenChoice = "now" | "day" | "evening" | "custom";
const WHENS: { v: WhenChoice; label: string; icon: LucideIcon }[] = [
  { v: "now", label: "Right now", icon: Zap },
  { v: "day", label: "Today", icon: Sun },
  { v: "evening", label: "Tonight", icon: Moon },
  { v: "custom", label: "Pick a day", icon: CalendarClock },
];

// Local YYYY-MM-DD (what <input type="date"> expects), in the browser's TZ.
function toISODate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ── Area ─────────────────────────────────────────────────────────────────
// The user's WHERE selection. Four shapes: Anywhere (let the engine find a good
// walkable pocket anywhere in London), Near you (geolocation + walk radius), a
// region (Central/North/East/South/West — the engine clusters to a walkable
// pocket WITHIN it), or a specific neighbourhood. Regions + their drill-down
// neighbourhoods come from lib/regions.ts, shared with Plan Together.
type AreaSel =
  | { kind: "anywhere" }
  | { kind: "nearYou" }
  | { kind: "region"; region: Region }
  | { kind: "neighbourhood"; name: string };

// Translate the UI selection into the engine's (PlanArea, centre) inputs. Near
// you passes a centre (which overrides the area scope with a walk radius); the
// rest pass a PlanArea.
function toPlanArea(sel: AreaSel): PlanArea {
  if (sel.kind === "region") return { kind: "region", region: sel.region };
  if (sel.kind === "neighbourhood")
    return { kind: "neighbourhood", name: sel.name };
  return { kind: "anywhere" }; // anywhere + nearYou both scope to anywhere
}

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
  // Regions that actually have venues + each region's specific neighbourhoods
  // (most-stocked first) for the drill-down. Built once from the catalogue so a
  // chip never points at an empty region and the drill-down lists only places
  // we cover.
  const { regionsWith, hoodsByRegion } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of venues) {
      const n = v.neighbourhood?.trim();
      if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    const byRegion = new Map<Region, { name: string; n: number }[]>();
    for (const [name, n] of counts) {
      const r = regionOf(name);
      if (!r) continue;
      (byRegion.get(r) ?? byRegion.set(r, []).get(r)!).push({ name, n });
    }
    for (const arr of byRegion.values()) arr.sort((a, b) => b.n - a.n);
    return {
      regionsWith: REGIONS.filter((r) => byRegion.has(r)),
      hoodsByRegion: byRegion,
    };
  }, [venues]);

  const [step, setStep] = useState<"setup" | "result">("setup");
  const [when, setWhen] = useState<WhenChoice>("now");
  // For the "Pick a day" path: a calendar date (YYYY-MM-DD, "" = today) + time.
  const [customDate, setCustomDate] = useState<string>("");
  const [customTime, setCustomTime] = useState<string>("20:00");
  // WHERE. Defaults to Anywhere — never a single neighbourhood — so the engine
  // is free to find the best walkable pocket. (See AreaSel above.)
  const [areaSel, setAreaSel] = useState<AreaSel>({ kind: "anywhere" });
  // Ghost-dropdown disclosure state: the region list, and the "a spot in …"
  // neighbourhood list (only meaningful once a region is chosen).
  const [areaOpen, setAreaOpen] = useState(false);
  const [spotOpen, setSpotOpen] = useState(false);
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
  const [savedPlans, setSavedPlans] = useState<SavedPlanRow[]>([]);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
    "idle",
  );

  // Current time, set AFTER mount so the open-now plan filter can't cause an
  // SSR/client hydration mismatch: the server renders fail-open (when=undefined),
  // then the client applies real opening hours once mounted.
  const [now, setNow] = useState<Date | undefined>(undefined);
  useEffect(() => setNow(new Date()), []);

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
      return;
    }
    setSavedPlans((data as SavedPlanRow[]) ?? []);
  }, [authUserId]);

  useEffect(() => {
    void loadSavedPlans();
  }, [loadSavedPlans]);

  const onSave = async () => {
    if (!authUserId || saveState === "saving") return;
    setSaveState("saving");
    const supabase = createClient();
    // Save what's ON SCREEN — i.e. with any per-stop swaps applied (`display`).
    const names = display.steps.map((s) => s.venue.name).join(" → ");
    const where = display.area === ANYWHERE ? "London" : display.area;
    const kind = computed.daypart === "day" ? "day out" : "night";
    const { error } = await supabase.from("plans").insert({
      user_id: authUserId,
      title: display.title,
      neighbourhood: display.area,
      why_it_works: `A ${computed.vibe.toLowerCase()} ${where} ${kind}: ${names}.`,
      steps: display.steps.map((s) => ({
        venueId: s.venue.id,
        role: s.role,
        dwellMins: s.dwellMins,
        walkToNextMins: s.walkToNextMins,
      })),
    });
    if (error) {
      console.error("[plans] save failed:", error);
      setSaveState("idle");
      return;
    }
    setSaveState("saved");
    recordSignal("plan_completed", { surface: "plan" });
    track("plan_save", {
      area: display.area,
      vibe: computed.vibe,
      budget: computed.budget,
      daypart: computed.daypart,
      stops: display.steps.length,
      swapped: Object.values(swaps).filter((v) => v >= 0).length,
      poolStage: computed.poolStage,
      poolSize: computed.poolSize,
    });
    void loadSavedPlans();
  };

  const openSaved = (row: SavedPlanRow) => {
    const steps = row.steps
      .map((s) => {
        const venue = venueById.get(s.venueId);
        return venue
          ? {
              venue,
              role: s.role,
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
    setOpenedSaved({
      title: row.title,
      area: row.neighbourhood,
      // Saved rows predate a stored daypart; infer it from the title we wrote
      // ("… Day Out …" vs "… Night …") so the header label reads right.
      daypart: row.title.includes("Day Out") ? "day" : "evening",
      totalMins,
      steps,
    });
    setStep("result");
  };

  // Editing any input invalidates a re-opened saved plan, the saved flag, and
  // any per-stop swaps (the base plan is about to change).
  const editInputs = (fn: () => void) => {
    setOpenedSaved(null);
    setSaveState("idle");
    setSwaps({});
    fn();
  };

  // "Change this one" — cycle stop `i` through its alternatives, wrapping back
  // to the original. relinkSteps (via toDisplay) keeps the walk + arrivals + map
  // honest after the swap.
  const onSwap = (i: number) => {
    const alts = computed.alternatives[i] ?? [];
    if (alts.length === 0) return;
    setSwaps((prev) => {
      const next = { ...prev };
      const nextIdx = (prev[i] ?? -1) + 1;
      if (nextIdx >= alts.length)
        delete next[i]; // back to the original
      else next[i] = nextIdx;
      return next;
    });
    setSaveState("idle");
    track("plan_swap", { stop: i });
  };

  // Anywhere / Near you are the two quick chips; the rest goes through the
  // ghost dropdowns below. All selections clear any stale near-you location.
  const chooseAnywhere = () =>
    editInputs(() => {
      setAreaSel({ kind: "anywhere" });
      setCenter(null);
      setGeoState("idle");
      setAreaOpen(false);
      setSpotOpen(false);
    });

  // Pick a region from the "Area" dropdown → close it, reveal the "a spot in …"
  // neighbourhood dropdown.
  const chooseRegion = (region: Region) =>
    editInputs(() => {
      setAreaSel({ kind: "region", region });
      setCenter(null);
      setGeoState("idle");
      setAreaOpen(false);
      setSpotOpen(true);
    });

  // Pick a specific neighbourhood from the "a spot in …" dropdown (or clear back
  // to the whole region with a null name).
  const chooseSpot = (region: Region, name: string | null) =>
    editInputs(() => {
      setAreaSel(
        name ? { kind: "neighbourhood", name } : { kind: "region", region },
      );
      setCenter(null);
      setGeoState("idle");
      setSpotOpen(false);
    });

  // "Near you" — ask the browser for location and keep the night within walking
  // distance of it. On denial/failure fall back to Anywhere so a plan still
  // builds (just London-wide) rather than dead-ending.
  const pickNearYou = () => {
    editInputs(() => {
      setAreaSel({ kind: "nearYou" });
      setAreaOpen(false);
      setSpotOpen(false);
    });
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
        editInputs(() => setAreaSel({ kind: "anywhere" }));
      },
      { timeout: 8000, maximumAge: 300_000 },
    );
  };

  // The region currently in play (selected directly, or the region of the
  // selected neighbourhood) — drives the "a spot in …" dropdown.
  const activeRegion: Region | null =
    areaSel.kind === "region"
      ? areaSel.region
      : areaSel.kind === "neighbourhood"
        ? regionOf(areaSel.name)
        : null;

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
          <div className="grid grid-cols-2 gap-2">
            {WHENS.map((w) => {
              const on = when === w.v;
              return (
                <button
                  key={w.v}
                  type="button"
                  onClick={() => editInputs(() => setWhen(w.v))}
                  className={
                    "px-3.5 py-3 rounded-[14px] border-[1.5px] text-fg text-left flex items-center gap-2 text-[13px] font-bold " +
                    (on
                      ? "border-accent bg-accent/10"
                      : "border-border bg-card")
                  }
                >
                  <w.icon className="w-5 h-5" strokeWidth={1.75} aria-hidden />
                  {w.label}
                </button>
              );
            })}
          </div>
          {when === "custom" && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <input
                type="date"
                value={customDate || todayISO}
                min={todayISO}
                onChange={(e) =>
                  editInputs(() => setCustomDate(e.target.value))
                }
                aria-label="Pick a date"
                className="h-11 rounded-xl border-[1.5px] border-border bg-card text-fg font-bold text-[13px] px-3.5"
              />
              <input
                type="time"
                value={customTime}
                onChange={(e) =>
                  editInputs(() => setCustomTime(e.target.value))
                }
                aria-label="Pick a start time"
                className="h-11 rounded-xl border-[1.5px] border-border bg-card text-fg font-bold text-[13px] px-3.5"
              />
            </div>
          )}
        </Group>

        <Group label="Vibe">
          <div className="grid grid-cols-2 gap-2">
            {VIBES.map((v) => {
              const on = vibe === v.v;
              return (
                <button
                  key={v.v}
                  type="button"
                  onClick={() => editInputs(() => setVibe(v.v))}
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
          <div className="flex gap-2 flex-wrap items-center">
            <Chip on={areaSel.kind === "anywhere"} onClick={chooseAnywhere}>
              <Globe
                className="w-3.5 h-3.5 inline-block align-[-2px] mr-1"
                strokeWidth={1.75}
                aria-hidden
              />
              Anywhere
            </Chip>
            <Chip on={areaSel.kind === "nearYou"} onClick={pickNearYou}>
              <Navigation
                className="w-3.5 h-3.5 inline-block align-[-2px] mr-1"
                strokeWidth={1.75}
                aria-hidden
              />
              {geoState === "pending" ? "Locating…" : "Near you"}
            </Chip>

            {/* "Area" chip — its region list pops out FROM the chip. */}
            {regionsWith.length > 0 && (
              <div className="relative">
                <Chip
                  on={
                    areaSel.kind === "region" ||
                    areaSel.kind === "neighbourhood"
                  }
                  onClick={() => setAreaOpen((v) => !v)}
                >
                  {activeRegion ?? "Area"}
                  <ChevronDown
                    className={
                      "w-3.5 h-3.5 inline-block align-[-2px] ml-1 transition-transform " +
                      (areaOpen ? "rotate-180" : "")
                    }
                    strokeWidth={1.75}
                    aria-hidden
                  />
                </Chip>
                {areaOpen && (
                  <>
                    {/* click-away */}
                    <button
                      type="button"
                      aria-hidden
                      tabIndex={-1}
                      onClick={() => setAreaOpen(false)}
                      className="fixed inset-0 z-10 cursor-default"
                    />
                    <div className="absolute left-0 top-full mt-1.5 z-20 min-w-[170px] rounded-2xl border border-border bg-card py-1.5 shadow-[0_12px_30px_rgba(0,0,0,0.35)]">
                      {regionsWith.map((r) => {
                        const on = activeRegion === r;
                        return (
                          <button
                            key={r}
                            type="button"
                            onClick={() => chooseRegion(r)}
                            className={
                              "w-full flex items-center justify-between px-3.5 py-2 text-left text-[13px] " +
                              (on ? "font-extrabold text-accent" : "text-fg")
                            }
                          >
                            <span>{r}</span>
                            {on && (
                              <Check
                                className="w-4 h-4"
                                strokeWidth={2}
                                aria-hidden
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* "A spot in {region}" ghost dropdown — only once a region is chosen.
              Pick a specific neighbourhood, or stay region-wide. */}
          {activeRegion &&
            (hoodsByRegion.get(activeRegion)?.length ?? 0) > 0 && (
              <div className="border-b border-border">
                <button
                  type="button"
                  onClick={() => setSpotOpen((v) => !v)}
                  aria-expanded={spotOpen}
                  className="w-full flex items-center justify-between py-3 text-left"
                >
                  <span className="text-[13px]">
                    <span className="font-extrabold text-fg">
                      A spot in {activeRegion}
                    </span>
                    <span className="text-muted-fg">
                      {" · "}
                      {areaSel.kind === "neighbourhood"
                        ? areaSel.name
                        : "anywhere here"}
                    </span>
                  </span>
                  <ChevronDown
                    className={
                      "w-4 h-4 text-muted-fg transition-transform " +
                      (spotOpen ? "rotate-180" : "")
                    }
                    strokeWidth={2}
                    aria-hidden
                  />
                </button>
                {spotOpen && (
                  <div className="flex flex-col pb-1.5 max-h-56 overflow-y-auto">
                    <button
                      type="button"
                      onClick={() => chooseSpot(activeRegion, null)}
                      className={
                        "py-2.5 text-left text-[13px] " +
                        (areaSel.kind === "region"
                          ? "font-extrabold text-accent"
                          : "text-muted-fg")
                      }
                    >
                      Anywhere in {activeRegion}
                    </button>
                    {(hoodsByRegion.get(activeRegion) ?? []).map(({ name }) => {
                      const on =
                        areaSel.kind === "neighbourhood" &&
                        areaSel.name === name;
                      return (
                        <button
                          key={name}
                          type="button"
                          onClick={() => chooseSpot(activeRegion, name)}
                          className={
                            "flex items-center justify-between py-2.5 text-left text-[13px] " +
                            (on ? "font-extrabold text-accent" : "text-fg")
                          }
                        >
                          <span>{name}</span>
                          {on && (
                            <Check
                              className="w-4 h-4"
                              strokeWidth={2}
                              aria-hidden
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

          {geoState === "denied" && (
            <div className="text-[11px] text-muted-fg mt-2">
              Couldn&apos;t get your location. Showing spots across London
              instead.
            </div>
          )}
        </Group>

        <Group label="Budget">
          <div className="grid grid-cols-3 gap-2">
            {BUDGETS.map((b) => {
              const on = budget === b;
              return (
                <button
                  key={b}
                  type="button"
                  onClick={() => editInputs(() => setBudget(b))}
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
              const result = computePlan(venues, planOpts(0));
              setOffset(0);
              setSwaps({});
              setOpenedSaved(null);
              setStep("result");
              recordSignal("plan_started", { surface: "plan" });
              track("plan_generate", {
                area: result.area, // resolved walkable pocket
                areaKind: areaSel.kind, // anywhere | nearYou | region | neighbourhood
                vibe,
                budget,
                daypart: result.daypart, // day out vs night
                stops: result.steps.length, // engine outcome: 0–3 stops filled
                full: result.steps.length === 3, // did it fill a complete night?
                poolStage: result.poolStage, // area | budget | all (had to widen?)
                poolSize: result.poolSize, // candidates the engine chose from
              });
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

      <div className="px-5 py-4 flex flex-col gap-2.5">
        {display.steps.map((s, i) => (
          <div key={`${s.venue.id}-${i}`}>
            <div className="flex items-center gap-3 mb-1.5">
              <div className="w-[26px] h-[26px] rounded-full border-2 border-accent text-accent grid place-items-center text-xs font-extrabold">
                {i + 1}
              </div>
              <div className="text-[11px] font-extrabold tracking-[0.12em] text-muted-fg uppercase">
                {s.role}
              </div>
              {!openedSaved && (computed.alternatives[i]?.length ?? 0) > 0 && (
                <button
                  type="button"
                  onClick={() => onSwap(i)}
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
            <Link
              href={`/venue/${s.venue.slug}`}
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
                  <span className="text-accent font-bold">{s.venue.type}</span>
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
      {!openedSaved && (
        <div className="px-5 pb-2 flex flex-col gap-2.5">
          <button
            type="button"
            onClick={() => {
              const nextOffset = offset + 1;
              const result = computePlan(venues, planOpts(nextOffset));
              setSaveState("idle");
              setSwaps({});
              setOffset(nextOffset);
              track("plan_reshuffle", {
                area: result.area, // resolved walkable pocket
                areaKind: areaSel.kind,
                vibe,
                budget,
                daypart: result.daypart,
                stops: result.steps.length,
                full: result.steps.length === 3,
                poolStage: result.poolStage,
                poolSize: result.poolSize,
              });
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

function Group({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-5 pb-4">
      <div className="text-[11px] font-extrabold text-muted-fg tracking-[0.12em] uppercase mb-2.5">
        {label}
      </div>
      {children}
    </div>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "px-4 py-3.5 rounded-full border-[1.5px] text-xs font-bold " +
        (on
          ? "border-accent bg-accent text-accent-fg"
          : "border-border bg-card text-fg")
      }
    >
      {children}
    </button>
  );
}
