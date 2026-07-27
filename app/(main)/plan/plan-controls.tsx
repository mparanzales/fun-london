"use client";

// Shared plan setup controls — used by BOTH the solo plan (plan-flow.tsx) and
// Plan Together's host settings (together/_steps/settings.tsx) so the two can't
// drift. These are PRESENTATIONAL + CONTROLLED: they render the When and Area
// pickers and call back on change; each flow keeps its own state and resolves
// the answer into its own model (solo → daypart/clock; group → an absolute
// meeting time). Wrap them in each flow's own <Group label> for spacing.

import { useMemo, useState } from "react";
import {
  Zap,
  Sun,
  Moon,
  CalendarClock,
  Globe,
  Navigation,
  ChevronDown,
  Check,
  type LucideIcon,
} from "lucide-react";
import type { Venue } from "@/lib/types";
import { REGIONS, regionOf, type PlanArea, type Region } from "@/lib/regions";

// ── When ──────────────────────────────────────────────────────────────────
export type WhenChoice = "now" | "day" | "evening" | "custom";
export const WHENS: { v: WhenChoice; label: string; icon: LucideIcon }[] = [
  { v: "now", label: "Right now", icon: Zap },
  { v: "day", label: "Today", icon: Sun },
  { v: "evening", label: "Tonight", icon: Moon },
  { v: "custom", label: "Pick a day", icon: CalendarClock },
];

// Local YYYY-MM-DD (what <input type="date"> expects), in the browser's TZ.
export function toISODate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * The four When choices + a date/time picker for "Pick a day". Controlled: the
 * parent owns { choice, dateStr, timeStr } and maps it to its own timing model.
 * `dateStr` "" means "today"; `minDate` is the floor (no planning the past).
 */
export function WhenPicker({
  choice,
  dateStr,
  timeStr,
  minDate,
  onChange,
}: {
  choice: WhenChoice;
  dateStr: string;
  timeStr: string;
  minDate: string;
  onChange: (next: {
    choice: WhenChoice;
    dateStr: string;
    timeStr: string;
  }) => void;
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        {WHENS.map((w) => {
          const on = choice === w.v;
          return (
            <button
              key={w.v}
              type="button"
              onClick={() => onChange({ choice: w.v, dateStr, timeStr })}
              className={
                "px-3.5 py-3 rounded-[14px] border-[1.5px] text-fg text-left flex items-center gap-2 text-[13px] font-bold " +
                (on ? "border-accent bg-accent/10" : "border-border bg-card")
              }
            >
              <w.icon className="w-5 h-5" strokeWidth={1.75} aria-hidden />
              {w.label}
            </button>
          );
        })}
      </div>
      {choice === "custom" && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <input
            type="date"
            value={dateStr || minDate}
            min={minDate}
            onChange={(e) =>
              onChange({ choice, dateStr: e.target.value, timeStr })
            }
            aria-label="Pick a date"
            className="h-11 rounded-xl border-[1.5px] border-border bg-card text-fg font-bold text-[13px] px-3.5"
          />
          <input
            type="time"
            value={timeStr}
            onChange={(e) =>
              onChange({ choice, dateStr, timeStr: e.target.value })
            }
            aria-label="Pick a start time"
            className="h-11 rounded-xl border-[1.5px] border-border bg-card text-fg font-bold text-[13px] px-3.5"
          />
        </div>
      )}
    </>
  );
}

// ── Area ──────────────────────────────────────────────────────────────────
// The WHERE selection. Anywhere / Near you (solo only) / a region / a specific
// neighbourhood. "Near you" isn't part of the engine's PlanArea (it's anywhere +
// a centre), so it's tracked as a distinct UI kind here.
export type AreaSel =
  | { kind: "anywhere" }
  | { kind: "nearYou" }
  | { kind: "region"; region: Region }
  | { kind: "neighbourhood"; name: string };

