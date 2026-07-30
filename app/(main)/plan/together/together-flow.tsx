"use client";

// Plan Together — entry / dispatcher (real-time, v2).
//
// Resolves the room code + identity + host flag on the client only (gated
// behind `ready` to avoid hydration mismatch), then runs the phases:
// Lobby → Settings (host sets when/where/budget) → Swipe (on the filtered
// pool) → Result (walkable plan).

import { useEffect, useMemo, useRef, useState } from "react";
import type { Event, Venue } from "@/lib/types";
import { memberFromSession, useRoom, type Member } from "@/lib/realtime/room";
import { createRoom, joinRoom, leaveRoom, closeRoom } from "@/lib/room-action";
import { normaliseRoomCode } from "@/lib/room-code";
import {
  readRoomInvite,
  armRoomInvite,
  clearRoomInvite,
} from "@/lib/room-invite";
import {
  failureFromJoin,
  ROOM_FAILURE_COPY,
  type RoomFailure,
} from "@/lib/room-errors";
import { venueInArea } from "@/lib/regions";
import { isOpenAt, withinBudget } from "@/lib/plan-engine";
import { loadMyTaste } from "@/lib/my-taste-action";
import { track } from "@/lib/analytics";
import type { Mood } from "@/lib/plan-together-moods";
import { Lobby } from "./_steps/lobby";
import { Settings } from "./_steps/settings";
import { Swipe, deckForRoom } from "./_steps/swipe";
import { Result } from "./_steps/result";

export function TogetherFlow({
  venues,
  events,
  myName,
  myUserId,
}: {
  venues: Venue[];
  events: Event[];
  myName: string;
  /** The authenticated user id — the ONLY source of member identity. */
  myUserId: string;
}) {
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<RoomFailure | null>(null);
  const codeRef = useRef<string>("");
  const roomIdRef = useRef<string>("");
  const hostRef = useRef<string>("");
  const meRef = useRef<Member | null>(null);
  const initedRef = useRef(false);
  // The code we tried, kept for the failure screen's retry. Reading it back
  // from window.location would return nothing now that the URL is clean, and
  // the retry would silently drop the user into a NEW empty room.
  const attemptedCodeRef = useRef<string>("");

  useEffect(() => {
    // Resolve the room exactly once. React StrictMode (dev) double-invokes
    // this effect; the guard keeps the first decision stable.
    if (initedRef.current) return;
    initedRef.current = true;

    void (async () => {
      // 🧨 From the STASH, never from window.location. The pre-paint script in
      // the root layout took the code out of the URL before PostHog could read
      // it. Reading it back from the URL here would undo the whole change.
      const raw = readRoomInvite();
      const existing = raw ? normaliseRoomCode(raw) : null;
      attemptedCodeRef.current = existing ?? "";
      // Create/join now go through the server: the DB mints the 6-char code,
      // records membership against auth.uid(), and enforces expiry/closure.
      // A client can no longer conjure a room by putting a code in the URL.
      const result = existing ? await joinRoom(existing) : await createRoom();

      if (!result.ok) {
        const f = failureFromJoin(result, existing ? "join" : "create");
        setFailure(f);
        // No room identifier at all here: a denied join means we may not even
        // have a room, and a code must never reach analytics (it is a bearer
        // token — see lib/room-code.ts).
        if (existing) track("together_join_denied", { reason: result.reason });
        // A dead code must not be retried forever. Transport blips keep the
        // stash so the retry can rejoin the SAME room; anything terminal drops
        // it, otherwise every future visit to /plan/together on this browser
        // would re-attempt a room that is gone.
        const transient =
          f === "timeout" || f === "channel-error" || f === "offline";
        if (existing && !transient) clearRoomInvite();
        setReady(true);
        return;
      }

      const { room } = result;
      codeRef.current = room.code;
      roomIdRef.current = room.id;
      hostRef.current = room.hostUserId;
      meRef.current = memberFromSession(myUserId, myName);
      // 🧨 This used to be `history.replaceState(..., "?room=" + room.code)`,
      // which put the HOST's own freshly minted code into the address bar — and
      // the host is precisely the visitor most likely to have it frozen into
      // $initial_person_info and posted on /flags forever. The code goes to the
      // stash instead, which does the same job (a reload rejoins this room) and
      // is never transmitted anywhere.
      //
      // Re-armed on JOIN too, not just create: it refreshes the TTL, so an
      // active session keeps working across reloads.
      armRoomInvite(room.code);
      // Viral-loop signal: a created room is a potential invite; a joined room
      // is the K-factor payoff. Never carries the code itself.
      // Correlate on the room's UUID, never the code: the id is useless
      // without membership, the code IS membership.
      track(existing ? "together_room_join" : "together_room_create", {
        room_id: room.id,
      });
      setReady(true);
    })();
  }, [myName, myUserId]);

  // Best-effort "I've left" so the roster (and host handoff) stays truthful.
  useEffect(() => {
    const onUnload = () => {
      if (roomIdRef.current) void leaveRoom(roomIdRef.current);
    };
    window.addEventListener("pagehide", onUnload);
    return () => window.removeEventListener("pagehide", onUnload);
  }, []);

  if (failure)
    return (
      <RoomFailureNotice
        failure={failure}
        roomCode={attemptedCodeRef.current || undefined}
      />
    );

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
      roomId={roomIdRef.current}
      initialHostUserId={hostRef.current}
      venues={venues}
      events={events}
    />
  );
}

