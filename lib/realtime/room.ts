"use client";

// Plan Together — real multiplayer over Supabase Realtime (Presence +
// Broadcast). A room is a channel keyed by a 6-char code AND backed by
// plan_rooms / plan_room_members: the DB owns identity, membership, expiry
// and the host role; Realtime carries the live traffic.
// Presence = who's here (live). Broadcast = phase, host settings, votes,
// stop-swaps.
//
// SECURITY MODEL (see docs/FUNLDN_GROUP_SECURITY_IMPLEMENTATION.md):
//   · member id === authenticated user id (never client-minted);
//   · the roster comes from the database, and every inbound payload is
//     checked against it (lib/room-roster.ts) — invented members cannot
//     inflate a vote majority;
//   · the channel's RLS requires a membership row for THIS room that is not
//     departed, expired or closed;
//   · the client picks the earliest-joined PRESENT member and asks the DB to
//     hand over; the DB decides who actually gets it by rotating forward from
//     the outgoing host, via a conditional UPDATE with a server-clamped 30s
//     staleness window (lib/room-host.ts, promote_plan_room_host).
//
// Late-join caveat: Broadcast has no replay, so a joiner who arrives after
// the host set the plan would miss it. The host re-broadcasts settings +
// swaps whenever someone joins, which converges everyone.

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { PlanArea } from "@/lib/regions";
import type { PlanBudget } from "@/lib/plan-engine";
import type { TasteMap } from "@/lib/group-taste";
import { pruneReactions } from "@/lib/group-veto";
import {
  acceptsPayload,
  filterPresence,
  type RosterGuard,
} from "@/lib/room-roster";
import { shouldClaimHost, type RosterEntry } from "@/lib/room-host";
import { failureFromStatus, type RoomFailure } from "@/lib/room-errors";
import { loadRoomState, promoteHost, touchHost } from "@/lib/room-action";
import { track } from "@/lib/analytics";

export type Member = {
  id: string;
  name: string;
  color: string;
};

export type Phase = "lobby" | "settings" | "swipe" | "result";
export type Vote = { memberId: string; qIdx: number; value: boolean };

// Per-stop group reaction on the final plan: keep it (👍) or veto it (👎, "let's
// change this one"). When more than half the group vetoes a stop, the host
// auto-swaps it to the next alternative (see _steps/result). Swiping a stop is
// just a shortcut for casting this — right = keep, left = veto.
export type StopReaction = "keep" | "veto";

// Host-set logistics. `when.at` is the resolved meeting time in ms (computed
// on the host's clock) so every device builds the same plan.
export type PlanWhen =
  | { kind: "now"; at: number }
  | {
      kind: "scheduled";
      at: number;
      day: number;
      timeOfDay: "Morning" | "Afternoon" | "Night";
    };

export type RoomSettings = {
  hostId: string;
  when: PlanWhen;
  area: PlanArea;
  budget: PlanBudget;
  groupSize: number;
};

export type Room = {
  code: string;
  me: Member;
  isHost: boolean;
  /** Non-null when the room could not be opened (see lib/room-errors.ts). */
  failure: RoomFailure | null;
  members: Member[];
  phase: Phase;
  settings: RoomSettings | null;
  votes: Vote[];
  doneIds: string[];
  swaps: Record<number, number>; // stepIdx → active alternative index
  variant: number; // which whole-plan alternative ("another mix")
  tasteByMember: Record<string, TasteMap>; // memberId → their broadcast taste
  reactions: Record<number, Record<string, StopReaction>>; // stepIdx → memberId → 👍/👎
  sendPhase: (p: Phase) => void;
  sendSettings: (s: RoomSettings) => void;
  sendVote: (qIdx: number, value: boolean) => void;
  sendDone: () => void;
  sendSwap: (stepIdx: number, altIdx: number) => void;
  sendVariant: (n: number) => void;
  sendTaste: (taste: TasteMap) => void;
  sendReact: (stepIdx: number, value: StopReaction | null) => void;
};

