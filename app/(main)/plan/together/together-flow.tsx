"use client";

// Plan Together — entry / dispatcher (real-time, v2).
//
// Resolves the room code + identity + host flag on the client only (gated
// behind `ready` to avoid hydration mismatch), then runs the phases:
// Lobby → Settings (host sets when/where/budget) → Swipe (on the filtered
// pool) → Result (walkable plan).

import { useEffect, useMemo, useRef, useState } from "react";
import type { Event, Venue } from "@/lib/types";
import {
  makeMember,
  randomRoomCode,
  useRoom,
  type Member,
} from "@/lib/realtime/room";
import { venueInArea } from "@/lib/regions";
import { isOpenAt, withinBudget } from "@/lib/plan-engine";
import type { Mood } from "@/lib/plan-together-moods";
import { Lobby } from "./_steps/lobby";
import { Settings } from "./_steps/settings";
import { Swipe, deckForRoom } from "./_steps/swipe";
import { Result } from "./_steps/result";

export function TogetherFlow({
  venues,
  events,
  myName,
}: {
  venues: Venue[];
  events: Event[];
  myName: string;
}) {
  const [ready, setReady] = useState(false);
  const codeRef = useRef<string>("");
  const meRef = useRef<Member | null>(null);
  const isHostRef = useRef(false);
  const initedRef = useRef(false);

  useEffect(() => {
    // Resolve identity + host flag exactly once. React StrictMode (dev)
    // double-invokes this effect; on the second pass the room code is already
    // in the URL, which would otherwise read `existing` as set and flip the
    // creator from host → guest. The guard keeps the first decision stable
    // (and makes us resilient to any later remount).
    if (initedRef.current) return;
    initedRef.current = true;
    const existing = new URLSearchParams(window.location.search).get("room");
    const code = existing ?? randomRoomCode();
    if (!existing) {
      window.history.replaceState(null, "", `/plan/together?room=${code}`);
    }
    codeRef.current = code;
    isHostRef.current = !existing; // the room's creator is the host
    meRef.current = makeMember(myName);
    setReady(true);
  }, [myName]);

  if (!ready || !meRef.current) {
    return (
      <div className="px-5 py-16 text-center text-sm text-muted-fg">
        Setting up your room…
      </div>
    );
  }

  return (
    <RoomFlow
      code={codeRef.current}
      me={meRef.current}
      isHost={isHostRef.current}
      venues={venues}
      events={events}
    />
  );
}

function RoomFlow({
  code,
  me,
  isHost,
  venues,
  events,
}: {
  code: string;
  me: Member;
  isHost: boolean;
  venues: Venue[];
  events: Event[];
}) {
  const room = useRoom(code, me, isHost);

  const resolvedWhen = useMemo(
    () => (room.settings ? new Date(room.settings.when.at) : new Date()),
    [room.settings],
  );

  // Venues that satisfy the host's logistics — what the group swipes on.
  const filteredVenues = useMemo(() => {
    const s = room.settings;
    if (!s) return venues;
    return venues.filter(
      (v) =>
        venueInArea(v, s.area) &&
        withinBudget(v.price, s.budget) &&
        isOpenAt(v, resolvedWhen),
    );
  }, [venues, room.settings, resolvedWhen]);

  const questionVenues = useMemo(
    () =>
      pickQuestionVenues(
        filteredVenues.length >= 3 ? filteredVenues : venues,
        deckForRoom(room),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredVenues, venues, room.settings],
  );

  return (
    <div className="pb-4">
      {room.phase === "lobby" && (
        <Lobby room={room} onStart={() => room.sendPhase("settings")} />
      )}
      {room.phase === "settings" && <Settings room={room} venues={venues} />}
      {room.phase === "swipe" && (
        <Swipe room={room} questionVenues={questionVenues} />
      )}
      {room.phase === "result" && (
        <Result
          room={room}
          venues={venues}
          events={events}
          when={resolvedWhen}
        />
      )}
    </div>
  );
}

// One backdrop venue photo per mood card — a real venue of a type the mood
// maps to, so the card behind "cosy wine" shows an actual wine bar. Distinct
// where possible; graceful fallbacks for a thin catalog.
function pickQuestionVenues(venues: Venue[], deck: Mood[]): Venue[] {
  const used = new Set<string>();
  return deck.map((mood, i) => {
    const v =
      venues.find((x) => !used.has(x.id) && mood.types.includes(x.type)) ??
      venues.find((x) => mood.types.includes(x.type)) ??
      venues.find((x) => !used.has(x.id)) ??
      venues[i] ??
      venues[0];
    if (v) used.add(v.id);
    return v;
  });
}
