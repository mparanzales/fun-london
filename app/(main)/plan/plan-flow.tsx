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
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  computePlan,
  planRationale,
  ANYWHERE,
  type Plan,
  type PlanBudget,
  type PlanRole,
  type PlanVibe,
  type PlanDaypart,
} from "@/lib/plan-engine";
import { track } from "@/lib/analytics";
import { recordSignal } from "@/lib/signals";
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
  { v: "day", label: "Daytime", icon: Sun },
  { v: "evening", label: "Tonight", icon: Moon },
  { v: "custom", label: "Pick a time", icon: Clock },
];

// Special area chips beyond the real neighbourhoods. ANYWHERE comes from the
// engine (builds across all of London); NEAR_YOU uses the browser's location to
// keep the night within a short walk of where the user is.
const NEAR_YOU = "Near you";

// Resolve a When choice into the daypart (plan shape) + the start clock the
// engine walks. `base` is the live clock, passed in so this stays pure and the
// caller controls hydration timing (no Date() before mount).
function resolveTiming(
  choice: WhenChoice,
  customTime: string,
  base: Date,
): { daypart: PlanDaypart; when: Date } {
  const at = (h: number, m = 0) => {
    const d = new Date(base);
    d.setHours(h, m, 0, 0);
    return d;
  };
  // Before 5pm reads as "day"; from 5pm on, "evening".
  const isDayNow = base.getHours() < 17;
  switch (choice) {
    case "day":
      // A daytime plan: use now if it's still daytime, else a representative 1pm.
      return { daypart: "day", when: isDayNow ? base : at(13) };
    case "evening":
      // A night out: use now if it's already evening, else 7pm tonight.
      return { daypart: "evening", when: isDayNow ? at(19) : base };
    case "custom": {
      const [h, m] = customTime.split(":").map(Number);
      const when = Number.isFinite(h) ? at(h, Number.isFinite(m) ? m : 0) : base;
      return { daypart: when.getHours() < 17 ? "day" : "evening", when };
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
// is the dynamic "Tonight/Today, the plan:"). Daypart- and area-aware so a saved
// night reads right: "Chill Night in Soho", "Lively Day Out near you".
function toDisplay(plan: Plan): DisplayPlan {
  const kind = plan.daypart === "day" ? "Day Out" : "Night";
  const where =
    plan.area === ANYWHERE
      ? "London"
      : plan.area === NEAR_YOU
        ? "your area"
        : plan.area;
  return {
    title: `${plan.vibe} ${kind} in ${where}`,
    area: plan.area,
    daypart: plan.daypart,
    totalMins: plan.totalMins,
    steps: plan.steps,
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
  // Area chips are derived from the catalog so every chip has venues — ALL
  // neighbourhoods we cover, most-stocked first (plus the Anywhere / Near you
  // options rendered separately). Blank neighbourhoods are dropped.
  const areas = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of venues) {
      const n = v.neighbourhood?.trim();
      if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  }, [venues]);

  // Quick-access chips = the most-stocked handful. The full list (60+ hoods)
  // lives in a "More neighbourhoods" dropdown so the chip row never becomes a
  // wall; alphabetical there so a known neighbourhood is easy to find.
  const topAreas = useMemo(() => areas.slice(0, 8), [areas]);
  const allAreasAlpha = useMemo(
    () => [...areas].sort((a, b) => a.localeCompare(b)),
    [areas],
  );

  const [step, setStep] = useState<"setup" | "result">("setup");
  const [when, setWhen] = useState<WhenChoice>("now");
  const [customTime, setCustomTime] = useState<string>("20:00");
  const [area, setArea] = useState<string>(() => areas[0] ?? "");
  // Set when the user picks "Near you" and the browser grants location — the
  // engine then keeps the night within a short walk of this point instead of a
  // named neighbourhood. Cleared whenever another area is chosen.
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const [geoState, setGeoState] = useState<"idle" | "pending" | "denied">(
    "idle",
  );
  const [vibe, setVibe] = useState<PlanVibe>("Chill");
  const [budget, setBudget] = useState<PlanBudget>("££");
  const [offset, setOffset] = useState(0);

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

  // Resolve the When answer into (daypart, start clock) once the live clock is
  // known (post-mount). null before mount → engine infers + fails open on hours,
  // matching the SSR render so there's no hydration mismatch.
  const timing = useMemo(
    () => (now ? resolveTiming(when, customTime, now) : null),
    [when, customTime, now],
  );

  const computed = useMemo(
    () =>
      computePlan(venues, {
        area,
        vibe,
        budget,
        offset,
        when: timing?.when,
        daypart: timing?.daypart,
        center: area === NEAR_YOU ? center : null,
        tasteScores,
      }),
    [venues, area, vibe, budget, offset, timing, center, tasteScores],
  );

  const display: DisplayPlan = openedSaved ?? toDisplay(computed);

  // Editorial eyebrow, same convention as the Explore header: 06:00–17:59 reads
  // "today,", 18:00–05:59 "tonight,". `now` is null until mount, so SSR + first
  // client render agree (default "tonight,") and it settles after mount.
  const eyebrow =
    now && now.getHours() >= 6 && now.getHours() < 18 ? "today," : "tonight,";

  // A specific neighbourhood chosen from the "More neighbourhoods" dropdown that
  // isn't one of the quick chips — surface it as its own selected chip so the
  // choice stays visible (and the dropdown stays a pure picker, value "").
  const specificArea =
    area !== ANYWHERE && area !== NEAR_YOU && !topAreas.includes(area)
      ? area
      : null;

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
    const { error } = await supabase.from("plans").insert({
      user_id: authUserId,
      title: toDisplay(computed).title,
      neighbourhood: computed.area,
      why_it_works: planRationale(computed),
      steps: computed.steps.map((s) => ({
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
      area: computed.area,
      vibe: computed.vibe,
      budget: computed.budget,
      daypart: computed.daypart,
      stops: computed.steps.length,
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

  // Editing any input invalidates a re-opened saved plan + the saved flag.
  const editInputs = (fn: () => void) => {
    setOpenedSaved(null);
    setSaveState("idle");
    fn();
  };

  // Pick a normal neighbourhood or Anywhere: clear any near-you location.
  const chooseArea = (a: string) =>
    editInputs(() => {
      setArea(a);
      setCenter(null);
      setGeoState("idle");
    });

  // "Near you" — ask the browser for location and keep the night within walking
  // distance of it. On denial/failure fall back to Anywhere so a plan still
  // builds (just London-wide) rather than dead-ending.
  const pickNearYou = () => {
    editInputs(() => setArea(NEAR_YOU));
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
        editInputs(() => setArea(ANYWHERE));
      },
      { timeout: 8000, maximumAge: 300_000 },
    );
  };

  // The effective (daypart, clock, center) for a build/reshuffle click — uses
  // the live wall clock at click time, same resolution as the memoised preview.
  const planOpts = (offsetOverride: number) => {
    const t = resolveTiming(when, customTime, new Date());
    return {
      area,
      vibe,
      budget,
      offset: offsetOverride,
      when: t.when,
      daypart: t.daypart,
      center: area === NEAR_YOU ? center : null,
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
            <input
              type="time"
              value={customTime}
              onChange={(e) =>
                editInputs(() => setCustomTime(e.target.value))
              }
              aria-label="Pick a start time"
              className="mt-2 w-full h-11 rounded-xl border-[1.5px] border-border bg-card text-fg font-bold text-[13px] px-3.5"
            />
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
          <div className="flex gap-2 flex-wrap">
            <Chip on={area === ANYWHERE} onClick={() => chooseArea(ANYWHERE)}>
              <Globe
                className="w-3.5 h-3.5 inline-block align-[-2px] mr-1"
                strokeWidth={1.75}
                aria-hidden
              />
              Anywhere
            </Chip>
            <Chip on={area === NEAR_YOU} onClick={pickNearYou}>
              <Navigation
                className="w-3.5 h-3.5 inline-block align-[-2px] mr-1"
                strokeWidth={1.75}
                aria-hidden
              />
              {geoState === "pending" ? "Locating…" : "Near you"}
            </Chip>
            {specificArea && (
              <Chip on onClick={() => chooseArea(specificArea)}>
                {specificArea}
              </Chip>
            )}
            {topAreas.map((a) => (
              <Chip key={a} on={area === a} onClick={() => chooseArea(a)}>
                {a}
              </Chip>
            ))}
          </div>
          {allAreasAlpha.length > topAreas.length && (
            <div className="relative mt-2">
              <select
                value=""
                aria-label="More neighbourhoods"
                onChange={(e) => {
                  if (e.target.value) chooseArea(e.target.value);
                }}
                className="w-full h-11 rounded-xl border-[1.5px] border-border bg-card text-fg font-bold text-[13px] pl-3.5 pr-9 appearance-none"
              >
                <option value="">More neighbourhoods…</option>
                {allAreasAlpha.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-fg pointer-events-none"
                strokeWidth={1.75}
                aria-hidden
              />
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
              setOpenedSaved(null);
              setStep("result");
              recordSignal("plan_started", { surface: "plan" });
              track("plan_generate", {
                area,
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
          {display.area === ANYWHERE ? "Across London" : display.area} ·{" "}
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

      {/* Actions — try another + save (live plans only, not re-opened) */}
      {!openedSaved && (
        <div className="px-5 pb-2 flex flex-col gap-2.5">
          <button
            type="button"
            onClick={() => {
              const nextOffset = offset + 1;
              const result = computePlan(venues, planOpts(nextOffset));
              setSaveState("idle");
              setOffset(nextOffset);
              track("plan_reshuffle", {
                area,
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
