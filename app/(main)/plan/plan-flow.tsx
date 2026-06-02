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
import { createClient } from "@/lib/supabase/client";
import {
  computePlan,
  planRationale,
  type Plan,
  type PlanBudget,
  type PlanRole,
  type PlanVibe,
} from "@/lib/plan-engine";
import { track } from "@/lib/analytics";
import type { Venue } from "@/lib/types";

const VIBES: { v: PlanVibe; e: string }[] = [
  { v: "Chill", e: "✨" },
  { v: "Lively", e: "🔥" },
  { v: "Fancy", e: "💎" },
  { v: "Unique", e: "🎭" },
];

const BUDGETS: PlanBudget[] = ["£", "££", "Any"];

// A render-ready plan shared by freshly-computed and re-opened-saved plans.
type DisplayPlan = {
  title: string;
  area: string;
  totalMins: number;
  steps: {
    venue: Venue;
    role: PlanRole;
    dwellMins: number;
    walkToNextMins: number | null;
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

function toDisplay(plan: Plan): DisplayPlan {
  return {
    title: `${plan.vibe} Night in ${plan.area}`,
    area: plan.area,
    totalMins: plan.totalMins,
    steps: plan.steps,
  };
}

export function PlanFlow({
  venues,
  authUserId,
}: {
  venues: Venue[];
  authUserId: string | null;
}) {
  // Area chips are derived from the catalog so every chip has venues —
  // most-stocked neighbourhoods first.
  const areas = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of venues)
      counts.set(v.neighbourhood, (counts.get(v.neighbourhood) ?? 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([n]) => n);
  }, [venues]);

  const [step, setStep] = useState<"setup" | "result">("setup");
  const [area, setArea] = useState<string>(() => areas[0] ?? "");
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

  const venueById = useMemo(() => {
    const m = new Map<string, Venue>();
    for (const v of venues) m.set(v.id, v);
    return m;
  }, [venues]);

  const computed = useMemo(
    () => computePlan(venues, { area, vibe, budget, offset }),
    [venues, area, vibe, budget, offset],
  );

  const display: DisplayPlan = openedSaved ?? toDisplay(computed);

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

  // ── Setup screen ────────────────────────────────────────────────────
  if (step === "setup") {
    return (
      <div>
        <div className="px-5 pb-3.5">
          <h1 className="text-[28px] font-extrabold text-primary tracking-tight m-0">
            Plan My Night
          </h1>
          <div className="text-[13px] text-muted-fg mt-1">
            Tell us what you&apos;re feeling. We&apos;ll do the rest.
          </div>
        </div>

        <Group label="Area">
          <div className="flex gap-2 flex-wrap">
            {areas.map((a) => (
              <Chip
                key={a}
                on={area === a}
                onClick={() => editInputs(() => setArea(a))}
              >
                {a}
              </Chip>
            ))}
          </div>
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
                  <span className="text-base">{v.e}</span>
                  {v.v}
                </button>
              );
            })}
          </div>
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
              setOffset(0);
              setOpenedSaved(null);
              setStep("result");
              track("plan_generate", { area, vibe, budget });
            }}
            className="w-full h-[52px] rounded-2xl text-primary-fg text-[15px] font-extrabold shadow-[0_6px_14px_rgba(0,0,0,0.12)]"
            style={{
              background:
                "linear-gradient(135deg, var(--fl-primary), var(--fl-accent))",
            }}
          >
            Make my plan ✨
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
        <h2 className="text-[22px] font-extrabold m-0">{display.title}</h2>
        <div className="text-xs opacity-90 mt-1.5">
          📍 {display.area} · 🕒 {fmtHours(display.totalMins)}
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
            <div className="bg-card border border-border rounded-2xl overflow-hidden">
              <div
                className="h-[120px]"
                style={{ background: `url(${s.venue.imgUrl}) center/cover` }}
              />
              <div className="p-3.5">
                <div className="text-[15px] font-extrabold text-heading">
                  {s.venue.name}
                </div>
                <div className="text-[11px] text-muted-fg mt-1 flex items-center gap-1.5 flex-wrap">
                  <span className="text-accent font-bold">{s.venue.type}</span>
                  <span>·</span>
                  <span>★ {s.venue.rating}</span>
                  <span>·</span>
                  <span>{s.venue.price}</span>
                  <span>·</span>
                  <span>🕒 ~{s.dwellMins} min</span>
                </div>
                <div className="text-[11px] text-muted-fg italic mt-1">
                  &quot;{s.venue.vibe}&quot;
                </div>
              </div>
            </div>
            {s.walkToNextMins != null && (
              <div className="ml-3 text-[11px] text-muted-fg py-1.5 pl-3 border-l-2 border-dashed border-border">
                🚶 ~{s.walkToNextMins} min walk
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
              setSaveState("idle");
              setOffset((o) => o + 1);
              track("plan_reshuffle", { area, vibe, budget });
            }}
            className="w-full h-12 rounded-2xl border-[1.5px] border-accent text-accent text-[14px] font-extrabold"
          >
            Try another combination ↻
          </button>

          {authUserId ? (
            <button
              type="button"
              onClick={onSave}
              disabled={saveState !== "idle"}
              className="w-full h-12 rounded-2xl bg-primary text-primary-fg text-[14px] font-extrabold disabled:opacity-70"
            >
              {saveState === "saved"
                ? "Saved to your nights ✓"
                : saveState === "saving"
                  ? "Saving…"
                  : "Save this night"}
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