// ── Identity helpers ──────────────────────────────────────────────────────

const COLORS = [
  "hsl(14 90% 60%)",
  "hsl(330 80% 62%)",
  "hsl(210 80% 58%)",
  "hsl(265 70% 62%)",
  "hsl(150 55% 45%)",
  "hsl(40 90% 55%)",
];
const ANIMALS = [
  "Fox",
  "Otter",
  "Robin",
  "Bear",
  "Hare",
  "Wolf",
  "Lynx",
  "Finch",
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * A member, derived from the AUTHENTICATED session.
 *
 * `userId` is auth.uid() — the same value plan_room_members stores and the
 * Realtime policy checks. The old makeMember() minted crypto.randomUUID(),
 * which is exactly what let one client claim to be several members.
 */
export function memberFromSession(userId: string, rawName: string): Member {
  const h = hash(userId);
  const name =
    rawName && rawName.toLowerCase() !== "guest"
      ? rawName
      : `Guest ${ANIMALS[h % ANIMALS.length]}`;
  return { id: userId, name, color: COLORS[h % COLORS.length] };
}

// ── The hook ──────────────────────────────────────────────────────────────

export function useRoom(
  code: string,
  me: Member,
  roomId: string,
  initialHostUserId: string,
): Room {
  const [members, setMembers] = useState<Member[]>([me]);
  const [failure, setFailure] = useState<RoomFailure | null>(null);
  // Server-owned roster (plan_room_members). Payloads from anyone not on it
  // are dropped, so an extra "member" cannot be conjured into a vote count.
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [hostUserId, setHostUserId] = useState<string>(initialHostUserId);
  const [hostSeenAt, setHostSeenAt] = useState<string | null>(null);
  const isHost = hostUserId === me.id;
  // 🧨 The roster arrives asynchronously (loadRoomState). Until it does, the
  // gate must NOT be applied — filtering presence against a roster of just
  // {me} would drop every other member, and nothing would re-filter when the
  // roster landed: the last joiner would sit alone in a room that still looked
  // live, building a DIFFERENT plan and satisfying the "everyone's done"
  // barrier by themselves. `rosterLoaded` is the switch: gate closed only once
  // we actually know who belongs.
  const [rosterLoaded, setRosterLoaded] = useState(false);
  const guardRef = useRef<RosterGuard>({
    memberIds: new Set([me.id]),
    myUserId: me.id,
  });
  const rawPresenceRef = useRef<Member[]>([me]);
  guardRef.current = {
    memberIds: new Set(roster.map((r) => r.userId)),
    myUserId: me.id,
  };
  const rosterLoadedRef = useRef(false);
  rosterLoadedRef.current = rosterLoaded;
  // Expiry is terminal; the event must fire once, not every poll.
  const expiredFiredRef = useRef(false);
  // Keys of payloads I actually sent, so the self-spoof check is real: a
  // payload stamped with MY id that I did not send is dropped. Bounded and
  // short-lived (broadcast self-echo returns within a tick).
  const sentKeysRef = useRef<Set<string>>(new Set());
  const noteSent = useCallback((key: string) => {
    const s = sentKeysRef.current;
    s.add(key);
    if (s.size > 200) s.delete(s.values().next().value as string);
  }, []);
  const wasSentByMe = useCallback((key: string) => {
    return sentKeysRef.current.delete(key);
  }, []);
  const meIdRef = useRef(me.id);
  meIdRef.current = me.id;
  const hostIdRef = useRef(initialHostUserId);
  hostIdRef.current = hostUserId;
  // A host-authored broadcast (settings / swap / swaps / variant) changes the
  // plan for EVERYONE, so it is accepted only from the DB-recorded host. The
  // sender stamps `from`; a member forging another member's id still cannot
  // pass this unless that member is the host (see room-roster.ts's honest
  // limit note).
  const isHostAuthored = useCallback(
    (from: unknown) => typeof from === "string" && from === hostIdRef.current,
    [],
  );
  const isHostRef = useRef(isHost);
  isHostRef.current = isHost;
  const [phase, setPhase] = useState<Phase>("lobby");
  const [settings, setSettings] = useState<RoomSettings | null>(null);
  const [votes, setVotes] = useState<Vote[]>([]);
  const [doneIds, setDoneIds] = useState<string[]>([]);
  const [swaps, setSwaps] = useState<Record<number, number>>({});
  const [variant, setVariant] = useState(0);
  const [tasteByMember, setTasteByMember] = useState<Record<string, TasteMap>>(
    {},
  );
  const [reactions, setReactions] = useState<
    Record<number, Record<string, StopReaction>>
  >({});
  const channelRef = useRef<RealtimeChannel | null>(null);
  // Refs so the presence-join replay handler reads the latest host state.
  const settingsRef = useRef<RoomSettings | null>(null);
  const swapsRef = useRef<Record<number, number>>({});
  const variantRef = useRef(0);
  // My own broadcast taste, so I can re-emit it when a newcomer joins (Broadcast
  // has no replay). Unlike settings/swaps/variant this is per-member, so EVERY
  // member re-emits their own, not just the host.
  const myTasteRef = useRef<TasteMap | null>(null);
  // Presence changes constantly; the 10s host-handoff tick must read the
  // LATEST list, not the one captured when its effect first ran.
  const membersRef = useRef<Member[]>([me]);
  settingsRef.current = settings;
  swapsRef.current = swaps;
  variantRef.current = variant;
  membersRef.current = members;

  useEffect(() => {
    const supabase = createClient();
    // Private channel: Realtime enforces RLS on realtime.messages, so only
    // signed-in members can join/read/broadcast (an anon who guesses the room
    // code is rejected). Plan Together is already sign-in only, so real users
    // are unaffected.
    const channel = supabase.channel(`plan-${code}`, {
      config: {
        presence: { key: me.id },
        broadcast: { self: true },
        private: true,
      },
    });

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState() as Record<string, unknown[]>;
      const list: Member[] = [];
      const seen = new Set<string>();
      for (const key of Object.keys(state)) {
        for (const pres of state[key]) {
          const m = pres as Partial<Member>;
          if (m.id && m.name && m.color && !seen.has(m.id)) {
            seen.add(m.id);
            list.push(m as Member);
          }
        }
      }
      rawPresenceRef.current = list;
      // Before the roster is known, trust presence as-is (the channel's own
      // RLS already requires membership); after, apply the roster gate.
      const vetted = rosterLoadedRef.current
        ? filterPresence(guardRef.current, list)
        : list;
      if (vetted.length > 0) {
        setMembers(vetted);
        const seenVetted = new Set(vetted.map((m) => m.id));
        // A member who left must not keep a vote: reactions drive a majority
        // swap measured against the live group, so prune departed voters (no-op
        // ref when nobody left → no needless re-render).
        setReactions((prev) => pruneReactions(prev, seenVetted));
      }
    });

    // Late-join replay: when anyone joins, re-broadcast state so the newcomer
    // catches up (Broadcast doesn't replay history). The host owns the shared
    // plan state; taste is per-member, so every member re-emits their OWN.
    channel.on("presence", { event: "join" }, () => {
      if (myTasteRef.current) {
        channel.send({
          type: "broadcast",
          event: "taste",
          payload: { memberId: me.id, taste: myTasteRef.current },
        });
      }
      if (!isHostRef.current) return;
      if (settingsRef.current) {
        channel.send({
          type: "broadcast",
          event: "settings",
          payload: { ...settingsRef.current, from: me.id },
        });
      }
      if (Object.keys(swapsRef.current).length > 0) {
        channel.send({
          type: "broadcast",
          event: "swaps",
          payload: { map: swapsRef.current, from: me.id },
        });
      }
      if (variantRef.current > 0) {
        channel.send({
          type: "broadcast",
          event: "variant",
          payload: { variant: variantRef.current, from: me.id },
        });
      }
    });

    channel.on("broadcast", { event: "phase" }, ({ payload }) => {
      const p = (payload as { phase: Phase }).phase;
      setPhase(p);
      // Going back to Settings is a re-plan → clear stale per-stop reactions so
      // they don't carry onto (or auto-swap) the new plan. Keyed on the phase
      // move, NOT the settings broadcast, which also fires on late-join replay.
      if (p === "settings") setReactions({});
    });
    channel.on("broadcast", { event: "settings" }, ({ payload }) => {
      // Host-authored: only the DB-recorded host may set the group's
      // logistics. Without this any member could rewrite when/where/budget
      // for everyone from the console.
      const p = payload as RoomSettings & { from?: string };
      if (!isHostAuthored(p.from)) return;
      setSettings(p);
    });
    channel.on("broadcast", { event: "vote" }, ({ payload }) => {
      const v = payload as Vote;
      // Roster gate: only real, current members may cast a vote, and only I
      // may cast mine (self-echo aside). See lib/room-roster.ts.
      if (
        !acceptsPayload(
          guardRef.current,
          v?.memberId,
          wasSentByMe(`vote:${v?.qIdx}:${v?.value}`),
        )
      )
        return;
      setVotes((prev) => [
        ...prev.filter(
          (x) => !(x.memberId === v.memberId && x.qIdx === v.qIdx),
        ),
        v,
      ]);
    });
    channel.on("broadcast", { event: "done" }, ({ payload }) => {
      const id = (payload as { memberId: string }).memberId;
      if (!acceptsPayload(guardRef.current, id, wasSentByMe("done"))) return;
      setDoneIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    });
    channel.on("broadcast", { event: "swap" }, ({ payload }) => {
      const { stepIdx, altIdx, from } = payload as {
        stepIdx: number;
        altIdx: number;
        from?: string;
      };
      // Host-authored: a swap changes the plan for the whole room, so it must
      // come from the host. The majority-veto path reaches this by the host
      // acting on counted reactions, not by a member broadcasting directly.
      if (!isHostAuthored(from)) return;
      setSwaps((prev) => ({ ...prev, [stepIdx]: altIdx }));
      // A swapped stop is a fresh venue — its old keep/veto reactions no longer
      // apply, so clear them (and the majority that triggered the swap resets).
      setReactions((prev) => {
        if (!prev[stepIdx]) return prev;
        const next = { ...prev };
        delete next[stepIdx];
        return next;
      });
    });
    channel.on("broadcast", { event: "swaps" }, ({ payload }) => {
      const p = payload as { map?: Record<number, number>; from?: string };
      if (!isHostAuthored(p.from)) return;
      setSwaps(p.map ?? {});
    });
    channel.on("broadcast", { event: "variant" }, ({ payload }) => {
      const p = payload as { variant: number; from?: string };
      if (!isHostAuthored(p.from)) return;
      setVariant(p.variant);
      setSwaps({}); // a fresh mix clears per-stop swaps
      setReactions({}); // …and its reactions
    });
    channel.on("broadcast", { event: "react" }, ({ payload }) => {
      const { memberId, stepIdx, value } = payload as {
        memberId: string;
        stepIdx: number;
        value: StopReaction | null;
      };
      if (
        !acceptsPayload(
          guardRef.current,
          memberId,
          wasSentByMe(`react:${stepIdx}:${value}`),
        )
      )
        return;
      setReactions((prev) => {
        const stop = { ...(prev[stepIdx] ?? {}) };
        if (value) stop[memberId] = value;
        else delete stop[memberId];
        return { ...prev, [stepIdx]: stop };
      });
    });
    channel.on("broadcast", { event: "taste" }, ({ payload }) => {
      const { memberId, taste } = payload as {
        memberId: string;
        taste: TasteMap;
      };
      if (!acceptsPayload(guardRef.current, memberId, wasSentByMe("taste")))
        return;
      if (taste) setTasteByMember((prev) => ({ ...prev, [memberId]: taste }));
    });
    // A newcomer (or a device recovering from a dropped message) asks everyone
    // to re-send their taste. Broadcast has no replay, so this is how a late
    // joiner collects maps that were sent before it subscribed.
    channel.on("broadcast", { event: "taste-sync" }, () => {
      if (myTasteRef.current)
        channel.send({
          type: "broadcast",
          event: "taste",
          payload: { memberId: me.id, taste: myTasteRef.current },
        });
    });

    // Guards the subscribe callback: removeChannel() during cleanup fires
    // CLOSED, which must not paint an "offline" failure on a component that is
    // simply re-running its effect.
    let cancelled = false;
    channelRef.current = channel;
    // Hand Realtime the signed-in user's JWT so the private channel's RLS check
    // passes, THEN join. (supabase-js also auto-manages this token, but we set
    // it explicitly first so we never join with only the anon key.)
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (data.session?.access_token)
          await supabase.realtime.setAuth(data.session.access_token);
      } catch {
        // fall through — subscribe will surface an auth failure via status
      }
      if (cancelled) return;
      channel.subscribe((status) => {
        if (cancelled) return;
        // The old code handled ONLY "SUBSCRIBED", so a timeout, an RLS
        // rejection or a dropped network left the user on "Setting up your
        // room…" forever. Every terminal status now surfaces honest copy.
        if (status === "SUBSCRIBED") {
          setFailure(null);
          void channel.track(me);
          // Ask any members already here to re-send their taste (their earlier
          // broadcasts predate this subscription and Broadcast has no replay).
          channel.send({ type: "broadcast", event: "taste-sync", payload: {} });
          return;
        }
        const f = failureFromStatus(status);
        if (f) setFailure(f);
      });
    })();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [code, me, roomId]);

  // Re-apply the gate to the LAST presence snapshot when the roster arrives or
  // changes. Without this the members list would keep whatever it computed
  // before the roster was known until the next join/leave event.
  useEffect(() => {
    if (!rosterLoaded) return;
    const vetted = filterPresence(guardRef.current, rawPresenceRef.current);
    if (vetted.length > 0) {
      setMembers(vetted);
      const ids = new Set(vetted.map((m) => m.id));
      setReactions((prev) => pruneReactions(prev, ids));
    }
  }, [roster, rosterLoaded, me.id]);

  // ── Roster + host lifecycle ─────────────────────────────────────────────
  // Polls the server-owned room state: the roster (which gates every inbound
  // payload) and the host record. Realtime is deliberately NOT the source of
  // truth here — a forged broadcast must never be able to change who is host
  // or who counts as a member.
  useEffect(() => {
    if (!roomId) return;
    let alive = true;
    const tick = async () => {
      const state = await loadRoomState(roomId);
      if (!alive) return;
      if (!state.room) {
        // The room vanished (purged) or the session dropped. Say so rather
        // than polling a ghost — silent failure is the class of bug this
        // track exists to end.
        setFailure("not-found");
        alive = false;
        return;
      }
      setRoster(state.roster);
      if (state.roster.length > 0) setRosterLoaded(true);
      setHostUserId(state.room.hostUserId);
      setHostSeenAt(state.room.hostSeenAt);

      if (state.room.closedAt) {
        setFailure("closed");
        alive = false; // terminal: stop polling (and stop re-firing events)
        return;
      }
      if (Date.parse(state.room.expiresAt) <= Date.now()) {
        setFailure("expired");
        if (!expiredFiredRef.current) {
          expiredFiredRef.current = true;
          track("together_room_expired", { room_id: roomId });
        }
        alive = false;
        return;
      }

      // I'm the host → keep the liveness stamp fresh so nobody promotes over
      // a host who is simply quiet.
      if (state.room.hostUserId === me.id) {
        await touchHost(roomId);
        return;
      }

      // I'm not the host → promote only if the rule picks ME, so the common
      // case is exactly one RPC. The conditional UPDATE inside
      // promote_plan_room_host() settles any residual race.
      const present = new Set(membersRef.current.map((m) => m.id));
      if (
        shouldClaimHost({
          roster: state.roster,
          presentUserIds: present,
          hostUserId: state.room.hostUserId,
          hostSeenAt: state.room.hostSeenAt,
          myUserId: me.id,
        })
      ) {
        const next = await promoteHost(roomId);
        if (!alive) return;
        if (next) {
          setHostUserId(next);
          if (next === me.id)
            track("together_host_handoff", { room_id: roomId });
        }
      }
    };
    void tick();
    const iv = setInterval(() => void tick(), 10_000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [roomId, code, me.id]);

  const sendPhase = useCallback((p: Phase) => {
    channelRef.current?.send({
      type: "broadcast",
      event: "phase",
      payload: { phase: p },
    });
  }, []);

  const sendSettings = useCallback((s: RoomSettings) => {
    setSettings(s); // optimistic for the host
    channelRef.current?.send({
      type: "broadcast",
      event: "settings",
      payload: { ...s, from: meIdRef.current },
    });
  }, []);

  const sendVote = useCallback(
    (qIdx: number, value: boolean) => {
      noteSent(`vote:${qIdx}:${value}`);
      channelRef.current?.send({
        type: "broadcast",
        event: "vote",
        payload: { memberId: me.id, qIdx, value },
      });
    },
    [me.id],
  );

  const sendDone = useCallback(() => {
    noteSent("done");
    channelRef.current?.send({
      type: "broadcast",
      event: "done",
      payload: { memberId: me.id },
    });
  }, [me.id]);

  const sendSwap = useCallback((stepIdx: number, altIdx: number) => {
    channelRef.current?.send({
      type: "broadcast",
      event: "swap",
      payload: { stepIdx, altIdx, from: meIdRef.current },
    });
  }, []);

  const sendVariant = useCallback((n: number) => {
    setVariant(n);
    setSwaps({});
    channelRef.current?.send({
      type: "broadcast",
      event: "variant",
      payload: { variant: n, from: meIdRef.current },
    });
  }, []);

  const sendTaste = useCallback(
    (taste: TasteMap) => {
      noteSent("taste");
      myTasteRef.current = taste; // remember, so we can re-emit on late joins
      setTasteByMember((prev) => ({ ...prev, [me.id]: taste })); // optimistic self
      channelRef.current?.send({
        type: "broadcast",
        event: "taste",
        payload: { memberId: me.id, taste },
      });
    },
    [me.id],
  );

  const sendReact = useCallback(
    (stepIdx: number, value: StopReaction | null) => {
      noteSent(`react:${stepIdx}:${value}`);
      setReactions((prev) => {
        // optimistic self
        const stop = { ...(prev[stepIdx] ?? {}) };
        if (value) stop[me.id] = value;
        else delete stop[me.id];
        return { ...prev, [stepIdx]: stop };
      });
      channelRef.current?.send({
        type: "broadcast",
        event: "react",
        payload: { memberId: me.id, stepIdx, value },
      });
    },
    [me.id],
  );

  return {
    code,
    me,
    isHost,
    failure,
    members,
    phase,
    settings,
    votes,
    doneIds,
    swaps,
    variant,
    tasteByMember,
    reactions,
    sendPhase,
    sendSettings,
    sendVote,
    sendDone,
    sendSwap,
    sendVariant,
    sendTaste,
    sendReact,
  };
}
