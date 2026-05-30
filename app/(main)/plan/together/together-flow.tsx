"use client";

// Plan Together — entry / dispatcher (real-time).
//
// Resolves the room code (from ?room=… or a freshly generated one) and the
// local member identity on the client only, then mounts the realtime room.
// Gating behind `ready` avoids SSR/hydration mismatches from random ids.

import { useEffect, useRef, useState } from "react";
import type { Venue } from "@/lib/types";
import {
  makeMember,
  randomRoomCode,
  useRoom,
  type Member,
} from "@/lib/realtime/room";
import { Lobby } from "./_steps/lobby";
import { Swipe } from "./_steps/swipe";
import { Result } from "./_steps/result";

export function TogetherFlow({
  venues,
  myName,
}: {
  venues: Venue[];
  myName: string;
}) {
  const [ready, setReady] = useState(false);
  const codeRef = useRef<string>("");
  const meRef = useRef<Member | null>(null);

  useEffect(() => {
    const existing = new URLSearchParams(window.location.search).get("room");
    const code = existing ?? randomRoomCode();
    if (!existing) {
      window.history.replaceState(null, "", `/plan/together?room=${code}`);
    }
    codeRef.current = code;
    meRef.current = makeMember(myName);
    setReady(true);
  }, [myName]);

  if (!ready || !meRef.current) {
    return (
      <div className="px-5 py-16 text-center text-sm text-muted-fg">
        Setting up your room…
      </div>
    );
  }

  return <RoomFlow code={codeRef.current} me={meRef.current} venues={venues} />;
}

function RoomFlow({
  code,
  me,
  venues,
}: {
  code: string;
  me: Member;
  venues: Venue[];
}) {
  const room = useRoom(code, me);

  return (
    <div className="pb-4">
      {room.phase === "lobby" && (
        <Lobby room={room} onStart={() => room.sendPhase("swipe")} />
      )}
      {room.phase === "swipe" && <Swipe room={room} venues={venues} />}
      {room.phase === "result" && <Result room={room} venues={venues} />}
    </div>
  );
}