// Translate the UI selection into the engine's PlanArea. Anywhere + nearYou both
// scope to anywhere (nearYou additionally passes a centre, handled by the caller).
export function toPlanArea(sel: AreaSel): PlanArea {
  if (sel.kind === "region") return { kind: "region", region: sel.region };
  if (sel.kind === "neighbourhood")
    return { kind: "neighbourhood", name: sel.name };
  return { kind: "anywhere" };
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

/**
 * Anywhere + (optional) Near you chips, an "Area" pop-out of the regions that
 * actually have venues, and a "A spot in {region}" ghost dropdown. Controlled:
 * the parent owns the AreaSel value. Near you renders only when `nearYou` is
 * passed (solo); its geolocation/centre live in the parent, so this just shows
 * the chip + state and calls `nearYou.onPick`.
 */
export function AreaPicker({
  value,
  venues,
  neighbourhoods,
  onChange,
  nearYou,
}: {
  value: AreaSel;
  venues: Venue[];
  // Anon variant: the signed-in flow derives area options from the full plan
  // catalogue, which an anon client never holds (the engine runs server-side
  // for anon — moat). Pass precomputed { name, count } pairs instead;
  // neighbourhood is a public card column, so this leaks nothing.
  neighbourhoods?: { name: string; n: number }[];
  onChange: (next: AreaSel) => void;
  nearYou?: { state: "idle" | "pending" | "denied"; onPick: () => void };
}) {
  const [areaOpen, setAreaOpen] = useState(false);
  const [spotOpen, setSpotOpen] = useState(false);

  // Regions that actually have venues + each region's neighbourhoods (most-
  // stocked first) for the drill-down — so a chip never points at an empty area.
  const { regionsWith, hoodsByRegion } = useMemo(() => {
    const counts = new Map<string, number>();
    if (neighbourhoods) {
      for (const { name, n } of neighbourhoods) {
        const nm = name?.trim();
        if (nm && n > 0) counts.set(nm, n);
      }
    } else {
      for (const v of venues) {
        const n = v.neighbourhood?.trim();
        if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
      }
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
  }, [venues, neighbourhoods]);

  const activeRegion: Region | null =
    value.kind === "region"
      ? value.region
      : value.kind === "neighbourhood"
        ? regionOf(value.name)
        : null;

  const chooseAnywhere = () => {
    onChange({ kind: "anywhere" });
    setAreaOpen(false);
    setSpotOpen(false);
  };
  const chooseRegion = (region: Region) => {
    onChange({ kind: "region", region });
    setAreaOpen(false);
    setSpotOpen(true);
  };
  const chooseSpot = (region: Region, name: string | null) => {
    onChange(
      name ? { kind: "neighbourhood", name } : { kind: "region", region },
    );
    setSpotOpen(false);
  };

  return (
    <>
      <div className="flex gap-2 flex-wrap items-center">
        <Chip on={value.kind === "anywhere"} onClick={chooseAnywhere}>
          <Globe
            className="w-3.5 h-3.5 inline-block align-[-2px] mr-1"
            strokeWidth={1.75}
            aria-hidden
          />
          Anywhere
        </Chip>
        {nearYou && (
          <Chip
            on={value.kind === "nearYou"}
            onClick={() => {
              setAreaOpen(false);
              setSpotOpen(false);
              nearYou.onPick();
            }}
          >
            <Navigation
              className="w-3.5 h-3.5 inline-block align-[-2px] mr-1"
              strokeWidth={1.75}
              aria-hidden
            />
            {nearYou.state === "pending" ? "Locating…" : "Near you"}
          </Chip>
        )}

        {/* "Area" chip — its region list pops out FROM the chip. */}
        {regionsWith.length > 0 && (
          <div className="relative">
            <Chip
              on={value.kind === "region" || value.kind === "neighbourhood"}
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

      {/* "A spot in {region}" ghost dropdown — only once a region is chosen. */}
      {activeRegion && (hoodsByRegion.get(activeRegion)?.length ?? 0) > 0 && (
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
                {value.kind === "neighbourhood" ? value.name : "anywhere here"}
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
                  (value.kind === "region"
                    ? "font-extrabold text-accent"
                    : "text-muted-fg")
                }
              >
                Anywhere in {activeRegion}
              </button>
              {(hoodsByRegion.get(activeRegion) ?? []).map(({ name }) => {
                const on =
                  value.kind === "neighbourhood" && value.name === name;
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
                      <Check className="w-4 h-4" strokeWidth={2} aria-hidden />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {nearYou?.state === "denied" && (
        <div className="text-[11px] text-muted-fg mt-2">
          Couldn&apos;t get your location. Showing spots across London instead.
        </div>
      )}
    </>
  );
}
