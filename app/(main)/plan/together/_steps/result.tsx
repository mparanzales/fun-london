"use client";

import { useEffect, useMemo } from "react";
import type { Event, Venue } from "@/lib/types";
import type { Member, Room, StopReaction } from "@/lib/realtime/room";
import { averageTasteMaps } from "@/lib/group-taste";
import { vetoMajority, countReactions } from "@/lib/group-veto";
import {
  computeWalkablePlan,
  walkMins,
  type PlanRole,
  type RoleIntent,
  type WalkableSettings,
} from "@/lib/plan-engine";
import {
  deckTimeFromTimeOfDay,
  intentFromHeartedMoods,
  type Mood,
} from "@/lib/plan-together-moods";
import { DECKS } from "@/lib/plan-together-moods";
import { googleMapsWalkingUrl } from "@/lib/plan-maps";
import { track } from "@/lib/analytics";
import { SwipeStop } from "../../swipe-stop";
import { PlanRouteMapLive } from "../../plan-route-map-live";
import {
  Clock,
  Footprints,
  Map as MapIcon,
  RotateCw,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Users,
} from "lucide-react";

// Plan Together — Step 4: Result (real-time, v2).
// Builds a walkable plan from the host's settings + the group's MOOD votes.
// Each hearted mood (yes ≥ no across the group) contributes its venue types to
// its stop role; the union per role becomes the planner's RoleIntent, so the
// night matches the mood (cosy wine → a wine bar, not just any bar).

const STEP_LABELS: Record<PlanRole, string> = {
  Start: "Start",
  Then: "Then",
  Finish: "Finish",
};

