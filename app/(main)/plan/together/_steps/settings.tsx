"use client";

// Plan Together — Step 2: Settings (host sets the logistics once).
// Joiners see a read-only "host is choosing" view and wait for the swipe.

import { useMemo, useState } from "react";
import type { Venue } from "@/lib/types";
import { regionsWithVenues, type PlanArea, type Region } from "@/lib/regions";
import type { PlanBudget } from "@/lib/plan-engine";
import type { PlanWhen, Room, RoomSettings } from "@/lib/realtime/room";

const TOD_HOUR: Record<"Day" | "Evening" | "Night", number> = {
  Day: 14,
  Evening: 19,
  Night: 23,
};

function nextOccurrenceMs(dayOffset: number, hour: number): number {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}

export function Settings({ room, venues }: { room: Room; venues: Venue[] }) {
  const regions = useMemo(() => regionsWithVenues(venues), [venues]);
  const neighbourhoods = useMemo(
    () => Array.from(new Set(venues.map((v) => v.neighbourhood))).sort(),
    [venues],
  );

  const [mode, setMode] = useState<"now" | "later">("now");
  const [dayOffset, setDayOffset] = useState(0);
  const [tod, setTod] = useState<"Day" | "Evening" | "Night">("Evening");
  const [area, setArea] = useState<PlanArea>({ kind: "anywhere" });
  const [budget, setBudget] = useState<PlanBudget>("Any");
  const [groupSize, setGroupSize] = useState(Math.max(2, room.members.length));

  const dayChips = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() + i);
        const label =
          i === 0
            ? "Today"
            : i === 1
              ? "Tomorrow"
              : d.toLocaleDateString("en-GB", { weekday: "short" });
        return { offset: i, label, day: d.getDay() };
      }),
    [],
  );

  // ── Joiner: read-only ──────────────────────────────────────────────────
  if (!room.isHost) {
    return (
      <div className="px-5 py-10 text-center">
        <div className="text-[40px] mb-2">🗺️</div>
        <h1 className="text-xl font-extrabold text-heading">
          The host is setting the plan…
        </h1>
        {room.settings ? (
          <p className="text-sm text-muted-fg mt-2">
            {summarize(room.settings)} — hang tight, swiping starts in a sec.
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
    const when: PlanWhen =
      mode === "now"
        ? { kind: "now", at: Date.now() }
        : {
            kind: "scheduled",
            at: nextOccurrenceMs(dayOffset, TOD_HOUR[tod]),
            day: dayChips[dayOffset].day,
            timeOfDay: tod,
          };
    const settings: RoomSettings = {
      hostId: room.me.id,
      when,
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
        <div className="flex gap-2 mb-2">
          <Chip on={mode === "now"} onClick={() => setMode("now")}>
            Now
          </Chip>
          <Chip on={mode === "later"} onClick={() => setMode("later")}>
            Pick a day
          </Chip>
        </div>
        {mode === "later" && (
          <>
            <div className="flex gap-1.5 flex-wrap mb-2">
              {dayChips.map((d) => (
                <Chip
                  key={d.offset}
                  on={dayOffset === d.offset}
                  onClick={() => setDayOffset(d.offset)}
                  small
                >
                  {d.label}
                </Chip>
              ))}
            </div>
            <div className="flex gap-1.5">
              {(["Day", "Evening", "Night"] as const).map((t) => (
                <Chip key={t} on={tod === t} onClick={() => setTod(t)} small>
                  {t === "Day"
                    ? "Daytime"
                    : t === "Evening"
                      ? "Evening"
                      : "Late"}
                </Chip>
              ))}
            </div>
          </>
        )}
      </Group>

      <Group label="Where">
        <div className="flex gap-1.5 flex-wrap">
          <Chip
            on={area.kind === "anywhere"}
            onClick={() => setArea({ kind: "anywhere" })}
            small
          >
            Anywhere
          </Chip>
          {regions.map((r: Region) => (
            <Chip
              key={r}
              on={area.kind === "region" && area.region === r}
              onClick={() => setArea({ kind: "region", region: r })}
              small
            >
              {r}
            </Chip>
          ))}
        </div>
        <select
          value={area.kind === "neighbourhood" ? area.name : ""}
          onChange={(e) =>
            e.target.value
              ? setArea({ kind: "neighbourhood", name: e.target.value })
              : setArea({ kind: "anywhere" })
          }
          className="mt-2 w-full h-10 rounded-xl bg-card border border-border px-3 text-fg text-[13px]"
        >
          <option value="">…or a specific neighbourhood</option>
          {neighbourhoods.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </Group>

      <Group label="Budget">
        <div className="flex gap-2">
          {(["£", "££", "Any"] as PlanBudget[]).map((b) => (
            <Chip key={b} on={budget === b} onClick={() => setBudget(b)}>
              {b}
            </Chip>
          ))}
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
        Lock it in — start swiping
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
  small,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        (small ? "px-3 py-2 text-[12px] " : "px-4 py-2.5 text-[13px] ") +
        "rounded-full border-[1.5px] font-bold " +
        (on
          ? "border-accent bg-accent text-accent-fg"
          : "border-border bg-card text-fg")
      }
    >
      {children}
    </button>
  );
}
