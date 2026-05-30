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

export type Member = {
  id: string;
  name: string;
  color: string;
  emoji: string;
};

export type Phase = "lobby" | "settings" | "swipe" | "result";
export type Vote = { memberId: string; qIdx: number; value: boolean };

// Host-set logistics. `when.at` is the resolved meeting time in ms (computed
// on the host's clock) so every device builds the same plan.
export type PlanWhen =
  | { kind: "now"; at: number }
  | {
      kind: "scheduled";
      at: number;
      day: number;
      timeOfDay: "Day" | "Evening" | "Night";
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
  sendPhase: (p: Phase) => void;
  sendSettings: (s: RoomSettings) => void;
  sendVote: (qIdx: number, value: boolean) => void;
  sendDone: () => void;
  sendSwap: (stepIdx: number, altIdx: number) => void;
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
const EMOJIS = ["🧡", "💖", "💙", "💜", "💚", "💛"];
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
    emoji: EMOJIS[h % EMOJIS.length],
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
  const channelRef = useRef<RealtimeChannel | null>(null);
  // Refs so the presence-join replay handler reads the latest host state.
  const settingsRef = useRef<RoomSettings | null>(null);
  const swapsRef = useRef<Record<number, number>>({});
  settingsRef.current = settings;
  swapsRef.current = swaps;

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
          if (m.id && m.name && m.color && m.emoji && !seen.has(m.id)) {
            seen.add(m.id);
            list.push(m as Member);
          }
        }
      }
      if (list.length > 0) setMembers(list);
    });

    // Late-join replay: when anyone joins, the host re-broadcasts the plan
    // state so the newcomer catches up (Broadcast doesn't replay history).
    channel.on("presence", { event: "join" }, () => {
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
    });

    channel.on("broadcast", { event: "phase" }, ({ payload }) => {
      setPhase((payload as { phase: Phase }).phase);
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
    });
    channel.on("broadcast", { event: "swaps" }, ({ payload }) => {
      setSwaps(payload as Record<number, number>);
    });

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") void channel.track(me);
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
    sendPhase,
    sendSettings,
    sendVote,
    sendDone,
    sendSwap,
  };
}
