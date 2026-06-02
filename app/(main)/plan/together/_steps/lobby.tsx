"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Share2 } from "lucide-react";
import { shareOrCopy } from "@/lib/share";
import { Avatar } from "./avatar";
import type { Room } from "@/lib/realtime/room";

// Plan Together — Step 1: Lobby (real-time).
// Real presence: `room.members` updates live as people open the link.

export function Lobby({ room, onStart }: { room: Room; onStart: () => void }) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);

  const link =
    typeof window !== "undefined"
      ? `${window.location.origin}/plan/together?room=${room.code}`
      : "";

  const onShare = async () => {
    const r = await shareOrCopy({
      title: "Plan a night out, Fun London",
      text: `Join my Fun London room (${room.code}) and let's pick a night.`,
      url: link,
    });
    if (r === "copied") {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  const alone = room.members.length < 2;

  return (
    <div className="px-5 py-4 flex flex-col">
      <button
        type="button"
        onClick={() => router.push("/plan")}
        aria-label="Back"
        className="self-start -ml-2 p-2.5 text-muted-fg mb-1"
      >
        <ArrowLeft className="w-5 h-5" strokeWidth={2} />
      </button>

      <div className="text-[11px] font-extrabold text-primary uppercase tracking-[0.12em]">
        Plan together
      </div>
      <h1 className="text-2xl font-extrabold text-heading mt-1 mb-2 tracking-tight">
        Get the gang in
      </h1>
      <div className="text-[13px] text-muted-fg leading-relaxed mb-4">
        Share the link or the room code. They open it, swipe, done.
      </div>

      {/* Room code */}
      <div className="flex items-center justify-center gap-2 mb-3">
        <span className="text-[11px] font-bold text-muted-fg uppercase tracking-wider">
          Room
        </span>
        <span className="text-2xl font-extrabold tracking-[0.3em] text-primary">
          {room.code}
        </span>
      </div>

      {/* Share */}
      <button
        type="button"
        onClick={onShare}
        className="w-full h-12 rounded-2xl bg-primary text-primary-fg text-sm font-extrabold flex items-center justify-center gap-2 mb-4"
      >
        {copied ? (
          <Check className="w-4 h-4" strokeWidth={2.5} />
        ) : (
          <Share2 className="w-4 h-4" strokeWidth={2} />
        )}
        {copied ? "Link copied" : "Share the link"}
      </button>

      <div className="flex items-center justify-between mb-2.5">
        <div className="text-[13px] font-extrabold text-heading">
          In the session · {room.members.length}
        </div>
        <span
          className="text-[10px] font-extrabold"
          style={{ color: "hsl(150 60% 40%)" }}
        >
          ● Live
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {room.members.map((p) => (
          <div
            key={p.id}
            className="flex items-center gap-2.5 px-3 py-2.5 border border-border rounded-xl"
          >
            <Avatar participant={p} size={32} fontSize={14} />
            <div className="flex-1">
              <div className="text-[13px] font-extrabold text-heading">
                {p.name}
                {p.id === room.me.id && (
                  <span className="text-muted-fg font-semibold"> (you)</span>
                )}
              </div>
              <div className="text-[10.5px] text-muted-fg">Joined · ready</div>
            </div>
          </div>
        ))}
        {alone && (
          <div className="px-3 py-2.5 border border-dashed border-border rounded-xl text-[11px] text-muted-fg">
            Waiting for someone to join…
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onStart}
        className="mt-6 mb-4 w-full h-[52px] rounded-2xl bg-primary text-primary-fg text-sm font-extrabold"
      >
        Start swiping ({room.members.length})
      </button>
      <p className="text-[11px] text-muted-fg text-center -mt-2">
        Anyone can start, everyone jumps to swiping together.
      </p>
    </div>
  );
}
