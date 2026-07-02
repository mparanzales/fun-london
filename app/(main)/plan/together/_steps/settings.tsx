"use client";

// Plan Together — Step 2: Settings (host sets the logistics once).
// Joiners see a read-only "host is choosing" view and wait for the swipe.
//
// When / Where / Budget mirror the SOLO plan's setup (app/(main)/plan/plan-flow)
// so the two flows feel the same: the same four When choices (with a date +
// time picker), the same Area "pop-out region + a-spot-in ghost dropdown", and
// the same budget grid. The host's choice resolves to an ABSOLUTE meeting time
// (PlanWhen.at) so every device builds the identical plan. ("Near you" is solo-
// only on purpose — a group plans around a shared area, not one person's spot.)

import { useMemo, useState } from "react";
import type { Venue } from "@/lib/types";
import {
  Map as MapIcon,
  Zap,
  Sun,
  Moon,
  CalendarClock,
  Globe,
  ChevronDown,
  Check,
  type LucideIcon,
} from "lucide-react";
import { REGIONS, regionOf, type PlanArea, type Region } from "@/lib/regions";
import type { PlanBudget } from "@/lib/plan-engine";
import type { PlanWhen, Room, RoomSettings } from "@/lib/realtime/room";

type WhenChoice = "now" | "day" | "evening" | "custom";
const WHENS: { v: WhenChoice; label: string; icon: LucideIcon }[] = [
  { v: "now", label: "Right now", icon: Zap },
  { v: "day", label: "Today", icon: Sun },
  { v: "evening", label: "Tonight", icon: Moon },
  { v: "custom", label: "Pick a day", icon: CalendarClock },
];

