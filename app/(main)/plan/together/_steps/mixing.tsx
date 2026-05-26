"use client";

import { useEffect } from "react";
import { getParticipants } from "@/lib/mock-data";
import type { Participant } from "@/lib/types";
import { Avatar } from "./avatar";

// Plan Together — Step 3: Mixing.
// 4 participant emoji dots pulse in a cluster around a center ✨ while the
// "group" tallies votes. Auto-advances to Result after a simulated wait.

// Positions chosen to match the prototype's cluster (lines 94–101).
const CLUSTER_POSITIONS = [
  { x: 0, y: 0 },
  { x: 80, y: 10 },
  { x: 90, y: 80 },
  { x: 10, y: 90 },
];

const AUTO_ADVANCE_MS = 2800;

export function Mixing({ onDone }: { onDone: () => void }) {
  const participants = getParticipants();

  // Auto-advance to result after the simulated wait.
  useEffect(() => {
    const t = setTimeout(onDone, AUTO_ADVANCE_MS);
    return () => clearTimeout(t);
  }, [onDone]);

  // The first 3 are done; the last is still voting (mirrors prototype state).
  const statusList: { p: Participant; status: "done" | "voting" }[] = [
    { p: participants[0], status: "done" },
    { p: participants[1], status: "done" },
    { p: participants[2], status: "done" },
    { p: participants[3], status: "voting" },
  ];
  const doneCount = statusList.filter((s) => s.status === "done").length;

  return (
    <div className="flex flex-col p-5 min-h-[calc(100vh-96px)]">
      <div className="flex-1 flex flex-col justify-center items-center gap-6">
        <div className="relative w-[140px] h-[140px]">
          {participants.map((p, i) => {
            const pos = CLUSTER_POSITIONS[i];
            return (
              <div
                key={p.id}
                className="absolute w-[38px] h-[38px] rounded-full grid place-items-center text-white text-base"
                style={{
                  left: pos.x,
                  top: pos.y,
                  background: p.color,
                  animation: `pt-pulse 2s ease-in-out ${i * 0.2}s infinite`,
                }}
              >
                {p.emoji}
              </div>
            );
          })}
          {/* Center ✨ */}
          <div className="absolute left-[50px] top-[50px] w-10 h-10 rounded-full bg-primary text-primary-fg grid place-items-center text-lg">
            ✨
          </div>
        </div>

        <div className="text-center">
          <div className="text-lg font-extrabold text-heading">
            Waiting for the group
          </div>
          <div className="text-xs text-muted-fg mt-1.5">
            {doneCount} of {statusList.length} voted. We&apos;ll generate as
            soon as the last person finishes.
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        {statusList.map((row, i) => (
          <div
            key={`${row.p.id}-${i}`}
            className="flex items-center gap-2.5 py-2"
          >
            <Avatar participant={row.p} size={28} fontSize={12} />
            <div className="flex-1 text-xs font-bold text-heading">
              {row.p.name}
            </div>
            <div
              className={
                "text-[11px] font-bold " +
                // Green is intentional — status colour, not theme surface.
                (row.status === "done"
                  ? "text-[hsl(150_60%_40%)]"
                  : "text-muted-fg")
              }
            >
              {row.status === "done" ? "✓ Done" : "Voting…"}
            </div>
          </div>
        ))}
      </div>

      {/* Pulse keyframes — namespaced to avoid clashing with Tailwind's `pulse`. */}
      <style>{`@keyframes pt-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.15)}}`}</style>
    </div>
  );
}