// The moods the group hearted (group yes ≥ no, and at least one yes), in deck
// order. `qIdx` indexes into the deck for the meeting's time of day.
function heartedMoods(room: Room): Mood[] {
  const tod =
    room.settings?.when.kind === "scheduled"
      ? room.settings.when.timeOfDay
      : undefined;
  const deck = DECKS[deckTimeFromTimeOfDay(tod)];
  return deck.filter((_, q) => {
    const yes = room.votes.filter((v) => v.qIdx === q && v.value).length;
    const no = room.votes.filter((v) => v.qIdx === q && !v.value).length;
    return yes > 0 && yes >= no;
  });
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

  // Group taste (Stage 5): every member broadcasts their OWN taste into the
  // room (see together-flow), then each device averages the CURRENT members'
  // maps into one group direction the engine uses to pick the actual spots
  // within the mood-voted types.
  //
  // Convergence barrier: apply taste ONLY once EVERY current member's map has
  // arrived — until then stay rating-led (null), which is deterministic on all
  // devices. Because Broadcast has no replay, maps stream in at different
  // moments per device; without the barrier two phones could average different
  // subsets and build different plans (and a shared swap index would then point
  // at different venues). Signal-less members broadcast {} so this is always
  // reachable; an all-empty average collapses to null (nothing to tune).
  const taste = useMemo(() => {
    if (room.members.length === 0) return null;
    const complete = room.members.every((m) => room.tasteByMember[m.id]);
    if (!complete) return null;
    return averageTasteMaps(room.members.map((m) => room.tasteByMember[m.id]));
  }, [room.members, room.tasteByMember]);
  const hearted = useMemo(() => heartedMoods(room), [room]);
  const roles = useMemo<PlanRole[]>(() => {
    const order: PlanRole[] = ["Start", "Then", "Finish"];
    const out = order.filter((r) => hearted.some((m) => m.role === r));
    return out.length ? out : ["Start"];
  }, [hearted]);
  const intent: RoleIntent = useMemo(
    () => intentFromHeartedMoods(hearted),
    [hearted],
  );
  // Which deck-index each role's moods came from — drives per-step vote
  // attribution (a step is credited to everyone who hearted a mood for it).
  const qIdxByRole = useMemo(() => {
    const tod =
      room.settings?.when.kind === "scheduled"
        ? room.settings.when.timeOfDay
        : undefined;
    const deck = DECKS[deckTimeFromTimeOfDay(tod)];
    const map: Record<PlanRole, number[]> = { Start: [], Then: [], Finish: [] };
    deck.forEach((m, q) => map[m.role].push(q));
    return map;
  }, [room.settings]);

  const plan = useMemo(
    () =>
      computeWalkablePlan(
        venues,
        settings,
        roles,
        events,
        room.variant,
        intent,
        taste,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [venues, events, roles, intent, room.settings, when, room.variant, taste],
  );

  const memberById = new Map(room.members.map((m) => [m.id, m]));
  const total = room.members.length;
  const mixSummary =
    hearted.length > 0
      ? hearted.map((m) => m.label).join(" · ")
      : "Closest matches nearby";

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

  // Group react/veto. Swiping a stop (right = keep, left = change) or tapping
  // Keep / Change casts YOUR vote. My own reaction + per-value tallies:
  const presentIds = new Set(room.members.map((m) => m.id));
  const myReact = (i: number): StopReaction | undefined =>
    room.reactions[i]?.[room.me.id];
  // Count only members still in the room, so a vote lingering from someone who
  // just left can never tip the majority or the tally (race-proof; see the
  // proof harness scripts/prove-group-veto.ts).
  const countReact = (i: number, value: StopReaction) =>
    countReactions(room.reactions[i], value, presentIds);
  const react = (i: number, value: StopReaction) =>
    room.sendReact(i, myReact(i) === value ? null : value);

  // When more than half the LIVE group vetoes a stop that has another option,
  // the HOST advances it to the next alternative for everyone. Only the host
  // acts, so devices don't race. A double swap is prevented by idempotency:
  // sendSwap broadcasts WITHOUT optimistically updating room.swaps, so any
  // re-run in the round-trip window recomputes the same target index; the
  // self-broadcast then advances swaps[i] and clears reactions[i], ending the
  // majority. If the host has left, no device has isHost, so a reached majority
  // simply doesn't apply (a graceful no-op for an ephemeral room). Departed
  // members' votes are pruned in room.ts, so a leave can't cross the threshold.
  useEffect(() => {
    if (!room.isHost || total === 0) return;
    plan.alternatives.forEach((alts, i) => {
      if ((alts?.length ?? 0) === 0) return;
      if (vetoMajority(countReact(i, "veto"), total)) {
        const len = alts.length + 1;
        const pos = ((((room.swaps[i] ?? -1) + 2) % len) + len) % len;
        room.sendSwap(i, pos - 1);
        track("plan_swap", { stop: i, dir: 1 });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.reactions, room.swaps, room.isHost, total, plan]);

  // Real turn-by-turn for the whole night in Google Maps (null if no coords).
  const mapsUrl = googleMapsWalkingUrl(
    steps.map((s) => ({
      lat: s.venue.lat,
      lng: s.venue.lng,
      name: s.venue.name,
    })),
  );

  return (
    <div className="px-4 pt-4 pb-6">
      <h1 className="text-[22px] font-extrabold text-primary tracking-tight m-0">
        Your group&apos;s night
      </h1>
      <div className="text-[11px] text-muted-fg mt-1">
        <Users
          className="w-3.5 h-3.5 inline-block align-[-3px]"
          strokeWidth={1.75}
          aria-hidden
        />{" "}
        {total} {total === 1 ? "person" : "people"} ·{" "}
        <Footprints
          className="w-3.5 h-3.5 inline-block align-[-3px]"
          strokeWidth={1.75}
          aria-hidden
        />{" "}
        walkable ·{" "}
        <Clock
          className="w-3.5 h-3.5 inline-block align-[-3px]"
          strokeWidth={1.75}
          aria-hidden
        />{" "}
        ~{(plan.totalMins / 60).toFixed(1)} h
      </div>

      <div className="bg-accent/10 border border-accent/30 rounded-xl px-3 py-2.5 mt-3">
        <div className="text-[10px] font-extrabold text-accent uppercase tracking-[0.1em]">
          <Sparkles
            className="w-3.5 h-3.5 inline-block align-[-3px]"
            strokeWidth={1.75}
            aria-hidden
          />{" "}
          How we mixed it
        </div>
        <div className="text-[11.5px] text-fg mt-1 leading-snug">
          The group&apos;s vibe: {mixSummary}, kept it all within walking
          distance{taste ? ", and tuned to your group's taste" : ""}.
        </div>
      </div>

      {plan.alternatives.some((a) => (a?.length ?? 0) > 0) && (
        <p className="mt-2.5 px-0.5 text-[11px] text-muted-fg leading-snug">
          Not feeling a stop? Swipe it or tap Change. If most of the group
          agrees, it swaps to another option.
        </p>
      )}

      <div className="mt-3.5 flex flex-col gap-3">
        {steps.map((s, i) => {
          const roleQs = qIdxByRole[s.role] ?? [];
          const voterIds = new Set(
            room.votes
              .filter((v) => roleQs.includes(v.qIdx) && v.value)
              .map((v) => v.memberId),
          );
          const voters = [...voterIds]
            .map((id) => memberById.get(id))
            .filter((m): m is Member => Boolean(m));
          const attribution =
            voters.length === 0
              ? "Closest match nearby"
              : voters.length === total
                ? "Unanimous"
                : `${voters.map((p) => p.name).join(" & ")} voted yes`;
          return (
            <div key={`${s.venue.id}-${i}`}>
              <SwipeStop
                enabled={(plan.alternatives[i]?.length ?? 0) > 0}
                onSwipe={(dir) => react(i, dir === 1 ? "veto" : "keep")}
              >
                <div className="bg-card border border-border rounded-2xl overflow-hidden">
                  <div
                    className="h-[110px] relative"
                    style={{
                      background: `url(${s.venue.imgUrl}) center/cover`,
                    }}
                  >
                    <div className="absolute top-2 left-2 px-2 py-[3px] rounded-full bg-primary text-primary-fg text-[9px] font-extrabold uppercase tracking-[0.08em]">
                      Step {i + 1} · {STEP_LABELS[s.role]}
                    </div>
                    <div className="absolute top-2 right-2 flex">
                      {voters.map((vp, j) => (
                        <div
                          key={vp.id}
                          className="w-[22px] h-[22px] rounded-full border-2 border-white grid place-items-center text-[10px] font-bold text-white"
                          style={{
                            background: vp.color,
                            marginLeft: j ? -6 : 0,
                          }}
                        >
                          {vp.name.charAt(0).toUpperCase()}
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
                    <div className="text-[10.5px] text-muted-fg italic mt-1">
                      {attribution}
                    </div>
                    {(plan.alternatives[i]?.length ?? 0) > 0 && (
                      <div className="flex items-center gap-2 mt-2">
                        <button
                          type="button"
                          onClick={() => react(i, "keep")}
                          aria-pressed={myReact(i) === "keep"}
                          className={
                            "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold " +
                            (myReact(i) === "keep"
                              ? "border-accent bg-accent/10 text-accent"
                              : "border-border text-muted-fg")
                          }
                        >
                          <ThumbsUp
                            className="w-3.5 h-3.5"
                            strokeWidth={1.75}
                            aria-hidden
                          />
                          Keep
                          {countReact(i, "keep") > 0
                            ? ` ${countReact(i, "keep")}`
                            : ""}
                        </button>
                        <button
                          type="button"
                          onClick={() => react(i, "veto")}
                          aria-pressed={myReact(i) === "veto"}
                          className={
                            "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold " +
                            (myReact(i) === "veto"
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border text-muted-fg")
                          }
                        >
                          <ThumbsDown
                            className="w-3.5 h-3.5"
                            strokeWidth={1.75}
                            aria-hidden
                          />
                          Change
                          {countReact(i, "veto") > 0
                            ? ` ${countReact(i, "veto")}`
                            : ""}
                        </button>
                        {countReact(i, "veto") > 0 && (
                          <span className="ml-auto text-[10px] text-muted-fg">
                            {countReact(i, "veto")}/{total} want to change
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </SwipeStop>
              {s.walkToNextMins != null && (
                <div className="ml-3 text-[10px] text-muted-fg py-1.5 pl-3 border-l-2 border-dashed border-border">
                  <Footprints
                    className="w-3.5 h-3.5 inline-block align-[-3px]"
                    strokeWidth={1.75}
                    aria-hidden
                  />{" "}
                  ~{s.walkToNextMins} min walk
                </div>
              )}
            </div>
          );
        })}
      </div>

      {mapsUrl && (
        <div className="mt-4">
          <div className="text-[10px] font-extrabold tracking-[0.12em] text-muted-fg uppercase mb-2">
            The walk
          </div>
          <PlanRouteMapLive steps={steps} />
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => track("plan_open_maps", { stops: steps.length })}
            className="mt-2.5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl border-[1.5px] border-border bg-card text-[14px] font-extrabold text-fg"
          >
            <MapIcon className="w-4 h-4" strokeWidth={1.75} aria-hidden />
            Open in Google Maps
          </a>
        </div>
      )}

      {plan.event && (
        <div className="mt-3 rounded-2xl border border-accent/30 bg-accent/10 p-3">
          <div className="text-[10px] font-extrabold text-accent uppercase tracking-[0.1em]">
            <Sparkles
              className="w-3.5 h-3.5 inline-block align-[-3px]"
              strokeWidth={1.75}
              aria-hidden
            />{" "}
            Happening nearby
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
          {plan.unfilledRoles.map((r) => STEP_LABELS[r]).join(" or ")} within
          walking distance, try a different time or area.
        </p>
      )}

      <div className="mt-5 flex flex-col gap-2.5">
        <button
          type="button"
          onClick={() => room.sendVariant(room.variant + 1)}
          className="w-full h-12 rounded-2xl border-[1.5px] border-accent text-accent text-sm font-extrabold inline-flex items-center justify-center gap-1.5"
        >
          Try a different mix
          <RotateCw className="w-4 h-4" strokeWidth={1.75} aria-hidden />
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