// Local YYYY-MM-DD (what <input type="date"> expects) in the browser's TZ.
function localISODate(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function todDfrom(hour: number): "Morning" | "Afternoon" | "Night" {
  return hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Night";
}

// Resolve the host's choice into an absolute meeting time so all devices agree.
// "Today" = this afternoon, "Tonight" = this evening, "Pick a day" = the chosen
// date + time. The timeOfDay drives the mood deck (deckTimeFromTimeOfDay).
function resolveWhen(
  choice: WhenChoice,
  dateStr: string,
  timeStr: string,
): PlanWhen {
  if (choice === "now") return { kind: "now", at: Date.now() };
  const d = choice === "custom" ? new Date(`${dateStr}T00:00:00`) : new Date();
  let hour: number;
  if (choice === "day") hour = 14;
  else if (choice === "evening") hour = 20;
  else {
    const [hh, mm] = timeStr.split(":");
    hour = Number(hh) || 20;
    d.setMinutes(Number(mm) || 0, 0, 0);
  }
  d.setHours(hour, choice === "custom" ? d.getMinutes() : 0, 0, 0);
  return {
    kind: "scheduled",
    at: d.getTime(),
    day: d.getDay(),
    timeOfDay: todDfrom(hour),
  };
}

export function Settings({ room, venues }: { room: Room; venues: Venue[] }) {
  const todayISO = localISODate();

  // Regions that actually have venues + each region's neighbourhoods (most-
  // stocked first) for the drill-down — built from the catalogue so a chip
  // never points at an empty region. Same as the solo plan.
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

  const [choice, setChoice] = useState<WhenChoice>("now");
  const [dateStr, setDateStr] = useState(todayISO);
  const [timeStr, setTimeStr] = useState("20:00");
  const [area, setArea] = useState<PlanArea>({ kind: "anywhere" });
  const [areaOpen, setAreaOpen] = useState(false);
  const [spotOpen, setSpotOpen] = useState(false);
  const [budget, setBudget] = useState<PlanBudget>("Any");
  const [groupSize, setGroupSize] = useState(Math.max(2, room.members.length));

  // The region in play (chosen directly, or the region of the chosen
  // neighbourhood) — drives the "a spot in …" dropdown.
  const activeRegion: Region | null =
    area.kind === "region"
      ? area.region
      : area.kind === "neighbourhood"
        ? regionOf(area.name)
        : null;

  const chooseAnywhere = () => {
    setArea({ kind: "anywhere" });
    setAreaOpen(false);
    setSpotOpen(false);
  };
  const chooseRegion = (region: Region) => {
    setArea({ kind: "region", region });
    setAreaOpen(false);
    setSpotOpen(true);
  };
  const chooseSpot = (region: Region, name: string | null) => {
    setArea(
      name ? { kind: "neighbourhood", name } : { kind: "region", region },
    );
    setSpotOpen(false);
  };

  // ── Joiner: read-only ──────────────────────────────────────────────────
  if (!room.isHost) {
    return (
      <div className="px-5 py-10 text-center">
        <MapIcon
          className="w-10 h-10 text-muted-fg mb-2 mx-auto"
          strokeWidth={1.75}
          aria-hidden
        />
        <h1 className="text-xl font-extrabold text-heading">
          The host is setting the plan…
        </h1>
        {room.settings ? (
          <p className="text-sm text-muted-fg mt-2">
            {summarize(room.settings)}, hang tight, swiping starts in a sec.
          </p>
        ) : (
          <p className="text-sm text-muted-fg mt-2">
            When, where and budget. Then you all swipe.
          </p>
        )}
      </div>
    );
  }

  const onLock = () => {
    const settings: RoomSettings = {
      hostId: room.me.id,
      when: resolveWhen(choice, dateStr, timeStr),
      area,
      budget,
      groupSize,
    };
    room.sendSettings(settings);
    room.sendPhase("swipe");
  };

  return (
    <div className="px-5 py-4">
      <div className="text-[11px] font-extrabold text-primary uppercase tracking-[0.12em]">
        Set the plan
      </div>
      <h1 className="text-2xl font-extrabold text-heading mt-1 mb-4 tracking-tight">
        When, where, how much
      </h1>

      <Group label="When">
        <div className="grid grid-cols-2 gap-2">
          {WHENS.map((w) => {
            const on = choice === w.v;
            return (
              <button
                key={w.v}
                type="button"
                onClick={() => setChoice(w.v)}
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
              value={dateStr}
              min={todayISO}
              onChange={(e) => setDateStr(e.target.value)}
              aria-label="Pick a date"
              className="h-11 rounded-xl border-[1.5px] border-border bg-card text-fg font-bold text-[13px] px-3.5"
            />
            <input
              type="time"
              value={timeStr}
              onChange={(e) => setTimeStr(e.target.value)}
              aria-label="Pick a start time"
              className="h-11 rounded-xl border-[1.5px] border-border bg-card text-fg font-bold text-[13px] px-3.5"
            />
          </div>
        )}
      </Group>

      <Group label="Area">
        <div className="flex gap-2 flex-wrap items-center">
          <Chip on={area.kind === "anywhere"} onClick={chooseAnywhere}>
            <Globe
              className="w-3.5 h-3.5 inline-block align-[-2px] mr-1"
              strokeWidth={1.75}
              aria-hidden
            />
            Anywhere
          </Chip>

          {/* "Area" chip — its region list pops out FROM the chip. */}
          {regionsWith.length > 0 && (
            <div className="relative">
              <Chip
                on={area.kind === "region" || area.kind === "neighbourhood"}
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
                  {area.kind === "neighbourhood" ? area.name : "anywhere here"}
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
                    (area.kind === "region"
                      ? "font-extrabold text-accent"
                      : "text-muted-fg")
                  }
                >
                  Anywhere in {activeRegion}
                </button>
                {(hoodsByRegion.get(activeRegion) ?? []).map(({ name }) => {
                  const on =
                    area.kind === "neighbourhood" && area.name === name;
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
      </Group>

      <Group label="Budget">
        <div className="grid grid-cols-3 gap-2">
          {(["£", "££", "Any"] as PlanBudget[]).map((b) => {
            const on = budget === b;
            return (
              <button
                key={b}
                type="button"
                onClick={() => setBudget(b)}
                className={
                  "h-11 rounded-xl border-[1.5px] text-fg font-extrabold text-[13px] " +
                  (on ? "border-accent bg-accent/10" : "border-border bg-card")
                }
              >
                {b}
              </button>
            );
          })}
        </div>
      </Group>

      <Group label="Group size">
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Fewer"
            onClick={() => setGroupSize((p) => Math.max(1, p - 1))}
            className="w-9 h-9 rounded-full border border-border text-fg text-lg leading-none"
          >
            −
          </button>
          <span className="w-6 text-center font-extrabold text-fg">
            {groupSize}
          </span>
          <button
            type="button"
            aria-label="More"
            onClick={() => setGroupSize((p) => Math.min(20, p + 1))}
            className="w-9 h-9 rounded-full border border-border text-fg text-lg leading-none"
          >
            +
          </button>
        </div>
      </Group>

      <button
        type="button"
        onClick={onLock}
        className="mt-4 w-full h-[52px] rounded-2xl bg-primary text-primary-fg text-sm font-extrabold"
      >
        Lock it in, start swiping
      </button>
    </div>
  );
}

function summarize(s: RoomSettings): string {
  const when =
    s.when.kind === "now" ? "now" : `${s.when.timeOfDay.toLowerCase()}`;
  const where =
    s.area.kind === "anywhere"
      ? "anywhere"
      : s.area.kind === "region"
        ? s.area.region
        : s.area.name;
  return `${when} · ${where} · ${s.budget}`;
}

function Group({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="pb-4">
      <div className="text-[11px] font-extrabold text-muted-fg tracking-[0.12em] uppercase mb-2">
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
        "px-4 py-2.5 text-[13px] rounded-full border-[1.5px] font-bold " +
        (on
          ? "border-accent bg-accent text-accent-fg"
          : "border-border bg-card text-fg")
      }
    >
      {children}
    </button>
  );
}
