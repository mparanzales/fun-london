"use client";

import { useEffect, useRef, useState } from "react";
import type { Venue } from "@/lib/types";
import type { Room } from "@/lib/realtime/room";
import { Avatar } from "./avatar";

// Plan Together — Step 2: Group Swipe (real-time).
// Each member answers the 3 questions; every vote is broadcast. When you're
// done you wait on the group, and once everyone has finished the room jumps
// to the result.

export const SWIPE_QUESTIONS = [
  { label: "Dinner?", moodPill: "🍝 Mood" },
  { label: "Drinks?", moodPill: "🍸 Mood" },
  { label: "Late night?", moodPill: "🌙 Mood" },
] as const;

export function Swipe({
  room,
  questionVenues,
}: {
  room: Room;
  questionVenues: Venue[];
}) {
  const [qIdx, setQIdx] = useState(0);
  const [finished, setFinished] = useState(false);
  const advancedRef = useRef(false);

  const vote = (value: boolean) => {
    room.sendVote(qIdx, value);
    if (qIdx + 1 < SWIPE_QUESTIONS.length) {
      setQIdx(qIdx + 1);
    } else {
      room.sendDone();
      setFinished(true);
    }
  };

  // Once everyone present has finished, advance the whole room to the result.
  useEffect(() => {
    if (!finished || advancedRef.current) return;
    const everyone =
      room.members.length > 0 &&
      room.members.every((m) => room.doneIds.includes(m.id));
    if (everyone) {
      advancedRef.current = true;
      room.sendPhase("result");
    }
  }, [finished, room]);

  if (finished) {
    const doneMembers = room.members.filter((m) => room.doneIds.includes(m.id));
    return (
      <div className="px-5 pt-10 flex flex-col items-center text-center min-h-[calc(100vh-96px)]">
        <div className="text-[40px] mb-2">🪩</div>
        <h2 className="text-xl font-extrabold text-heading">
          Nice — votes in.
        </h2>
        <p className="text-sm text-muted-fg mt-1.5 mb-6">
          Waiting for the group… {room.doneIds.length}/{room.members.length}{" "}
          done.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {doneMembers.map((m) => (
            <div key={m.id} className="flex flex-col items-center gap-1">
              <Avatar participant={m} size={40} fontSize={18} />
              <span className="text-[10px] text-muted-fg">{m.name}</span>
            </div>
          ))}
        </div>
        <div className="mt-8 flex items-center gap-1.5 text-[11px] text-muted-fg">
          <span
            className="w-2 h-2 rounded-full animate-pulse"
            style={{ background: "hsl(150 60% 45%)" }}
          />
          Mixing your picks live
        </div>
      </div>
    );
  }

  const q = SWIPE_QUESTIONS[qIdx];
  const venue: Venue = questionVenues[qIdx] ?? questionVenues[0];

  return (
    <div className="px-5 pt-4 flex flex-col min-h-[calc(100vh-96px)]">
      <div className="text-[11px] font-extrabold text-primary uppercase tracking-[0.12em] mb-2">
        Question {qIdx + 1} of {SWIPE_QUESTIONS.length}
      </div>

      <div
        className="flex-1 min-h-[380px] rounded-[22px] relative overflow-hidden shadow-[0_12px_32px_rgba(0,0,0,0.18)]"
        style={{ background: `url(${venue.imgUrl}) center/cover` }}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/85" />
        <div className="absolute top-3.5 left-3.5">
          <span className="inline-block px-2.5 py-1 rounded-full bg-accent text-accent-fg text-[10px] font-extrabold uppercase tracking-[0.08em]">
            {q.moodPill}
          </span>
        </div>
        <div className="absolute left-4 right-4 bottom-4.5 text-white">
          <h2 className="text-[32px] font-extrabold m-0 tracking-tight">
            {q.label}
          </h2>
        </div>
      </div>

      <div className="py-4 flex justify-center gap-5">
        <button
          type="button"
          onClick={() => vote(false)}
          aria-label="No"
          className="w-[50px] h-[50px] rounded-full bg-card border border-border text-[17px] text-fg"
        >
          ✕
        </button>
        <button
          type="button"
          onClick={() => vote(true)}
          aria-label="Yes"
          className="w-[54px] h-[54px] rounded-full bg-accent text-accent-fg text-[22px] shadow-[0_6px_16px_rgba(0,0,0,0.15)]"
        >
          ♥
        </button>
      </div>
    </div>
  );
}
