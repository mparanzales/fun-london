"use client";

import { useMemo } from "react";
import type { Event, Venue } from "@/lib/types";
import type { Member, Room } from "@/lib/realtime/room";
import {
  computeWalkablePlan,
  walkMins,
  type PlanRole,
  type WalkableSettings,
} from "@/lib/plan-engine";

// Plan Together — Step 4: Result (real-time, v2).
// Builds a walkable plan from the host's settings + the group's votes (which
// stop-types they wanted) and shows real attribution per step.

const STEP_LABELS: Record<PlanRole, string> = {
  Start: "Start",
  Then: "Then",
  Finish: "Finish",
};
const ROLE_Q: Record<PlanRole, number> = { Start: 0, Then: 1, Finish: 2 };
const STEP_WORD = ["dinner", "drinks", "a late one"];

function includedRoles(votes: Room["votes"]): PlanRole[] {
  const roles: PlanRole[] = ["Start", "Then", "Finish"];
  const out: PlanRole[] = [];
  roles.forEach((role, q) => {
    const yes = votes.filter((v) => v.qIdx === q && v.value).length;
    const no = votes.filter((v) => v.qIdx === q && !v.value).length;
    if (yes > 0 && yes >= no) out.push(role);
  });
  return out.length ? out : ["Start"];
}

