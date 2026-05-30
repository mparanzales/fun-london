"use client";

// Plan Together — real multiplayer over Supabase Realtime (Presence +
// Broadcast). No DB tables: a room is an ephemeral channel keyed by a short
// code. Presence = who's here (live). Broadcast = phase changes + votes.
//
// Everyone loads the same server-fetched venue list in the same order, so a
// vote referencing "question N" lines up across devices without syncing the
// catalog itself.

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

export type Member = {
  id: string;
  name: string;
  color: string;
  emoji: string;
};

export type Phase = "lobby" | "swipe" | "result";
export type Vote = { memberId: string; qIdx: number; value: boolean };

export type Room = {
  code: string;
  me: Member;
  members: Member[];
  phase: Phase;
  votes: Vote[];
  doneIds: string[];
  sendPhase: (p: Phase) => void;
  sendVote: (qIdx: number, value: boolean) => void;
  sendDone: () => void;
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

export function useRoom(code: string, me: Member): Room {
  const [members, setMembers] = useState<Member[]>([me]);
  const [phase, setPhase] = useState<Phase>("lobby");
  const [votes, setVotes] = useState<Vote[]>([]);
  const [doneIds, setDoneIds] = useState<string[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);

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

    channel.on("broadcast", { event: "phase" }, ({ payload }) => {
      setPhase((payload as { phase: Phase }).phase);
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

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") void channel.track(me);
    });
    channelRef.current = channel;

    return () => {
      void supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [code, me]);

  const sendPhase = useCallback((p: Phase) => {
    channelRef.current?.send({
      type: "broadcast",
      event: "phase",
      payload: { phase: p },
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

  return {
    code,
    me,
    members,
    phase,
    votes,
    doneIds,
    sendPhase,
    sendVote,
    sendDone,
  };
}
