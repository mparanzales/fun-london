"use client";

// Plan My Night — pixel-faithful port of PlanScreen from
// components/screens.jsx (lines 220–311). Setup ↔ Result internal state.
// No map, no why-it-works — the prototype's Plan My Night doesn't have them.

import { useMemo, useState } from "react";
import { getVenues } from "@/lib/mock-data";
import type { Venue } from "@/lib/types";

const AREAS = ["Soho", "Shoreditch", "Camden", "Fitzrovia"] as const;
type Area = (typeof AREAS)[number];

const VIBES = [
  { v: "Chill", e: "✨" },
  { v: "Lively", e: "🔥" },
  { v: "Fancy", e: "💎" },
  { v: "Unique", e: "🎭" },
] as const;
type Vibe = (typeof VIBES)[number]["v"];

const BUDGETS = ["£", "££", "Any"] as const;
type Budget = (typeof BUDGETS)[number];

type PlanStep = Venue & { minutes: number };

// Step labels for the itinerary marker.
const STEP_LABELS = ["Start", "Then", "Finish"] as const;

// Exact port of `computePlan` from screens.jsx.
function computePlan(area: Area, _vibe: Vibe, _budget: Budget): PlanStep[] {
  const venues = getVenues();
  const inArea = venues.filter((v) => v.neighbourhood === area);
  const pool = inArea.length >= 3 ? inArea : venues;
  const start = pool.find((v) => v.type === "Restaurant") ?? pool[0];
  const middle =
    pool.find(
      (v) =>
        v.id !== start.id &&
        (v.type === "Wine Bar" ||
          v.type === "Bar" ||
          v.type === "Listening Bar"),
    ) ?? pool[1];
  const end =
    pool.find(
      (v) =>
        v.id !== start.id &&
        v.id !== middle.id &&
        (v.type === "Live Music" || v.timeOfDay === "Night"),
    ) ?? pool[2];
  const minutes = [75, 60, 50];
  return [start, middle, end]
    .filter(Boolean)
    .map((v, i) => ({ ...(v as Venue), minutes: minutes[i] }));
}

export function PlanFlow() {
  const [step, setStep] = useState<"setup" | "result">("setup");
  const [area, setArea] = useState<Area>("Shoreditch");
  const [vibe, setVibe] = useState<Vibe>("Chill");
  const [budget, setBudget] = useState<Budget>("££");

  const plan = useMemo(
    () => computePlan(area, vibe, budget),
    [area, vibe, budget],
  );

  if (step === "setup") {
    return (
      <div>
        <div className="px-5 pb-3.5">
          <h1 className="text-[28px] font-extrabold text-primary tracking-tight m-0">
            Plan My Night
          </h1>
          <div className="text-[13px] text-muted-fg mt-1">
            Tell us what you&apos;re feeling — we&apos;ll do the rest.
          </div>
        </div>

        <Group label="Area">
          <div className="flex gap-2 flex-wrap">
            {AREAS.map((a) => (
              <Chip key={a} on={area === a} onClick={() => setArea(a)}>
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
                  onClick={() => setVibe(v.v)}
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
                  onClick={() => setBudget(b)}
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
            onClick={() => setStep("result")}
            className="w-full h-[52px] rounded-[14px] bg-primary text-primary-fg text-[15px] font-extrabold shadow-[0_6px_14px_rgba(0,0,0,0.12)]"
          >
            Make my plan ✨
          </button>
        </div>
      </div>
    );
  }

  // ── Result screen ──────────────────────────────────────────────────────
  return (
    <div>
      {/* Gradient strip header — primary→accent. Linear-gradient stays as
          inline style because Tailwind doesn't express arbitrary
          two-stop gradients between two CSS variables cleanly. */}
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
          {vibe} Night in {area}
        </h2>
        <div className="text-xs opacity-90 mt-1.5">
          📍 {area} · 🕒 ~3.5 h total
        </div>
      </div>

      <div className="px-5 py-4 flex flex-col gap-2.5">
        {plan.map((s, i) => (
          <div key={`${s.id}-${i}`}>
            <div className="flex items-center gap-3 mb-1.5">
              <div className="w-[26px] h-[26px] rounded-full border-2 border-accent text-accent grid place-items-center text-xs font-extrabold">
                {i + 1}
              </div>
              <div className="text-[11px] font-extrabold tracking-[0.12em] text-muted-fg uppercase">
                {STEP_LABELS[i]}
              </div>
            </div>
            <div className="bg-card border border-border rounded-[14px] overflow-hidden">
              <div
                className="h-[120px]"
                style={{ background: `url(${s.imgUrl}) center/cover` }}
              />
              <div className="p-3.5">
                <div className="text-[15px] font-extrabold text-heading">
                  {s.name}
                </div>
                <div className="text-[11px] text-muted-fg mt-1 flex items-center gap-1.5">
                  <span className="text-accent font-bold">{s.type}</span>
                  <span>·</span>
                  <span>★ {s.rating}</span>
                  <span>·</span>
                  <span>{s.price}</span>
                  <span>·</span>
                  <span>🕒 ~{s.minutes} min</span>
                </div>
                <div className="text-[11px] text-muted-fg italic mt-1">
                  &quot;{s.vibe}&quot;
                </div>
              </div>
            </div>
            {i < plan.length - 1 && (
              <div className="ml-3 text-[11px] text-muted-fg py-1.5 pl-3 border-l-2 border-dashed border-border">
                🚶 ~{6 + i * 2} min walk
              </div>
            )}
          </div>
        ))}
      </div>
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
        "px-3.5 py-2 rounded-full border-[1.5px] text-xs font-bold " +
        (on
          ? "border-accent bg-accent text-accent-fg"
          : "border-border bg-card text-fg")
      }
    >
      {children}
    </button>
  );
}
