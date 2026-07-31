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
import { isValidRoomCode, normaliseRoomCode } from "./room-code";

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

/**
 * SQLSTATE raised by BOTH room throttles (`configuration_limit_exceeded`).
 *
 * The DB limits are the real ones: `create_plan_room` and `join_plan_room` are
 * granted to `authenticated`, so they are reachable straight over PostgREST and
 * the Upstash counters above them can simply be skipped. Anything hitting the
 * RPC directly meets this instead.
 */
const THROTTLE_SQLSTATE = "53400";

/**
 * Did Postgres refuse this because of a rate limit, rather than breaking?
 *
 * Kept separate from the generic error branch because collapsing them is how a
 * throttle becomes a lie: `reason: "error"` falls through failureFromJoin's
 * default to "denied", which on the CREATE path renders "You're not in this
 * room" — about a room the user was trying to start, on a screen with no
 * action. It also matters for analytics: `together_join_denied` reports this
 * reason, and "error" and "rate-limited" need very different responses.
 */
function isThrottled(error: { code?: string } | null): boolean {
  return error?.code === THROTTLE_SQLSTATE;
}

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

/**
 * Create a room and enrol the caller as host.
 *
 * 🧨 The CODE IS MINTED BY THE DATABASE, and the client must not send one.
 * When the caller supplied the code, a duplicate came back as `23505` — which
 * turned this call into an oracle for "does room ABC234 exist?", answerable at
 * unlimited rate and completely bypassing the join throttle that is supposed
 * to be the enumeration perimeter. `create_plan_room()` now generates the code
 * with a CSPRNG and retries collisions internally, so no caller ever learns
 * which codes are taken. See supabase/migrations/0004_server_side_room_codes.sql.
 */
export async function createRoom(): Promise<RoomResult> {
  const user = await getAuthUser();
  if (!user) return { ok: false, reason: "auth" };

  // Cheap abuse ceiling on room creation (shared Upstash counter when
  // configured, per-instance otherwise — same utility as public search).
  const allowed = await rateLimit(`room:create:${user.id}`, 10, 60 * 60 * 1000);
  if (!allowed) return { ok: false, reason: "rate-limited" };

  const supabase = await createClient();
  // No client-side retry loop any more: collision handling moved into the
  // function, where it belongs, because that is the only place it can be done
  // without telling the caller what it collided with.
  const { data, error } = await supabase
    .rpc("create_plan_room")
    .single<RoomRow>();
  // 🧨 The DB throttle has to be told apart from a generic failure, or it is
  // WORSE than no throttle. Every error used to collapse to "error", which
  // failureFromJoin maps through its default to "denied" — so a user who hit
  // the create limit was told "You're not in this room" on a screen with no
  // action, about a room they were trying to START. Recognising 53400 sends
  // them to "That's a lot of rooms", which is both true and actionable.
  if (isThrottled(error)) return { ok: false, reason: "rate-limited" };
  if (error || !data) return { ok: false, reason: "error" };
  return { ok: true, room: toRecord(data) };
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
  // Same treatment as create. The user-visible screen is identical either way
  // (join deliberately stays vague, so both land on "denied"), but the reason
  // is what `together_join_denied` reports, and "we throttled you" and
  // "something broke" are not the same finding when reading that funnel.
  if (isThrottled(error)) return { ok: false, reason: "rate-limited" };
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

/** Ask the DB to promote the next active member in the ring. Returns new host. */
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
