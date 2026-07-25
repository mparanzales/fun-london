"use client";

// Plan Together — Step 2: Settings (host sets the logistics once).
// Joiners see a read-only "host is choosing" view and wait for the swipe.
//
// When / Area use the SAME shared controls as the solo plan (../../plan-controls)
// so the two flows can't drift. The host's choice resolves to an ABSOLUTE meeting
// time (PlanWhen.at) so every device builds the identical plan. ("Near you" is
// solo-only — a group plans around a shared area, not one person's spot — so the
// AreaPicker's optional nearYou prop is simply not passed here.)

import { useState } from "react";
import type { Venue } from "@/lib/types";
import { Map as MapIcon } from "lucide-react";
import type { PlanArea } from "@/lib/regions";
import type { PlanBudget } from "@/lib/plan-engine";
import type { PlanWhen, Room, RoomSettings } from "@/lib/realtime/room";
import {
  WhenPicker,
  AreaPicker,
  toISODate,
  toPlanArea,
  type WhenChoice,
} from "../../plan-controls";

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
  const todayISO = toISODate(new Date());

  const [choice, setChoice] = useState<WhenChoice>("now");
  const [dateStr, setDateStr] = useState(todayISO);
  const [timeStr, setTimeStr] = useState("20:00");
  const [area, setArea] = useState<PlanArea>({ kind: "anywhere" });
  const [budget, setBudget] = useState<PlanBudget>("Any");
  const [groupSize, setGroupSize] = useState(Math.max(2, room.members.length));

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
        <WhenPicker
          choice={choice}
          dateStr={dateStr}
          timeStr={timeStr}
          minDate={todayISO}
          onChange={(next) => {
            setChoice(next.choice);
            setDateStr(next.dateStr);
            setTimeStr(next.timeStr);
          }}
        />
      </Group>

      <Group label="Area">
        <AreaPicker
          value={area}
          venues={venues}
          onChange={(a) => setArea(toPlanArea(a))}
        />
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
