"use client";

import { useRouter } from "next/navigation";
import type { Venue } from "@/lib/types";
import type { Member, Room } from "@/lib/realtime/room";

// Plan Together — Step 3: Result (real-time).
// Built from the actual broadcast votes: each step shows the venue + the
// members who voted YES for that question (real attribution).

const STEP_LABELS = ["Start", "Then", "Finish"] as const;
const STEP_WORDS = ["dinner", "drinks", "a late one"] as const;

export function Result({
  room,
  questionVenues,
}: {
  room: Room;
  questionVenues: Venue[];
}) {
  const router = useRouter();

  const stepVenues: Venue[] = questionVenues;

  const memberById = new Map(room.members.map((m) => [m.id, m]));
  const yesVotersByQ: Member[][] = [0, 1, 2].map((q) =>
    room.votes
      .filter((v) => v.qIdx === q && v.value)
      .map((v) => memberById.get(v.memberId))
      .filter((m): m is Member => Boolean(m)),
  );

  const total = room.members.length;
  const mixLine =
    `${yesVotersByQ[0].length} of ${total} wanted dinner, ` +
    `${yesVotersByQ[1].length} were up for drinks, and ` +
    `${yesVotersByQ[2].length} fancied a late one. Here's your mix.`;

  return (
    <div className="px-4 pt-4 pb-6">
      <h1 className="text-[22px] font-extrabold text-primary tracking-tight m-0">
        Your group&apos;s night
      </h1>
      <div className="text-[11px] text-muted-fg mt-1">
        🫂 {total} {total === 1 ? "person" : "people"} · 🕒 ~3.5 h total
      </div>

      <div className="bg-accent/10 border border-accent/30 rounded-xl px-3 py-2.5 mt-3">
        <div className="text-[10px] font-extrabold text-accent uppercase tracking-[0.1em]">
          ✦ How we mixed it
        </div>
        <div className="text-[11.5px] text-fg mt-1 leading-snug">{mixLine}</div>
      </div>

      <div className="mt-3.5 flex flex-col gap-3">
        {stepVenues.map((v, i) => {
          const voters = yesVotersByQ[i] ?? [];
          const unanimous = voters.length === total && total > 0;
          const attribution =
            voters.length === 0
              ? `Nobody voted for ${STEP_WORDS[i]} — wildcard pick`
              : unanimous
                ? "Unanimous"
                : `${voters.map((p) => p.name).join(" & ")} voted yes`;
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
                  {voters.map((vp, j) => (
                    <div
                      key={vp.id}
                      className="w-[22px] h-[22px] rounded-full border-2 border-white grid place-items-center text-[10px]"
                      style={{ background: vp.color, marginLeft: j ? -6 : 0 }}
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
                  {attribution}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => router.push("/plan")}
        className="mt-5 w-full h-12 rounded-2xl border border-fg/15 text-fg text-sm font-semibold"
      >
        Plan another
      </button>
    </div>
  );
}
