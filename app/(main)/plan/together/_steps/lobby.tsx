"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getParticipants } from "@/lib/mock-data";
import { Avatar } from "./avatar";

// Plan Together — Step 1: Lobby.
// Participants trickle in via staggered setTimeout. "Start swiping" becomes
// available once at least two are joined.
const SHARE_LINK = "fun-london.app/p/AURORA-MIX-87";

export function Lobby({ onStart }: { onStart: () => void }) {
  const router = useRouter();
  const participants = getParticipants();
  // You is in immediately; Maya, Tom, Alex on 1.5s / 3s / 4.5s timers.
  const [joinedCount, setJoinedCount] = useState(1);

  useEffect(() => {
    const timers = [
      setTimeout(() => setJoinedCount(2), 1500),
      setTimeout(() => setJoinedCount(3), 3000),
      setTimeout(() => setJoinedCount(4), 4500),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  const joined = participants.slice(0, joinedCount);
  const stillWaiting = joinedCount < participants.length;

  return (
    <div className="px-5 py-4 flex flex-col">
      <button
        type="button"
        onClick={() => router.push("/plan")}
        aria-label="Back"
        className="self-start text-xl text-muted-fg mb-1.5 leading-none"
      >
        ‹
      </button>

      <div className="text-[11px] font-extrabold text-primary uppercase tracking-[0.12em]">
        Plan together
      </div>
      <h1 className="text-2xl font-extrabold text-heading mt-1 mb-3.5 tracking-tight">
        Get the gang in
      </h1>
      <div className="text-[11px] font-bold text-muted-fg uppercase tracking-[0.1em] mb-1.5">
        Send the link. They tap, swipe, done.
      </div>

      <div className="bg-muted rounded-xl px-3 py-2.5 flex items-center justify-between text-xs text-muted-fg mb-3">
        <span>{SHARE_LINK}</span>
        <button
          type="button"
          className="bg-primary text-primary-fg rounded-lg px-2.5 py-1 text-[11px] font-extrabold"
        >
          Copy
        </button>
      </div>

      <div className="flex gap-2 mb-4">
        {["WhatsApp", "Messages", "AirDrop"].map((s) => (
          <button
            key={s}
            type="button"
            className="flex-1 h-8 rounded-full border border-border bg-card text-[11px] font-bold text-fg"
          >
            {s}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between mb-2.5">
        <div className="text-[13px] font-extrabold text-heading">
          In the session · {joined.length}
        </div>
        {/* The "● Live" green is intentionally a non-theme accent — it's a
            status signal, like a router LED, not a brand surface. */}
        <span
          className="text-[10px] font-extrabold"
          style={{ color: "hsl(150 60% 40%)" }}
        >
          ● Live
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {joined.map((p) => (
          <div
            key={p.id}
            className="flex items-center gap-2.5 px-3 py-2.5 border border-border rounded-xl"
          >
            <Avatar participant={p} size={32} fontSize={14} />
            <div className="flex-1">
              <div className="text-[13px] font-extrabold text-heading">
                {p.name}
              </div>
              <div className="text-[10.5px] text-muted-fg">Joined · ready</div>
            </div>
            <span className="text-muted-fg">···</span>
          </div>
        ))}
        {stillWaiting && (
          <div className="px-3 py-2.5 border border-dashed border-border rounded-xl text-[11px] text-muted-fg">
            Waiting for someone to join…
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onStart}
        disabled={joined.length < 2}
        className="mt-6 mb-4 w-full h-12 rounded-2xl bg-primary text-primary-fg text-sm font-extrabold disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Start swiping ({joined.length})
      </button>
    </div>
  );
}
