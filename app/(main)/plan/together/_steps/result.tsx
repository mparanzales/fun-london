"use client";

import { getParticipants, getVenues } from "@/lib/mock-data";
import type { Participant, Venue } from "@/lib/types";

// Plan Together — Step 4: Result.
// 3-step mixed itinerary with voter attribution. All votes hardcoded —
// no real swipe data carries through from Step 2 in MVP.

const STEP_LABELS = ["Start", "Then", "Finish"] as const;

export function Result() {
  // Three venues (matches prototype: PLACES[1], PLACES[2], PLACES[6]).
  const venues = getVenues();
  const stepVenues: Venue[] = [venues[1], venues[2], venues[6]].filter(Boolean);
  const participants = getParticipants();

  // Hardcoded vote attribution — step 1 unanimous, step 2 You+Tom,
  // step 3 Maya+Alex.
  const [you, maya, tom, alex] = participants;
  const voters: Participant[][] = [
    [you, maya, tom, alex],
    [you, tom],
    [maya, alex],
  ];

  return (
    <div className="px-4 pt-4 pb-6">
      <h1 className="text-[22px] font-extrabold text-primary tracking-tight m-0">
        Lively Night in Shoreditch
      </h1>
      <div className="text-[11px] text-muted-fg mt-1">
        📍 Shoreditch · 🕒 ~3.5 h total
      </div>

      {/* "How we mixed it" callout — soft purple wash + accent border */}
      <div className="bg-accent/10 border border-accent/30 rounded-xl px-3 py-2.5 mt-3">
        <div className="text-[10px] font-extrabold text-accent uppercase tracking-[0.1em]">
          ✦ How we mixed it
        </div>
        <div className="text-[11.5px] text-fg mt-1 leading-snug">
          All of you wanted Drinks. Maya and Tom voted Lively, you and
          Mysterious went Chill. We landed on a Lively buzz with ££££ leaning
          Mid-vibey.
        </div>
      </div>

      <div className="mt-3.5 flex flex-col gap-3">
        {stepVenues.map((v, i) => {
          const stepVoters = voters[i] ?? [];
          const unanimous = stepVoters.length === participants.length;
          const attribution = unanimous
            ? "Unanimous"
            : `${stepVoters.map((p) => p.name).join(" & ")} picked this`;
          const firstEmoji = stepVoters[0]?.emoji ?? "";
          return (
            <div
              key={v.id}
              className="bg-card border border-border rounded-2xl overflow-hidden"
            >
              <div
                className="h-[110px] relative"
                style={{ background: `url(${v.imgUrl}) center/cover` }}
              >
                <div className="absolute top-2 left-2 px-2 py-[3px] rounded-full bg-primary text-primary-fg text-[9px] font-extrabold uppercase tracking-[0.08em]">
                  Step {i + 1} · {STEP_LABELS[i]}
                </div>
                <div className="absolute top-2 right-2 flex">
                  {stepVoters.map((vp, j) => (
                    <div
                      key={vp.id}
                      className="w-[22px] h-[22px] rounded-full border-2 border-white grid place-items-center text-[10px]"
                      style={{
                        background: vp.color,
                        marginLeft: j ? -6 : 0,
                      }}
                    >
                      {vp.emoji}
                    </div>
                  ))}
                </div>
              </div>
              <div className="p-3">
                <div className="text-sm font-extrabold text-heading">
                  {v.name}
                </div>
                <div className="text-[10.5px] text-muted-fg mt-0.5 flex gap-1.5">
                  <span className="text-accent font-bold">{v.type}</span>
                  <span>·</span>
                  <span>{v.price}</span>
                  <span>·</span>
                  <span>~75 min</span>
                </div>
                <div className="text-[10.5px] text-muted-fg italic mt-1">
                  {firstEmoji} {attribution}
                </div>
              </div>
              {i < stepVenues.length - 1 && (
                <div className="px-3 py-1.5 text-[10px] text-muted-fg border-t border-dashed border-border">
                  🚶 ~6 min walk
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