export function Result({
  room,
  venues,
  events,
  when,
}: {
  room: Room;
  venues: Venue[];
  events: Event[];
  when: Date;
}) {
  const settings: WalkableSettings = {
    area: room.settings?.area ?? { kind: "anywhere" },
    budget: room.settings?.budget ?? "Any",
    when,
    groupSize: room.settings?.groupSize ?? Math.max(1, room.members.length),
  };
  const roles = useMemo(() => includedRoles(room.votes), [room.votes]);

  const plan = useMemo(
    () => computeWalkablePlan(venues, settings, roles, events, room.variant),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [venues, events, roles, room.settings, when, room.variant],
  );

  const memberById = new Map(room.members.map((m) => [m.id, m]));
  const total = room.members.length;
  const yesByQ = [0, 1, 2].map(
    (q) => room.votes.filter((v) => v.qIdx === q && v.value).length,
  );

  // Apply any group swaps (deterministic alt index per step) and recompute
  // walk times so the swapped venue's distances stay honest.
  const swapped = plan.steps.map((s, i) => {
    const alt = room.swaps[i];
    const v = alt != null && alt >= 0 ? plan.alternatives[i]?.[alt] : undefined;
    return { role: s.role, dwellMins: s.dwellMins, venue: v ?? s.venue };
  });
  const steps = swapped.map((s, i) => {
    const next = swapped[i + 1]?.venue;
    return { ...s, walkToNextMins: next ? walkMins(s.venue, next) : null };
  });

  const onSwap = (i: number) => {
    const alts = plan.alternatives[i] ?? [];
    if (alts.length === 0) return;
    const cur = room.swaps[i];
    const nextIdx = cur == null ? 0 : cur + 1;
    room.sendSwap(i, nextIdx >= alts.length ? -1 : nextIdx); // -1 = back to base
  };

  return (
    <div className="px-4 pt-4 pb-6">
      <h1 className="text-[22px] font-extrabold text-primary tracking-tight m-0">
        Your group&apos;s night
      </h1>
      <div className="text-[11px] text-muted-fg mt-1">
        🫂 {total} {total === 1 ? "person" : "people"} · 🚶 walkable · 🕒 ~
        {(plan.totalMins / 60).toFixed(1)} h
      </div>

      <div className="bg-accent/10 border border-accent/30 rounded-xl px-3 py-2.5 mt-3">
        <div className="text-[10px] font-extrabold text-accent uppercase tracking-[0.1em]">
          ✦ How we mixed it
        </div>
        <div className="text-[11.5px] text-fg mt-1 leading-snug">
          {yesByQ[0]} of {total} wanted dinner, {yesByQ[1]} drinks, and{" "}
          {yesByQ[2]} a late one — kept it all within walking distance.
        </div>
      </div>

      <div className="mt-3.5 flex flex-col gap-3">
        {steps.map((s, i) => {
          const voters = room.votes
            .filter((v) => v.qIdx === ROLE_Q[s.role] && v.value)
            .map((v) => memberById.get(v.memberId))
            .filter((m): m is Member => Boolean(m));
          const attribution =
            voters.length === 0
              ? "Closest match nearby"
              : voters.length === total
                ? "Unanimous"
                : `${voters.map((p) => p.name).join(" & ")} voted yes`;
          return (
            <div key={`${s.venue.id}-${i}`}>
              <div className="bg-card border border-border rounded-2xl overflow-hidden">
                <div
                  className="h-[110px] relative"
                  style={{ background: `url(${s.venue.imgUrl}) center/cover` }}
                >
                  <div className="absolute top-2 left-2 px-2 py-[3px] rounded-full bg-primary text-primary-fg text-[9px] font-extrabold uppercase tracking-[0.08em]">
                    Step {i + 1} · {STEP_LABELS[s.role]}
                  </div>
                  <div className="absolute top-2 right-2 flex">
                    {voters.map((vp, j) => (
                      <div
                        key={vp.id}
                        className="w-[22px] h-[22px] rounded-full border-2 border-white grid place-items-center text-[10px]"
                        style={{ background: vp.color, marginLeft: j ? -6 : 0 }}
                      >
                        {vp.emoji}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="p-3">
                  <div className="text-sm font-extrabold text-heading">
                    {s.venue.name}
                  </div>
                  <div className="text-[10.5px] text-muted-fg mt-0.5 flex gap-1.5">
                    <span className="text-accent font-bold">
                      {s.venue.type}
                    </span>
                    <span>·</span>
                    <span>{s.venue.neighbourhood}</span>
                    <span>·</span>
                    <span>{s.venue.price}</span>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <div className="text-[10.5px] text-muted-fg italic">
                      {attribution}
                    </div>
                    {(plan.alternatives[i]?.length ?? 0) > 0 && (
                      <button
                        type="button"
                        onClick={() => onSwap(i)}
                        className="text-[11px] font-extrabold text-accent flex-shrink-0"
                      >
                        ↻ Swap
                      </button>
                    )}
                  </div>
                </div>
              </div>
              {s.walkToNextMins != null && (
                <div className="ml-3 text-[10px] text-muted-fg py-1.5 pl-3 border-l-2 border-dashed border-border">
                  🚶 ~{s.walkToNextMins} min walk
                </div>
              )}
            </div>
          );
        })}
      </div>

      {plan.event && (
        <div className="mt-3 rounded-2xl border border-accent/30 bg-accent/10 p-3">
          <div className="text-[10px] font-extrabold text-accent uppercase tracking-[0.1em]">
            ✦ Happening nearby
          </div>
          <div className="text-[13px] font-extrabold text-heading mt-1">
            {plan.event.event.name}
          </div>
          <div className="text-[11px] text-muted-fg mt-0.5">
            {plan.event.event.venueName} · {plan.event.event.timeLabel}
          </div>
        </div>
      )}

      {plan.unfilledRoles.length > 0 && (
        <p className="text-[11px] text-muted-fg mt-3 leading-snug">
          Couldn&apos;t find an open spot for{" "}
          {plan.unfilledRoles.map((r) => STEP_WORD[ROLE_Q[r]]).join(" or ")}{" "}
          within walking distance — try a different time or area.
        </p>
      )}

      <div className="mt-5 flex flex-col gap-2.5">
        <button
          type="button"
          onClick={() => room.sendVariant(room.variant + 1)}
          className="w-full h-12 rounded-2xl border-[1.5px] border-accent text-accent text-sm font-extrabold"
        >
          Try a different mix ↻
        </button>
        <button
          type="button"
          onClick={() => room.sendPhase("settings")}
          className="w-full h-10 rounded-2xl text-muted-fg text-[13px] font-semibold"
        >
          Change when / where
        </button>
      </div>
    </div>
  );
}