/**
 * Honest failure surface. Deliberately minimal — this track does NOT redesign
 * the room UI; it replaces a silent forever-spinner with a sentence and a way
 * out, in the existing voice and the existing type scale.
 */
function RoomFailureNotice({
  failure,
  roomCode,
}: {
  failure: RoomFailure;
  roomCode?: string;
}) {
  const copy = ROOM_FAILURE_COPY[failure];
  // A transport blip must retry the SAME room. Sending a joiner to a bare
  // /plan/together would silently drop them into a new, empty room while they
  // believed they had rejoined their friends.
  const retriesSameRoom =
    failure === "timeout" ||
    failure === "channel-error" ||
    failure === "offline";
  // 🧨 A retry must NOT rebuild `?room=CODE`. That would put the credential
  // straight back into the address bar, where posthog reads it, undoing the
  // whole point. Re-arm the stash and navigate to the CLEAN path instead: the
  // resolver picks the code up from there.
  const retrySameRoom = () => {
    if (roomCode) armRoomInvite(roomCode);
    window.location.assign("/plan/together");
  };
  return (
    <div className="px-5 py-16 text-center">
      <h2 className="text-[20px] font-extrabold text-heading">{copy.title}</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-muted-fg">
        {copy.body}
      </p>
      {copy.action &&
        (retriesSameRoom && roomCode ? (
          <button
            type="button"
            onClick={retrySameRoom}
            className="mt-6 inline-flex h-11 items-center justify-center rounded-2xl bg-primary px-5 text-[15px] font-extrabold text-primary-fg"
          >
            {copy.action}
          </button>
        ) : (
          <a
            href="/plan/together"
            className="mt-6 inline-flex h-11 items-center justify-center rounded-2xl bg-primary px-5 text-[15px] font-extrabold text-primary-fg"
          >
            {copy.action}
          </a>
        ))}
    </div>
  );
}

function RoomFlow({
  code,
  me,
  roomId,
  initialHostUserId,
  venues,
  events,
}: {
  code: string;
  me: Member;
  roomId: string;
  initialHostUserId: string;
  venues: Venue[];
  events: Event[];
}) {
  const room = useRoom(code, me, roomId, initialHostUserId);

  // Share MY OWN taste into the room, once. A session-gated server fetch (the
  // client can't read the service-role embeddings) → broadcast to the channel,
  // so every device can average the group's (see _steps/result). No one else's
  // taste is ever requested. Always broadcast — even an empty map for someone
  // with no saved history — so "everyone's taste is in" is reachable and the
  // result's convergence barrier can't wait forever on a signal-less member.
  const sharedTasteRef = useRef(false);
  useEffect(() => {
    if (sharedTasteRef.current) return;
    sharedTasteRef.current = true;
    loadMyTaste()
      .then((t) => room.sendTaste(t ?? {}))
      .catch(() => room.sendTaste({}));
    // room.sendTaste is stable for the room's lifetime — share exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // A room can also fail AFTER it opened (expiry, host closure, a dropped
  // subscription). Placed after every hook so the hook order never varies.
  if (room.failure)
    return <RoomFailureNotice failure={room.failure} roomCode={code} />;

  return (
    <div className="pb-4">
      {room.phase === "lobby" && (
        <Lobby
          room={room}
          onStart={() => room.sendPhase("settings")}
          onCloseRoom={
            room.isHost
              ? () => {
                  void closeRoom(roomId);
                }
              : undefined
          }
        />
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
