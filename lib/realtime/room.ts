"use client";

// Plan Together — real multiplayer over Supabase Realtime (Presence +
// Broadcast). No DB tables: a room is an ephemeral channel keyed by a short
// code. Presence = who's here (live). Broadcast = phase, host settings,
// votes, and stop-swaps.
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

function randomId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function makeMember(rawName: string): Member {
  const id = randomId();
  const h = hash(id);
  const name =
    rawName && rawName.toLowerCase() !== "guest"
      ? rawName
      : `Guest ${ANIMALS[h % ANIMALS.length]}`;
  return {
    id,
    name,
    color: COLORS[h % COLORS.length],
  };
}

export function randomRoomCode(): string {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let c = "";
  for (let i = 0; i < 4; i++) c += A[Math.floor(Math.random() * A.length)];
  return c;
}

// ── The hook ──────────────────────────────────────────────────────────────

export function useRoom(code: string, me: Member, isHost: boolean): Room {
  const [members, setMembers] = useState<Member[]>([me]);
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
  settingsRef.current = settings;
  swapsRef.current = swaps;
  variantRef.current = variant;

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`plan-${code}`, {
      config: { presence: { key: me.id }, broadcast: { self: true } },
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
      if (list.length > 0) setMembers(list);
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
      if (!isHost) return;
      if (settingsRef.current) {
        channel.send({
          type: "broadcast",
          event: "settings",
          payload: settingsRef.current,
        });
      }
      if (Object.keys(swapsRef.current).length > 0) {
        channel.send({
          type: "broadcast",
          event: "swaps",
          payload: swapsRef.current,
        });
      }
      if (variantRef.current > 0) {
        channel.send({
          type: "broadcast",
          event: "variant",
          payload: { variant: variantRef.current },
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
      setSettings(payload as RoomSettings);
    });
    channel.on("broadcast", { event: "vote" }, ({ payload }) => {
      const v = payload as Vote;
      setVotes((prev) => [
        ...prev.filter(
          (x) => !(x.memberId === v.memberId && x.qIdx === v.qIdx),
        ),
        v,
      ]);
    });
    channel.on("broadcast", { event: "done" }, ({ payload }) => {
      const id = (payload as { memberId: string }).memberId;
      setDoneIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    });
    channel.on("broadcast", { event: "swap" }, ({ payload }) => {
      const { stepIdx, altIdx } = payload as {
        stepIdx: number;
        altIdx: number;
      };
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
      setSwaps(payload as Record<number, number>);
    });
    channel.on("broadcast", { event: "variant" }, ({ payload }) => {
      setVariant((payload as { variant: number }).variant);
      setSwaps({}); // a fresh mix clears per-stop swaps
      setReactions({}); // …and its reactions
    });
    channel.on("broadcast", { event: "react" }, ({ payload }) => {
      const { memberId, stepIdx, value } = payload as {
        memberId: string;
        stepIdx: number;
        value: StopReaction | null;
      };
      if (!memberId) return;
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
      if (memberId && taste)
        setTasteByMember((prev) => ({ ...prev, [memberId]: taste }));
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

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        void channel.track(me);
        // Ask any members already here to re-send their taste (their earlier
        // broadcasts predate this subscription and Broadcast has no replay).
        channel.send({ type: "broadcast", event: "taste-sync", payload: {} });
      }
    });
    channelRef.current = channel;

    return () => {
      void supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [code, me, isHost]);

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
      payload: s,
    });
  }, []);

  const sendVote = useCallback(
    (qIdx: number, value: boolean) => {
      channelRef.current?.send({
        type: "broadcast",
        event: "vote",
        payload: { memberId: me.id, qIdx, value },
      });
    },
    [me.id],
  );

  const sendDone = useCallback(() => {
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
      payload: { stepIdx, altIdx },
    });
  }, []);

  const sendVariant = useCallback((n: number) => {
    setVariant(n);
    setSwaps({});
    channelRef.current?.send({
      type: "broadcast",
      event: "variant",
      payload: { variant: n },
    });
  }, []);

  const sendTaste = useCallback(
    (taste: TasteMap) => {
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
