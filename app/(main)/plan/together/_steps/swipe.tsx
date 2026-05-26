"use client";

import { useState } from "react";
import type { Venue } from "@/lib/types";

// Plan Together — Step 2: Group Swipe.
// Three questions cycled by tapping ✕ or ♥. The card photo + mood pill
// matches the prototype's progressive theming.
const SWIPE_QUESTIONS = [
  { label: "Dinner?", moodPill: "🍝 Mood", venueIdx: 0 },
  { label: "Drinks?", moodPill: "🍸 Mood", venueIdx: 2 },
  { label: "Late night?", moodPill: "🌙 Mood", venueIdx: 6 },
] as const;

export function Swipe({
  onDone,
  venues,
}: {
  onDone: () => void;
  venues: Venue[];
}) {
  const [qIdx, setQIdx] = useState(0);
  const q = SWIPE_QUESTIONS[qIdx];
  const venue: Venue = venues[q.venueIdx] ?? venues[0];

  const advance = () => {
    if (qIdx + 1 < SWIPE_QUESTIONS.length) {
      setQIdx(qIdx + 1);
    } else {
      onDone();
    }
  };

  return (
    <div className="px-5 pt-4 flex flex-col min-h-[calc(100vh-96px)]">
      <div className="text-[11px] font-extrabold text-primary uppercase tracking-[0.12em] mb-2">
        Question {qIdx + 1} of {SWIPE_QUESTIONS.length}
      </div>

      <div
        className="flex-1 min-h-[380px] rounded-[22px] relative overflow-hidden shadow-[0_12px_32px_rgba(0,0,0,0.18)]"
        style={{ background: `url(${venue.imgUrl}) center/cover` }}
      >
        {/* Dark gradient overlay so the white title reads on any photo */}
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
          onClick={advance}
          aria-label="No"
          className="w-[50px] h-[50px] rounded-full bg-card border border-border text-[17px] text-fg"
        >
          ✕
        </button>
        <button
          type="button"
          onClick={advance}
          aria-label="Yes"
          className="w-[54px] h-[54px] rounded-full bg-accent text-accent-fg text-[22px] shadow-[0_6px_16px_rgba(0,0,0,0.15)]"
        >
          ♥
        </button>
      </div>
    </div>
  );
}
