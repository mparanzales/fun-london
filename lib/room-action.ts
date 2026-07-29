"use server";

// Plan Together — room lifecycle. The ONLY write path for rooms and
// membership.
//
// Every action derives the acting user from the session (getAuthUser) and
// calls a SECURITY DEFINER function that does the same via auth.uid(). No
// action accepts a user id, a member id or a host flag from the client, so a
// client cannot enrol, impersonate or promote anybody — including itself into
// a room it was not invited to.
//
// 🧨 Room codes are bearer secrets: they are arguments here, but they must
// never reach analytics, logs or error reports. Use hashRoomCode() when a
// code needs to be correlated (lib/room-code.ts).

import { getAuthUser } from "./auth";
import { createClient } from "./supabase/server";
import { rateLimit } from "./rate-limit";
import {
  isValidRoomCode,
  normaliseRoomCode,
  randomRoomCode,
} from "./room-code";

export type RoomRecord = {
  id: string;
  code: string;
  topic: string;
  hostUserId: string;
  expiresAt: string;
  closedAt: string | null;
  hostSeenAt: string;
};

export type RoomResult =
  | { ok: true; room: RoomRecord }
  | {
      ok: false;
      reason:
        "auth" | "not-found" | "expired" | "closed" | "rate-limited" | "error";
    };

type RoomRow = {
  id: string;
  code: string;
  topic: string;
  host_user_id: string;
  expires_at: string;
  closed_at: string | null;
  host_seen_at: string;
};

function toRecord(row: RoomRow): RoomRecord {
  return {
    id: row.id,
    code: row.code,
    topic: row.topic,
    hostUserId: row.host_user_id,
    expiresAt: row.expires_at,
    closedAt: row.closed_at,
    hostSeenAt: row.host_seen_at,
  };
}

/** Create a room with a fresh 6-char code and enrol the caller as host. */
export async function createRoom(): Promise<RoomResult> {
  const user = await getAuthUser();
  if (!user) return { ok: false, reason: "auth" };

  // Cheap abuse ceiling on room creation (shared Upstash counter when
  // configured, per-instance otherwise — same utility as public search).
  const allowed = await rateLimit(`room:create:${user.id}`, 10, 60 * 60 * 1000);
  if (!allowed) return { ok: false, reason: "rate-limited" };

  const supabase = await createClient();
  // Retry on the (vanishingly unlikely) unique-code collision rather than
  // handing the user an error: 32^6 space, but a duplicate must never merge
  // two groups into one room.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await supabase
      .rpc("create_plan_room", { p_code: randomRoomCode() })
      .single<RoomRow>();
    if (!error && data) return { ok: true, room: toRecord(data) };
    if (error && error.code !== "23505") return { ok: false, reason: "error" };
  }
  return { ok: false, reason: "error" };
}

/** Join an existing room by code. Enrols the caller as a member. */
export async function joinRoom(rawCode: string): Promise<RoomResult> {
  const user = await getAuthUser();
  if (!user) return { ok: false, reason: "auth" };

  const code = normaliseRoomCode(rawCode);
  if (!isValidRoomCode(code)) return { ok: false, reason: "not-found" };

  // The enumeration guard: 20 join attempts per user per 10 minutes. With a
  // 32^6 code space this makes guessing a live room impractical, and it is
  // generous enough that a real invitee retrying a flaky connection never
  // meets it.
  const allowed = await rateLimit(`room:join:${user.id}`, 20, 10 * 60 * 1000);
  if (!allowed) return { ok: false, reason: "rate-limited" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("join_plan_room", { p_code: code })
    .maybeSingle<RoomRow>();
  if (error) return { ok: false, reason: "error" };
  if (!data) {
    // join_plan_room returns NULL for unknown / expired / closed alike (it
    // deliberately does not leak which). Resolve the reason for OUR OWN copy
    // only when the room exists and the caller is already a member; otherwise
    // stay vague.
    const { data: probe } = await supabase
      .from("plan_rooms")
      .select("closed_at, expires_at")
      .eq("code", code)
      .maybeSingle<{ closed_at: string | null; expires_at: string }>();
    if (!probe) return { ok: false, reason: "not-found" };
    if (probe.closed_at) return { ok: false, reason: "closed" };
    if (Date.parse(probe.expires_at) <= Date.now())
      return { ok: false, reason: "expired" };
    return { ok: false, reason: "not-found" };
  }
  return { ok: true, room: toRecord(data) };
}

/** The room's roster + current host, for deterministic host resolution. */
export async function loadRoomState(roomId: string): Promise<{
  room: RoomRecord | null;
  roster: { userId: string; joinedAt: string }[];
}> {
  const user = await getAuthUser();
  if (!user) return { room: null, roster: [] };

  const supabase = await createClient();
  const [{ data: roomRow }, { data: memberRows }] = await Promise.all([
    supabase
      .from("plan_rooms")
      .select(
        "id, code, topic, host_user_id, expires_at, closed_at, host_seen_at",
      )
      .eq("id", roomId)
      .maybeSingle<RoomRow>(),
    supabase
      .from("plan_room_members")
      .select("user_id, joined_at")
      .eq("room_id", roomId)
      .is("left_at", null)
      .order("joined_at", { ascending: true }),
  ]);

  return {
    room: roomRow ? toRecord(roomRow) : null,
    roster: (memberRows ?? []).map(
      (m: { user_id: string; joined_at: string }) => ({
        userId: m.user_id,
        joinedAt: m.joined_at,
      }),
    ),
  };
}

/** Host-only: end the room now. */
export async function closeRoom(roomId: string): Promise<boolean> {
  const user = await getAuthUser();
  if (!user) return false;
  const supabase = await createClient();
  const { data } = await supabase.rpc("close_plan_room", { p_room_id: roomId });
  return data === true;
}

/** Host liveness ping (no-op unless the caller IS the host). */
export async function touchHost(roomId: string): Promise<void> {
  const user = await getAuthUser();
  if (!user) return;
  const supabase = await createClient();
  await supabase.rpc("touch_plan_room_host", { p_room_id: roomId });
}

/** Ask the DB to promote the earliest-joined active member. Returns new host. */
export async function promoteHost(roomId: string): Promise<string | null> {
  const user = await getAuthUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase.rpc("promote_plan_room_host", {
    p_room_id: roomId,
  });
  return (data as string | null) ?? null;
}

/** Mark the caller as gone (best-effort, on unmount). */
export async function leaveRoom(roomId: string): Promise<void> {
  const user = await getAuthUser();
  if (!user) return;
  const supabase = await createClient();
  await supabase.rpc("leave_plan_room", { p_room_id: roomId });
}
