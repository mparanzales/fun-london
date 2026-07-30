// Honest failure states for a Plan Together room.
//
// Before this, a room that failed to open showed "Setting up your room…"
// forever — the user could not tell a slow network from a denied room from a
// room that had expired. Same class of failure as the silent cron: it fails
// by going quiet.
//
// Copy rules (existing Fun London voice): say what happened, say what to do,
// never blame the user, never invent a cause we don't know. Kept short —
// these render inside the existing lobby layout, no redesign.

export type RoomFailure =
  | "timeout" // subscribe never reached SUBSCRIBED
  | "channel-error" // Realtime returned CHANNEL_ERROR
  | "denied" // not a member (or the membership write failed)
  | "expired" // room past expires_at
  | "closed" // host ended it
  | "not-found" // code doesn't exist
  | "offline" // browser lost the network
  | "auth" // no session (should be caught by the page, belt-and-braces)
  | "too-many-rooms"; // the CREATE-path rate limit (not a join problem)

export type RoomFailureCopy = {
  title: string;
  body: string;
  /** Primary action label, or null when the only sensible move is to go back. */
  action: string | null;
};

export const ROOM_FAILURE_COPY: Record<RoomFailure, RoomFailureCopy> = {
  timeout: {
    title: "That room didn't open",
    body: "The connection took too long. It's usually a blip. Give it another go.",
    action: "Try again",
  },
  "channel-error": {
    title: "That room didn't open",
    body: "Something hiccuped on our end. Give it another go.",
    action: "Try again",
  },
  denied: {
    title: "You're not in this room",
    body: "Ask whoever started it to send you the link again. The code alone isn't enough any more.",
    action: null,
  },
  expired: {
    title: "That room has expired",
    body: "Rooms last about six hours. Start a fresh one and re-share the link.",
    action: "Start a new room",
  },
  closed: {
    title: "That room was closed",
    body: "Whoever started it ended the session. Start a fresh one if you're still going out.",
    action: "Start a new room",
  },
  "not-found": {
    title: "We can't find that room",
    body: "Check the code, or ask for the link again.",
    action: "Start a new room",
  },
  offline: {
    title: "You're offline",
    body: "We'll pick the room back up when you're connected.",
    action: "Try again",
  },
  "too-many-rooms": {
    title: "That's a lot of rooms",
    body: "You've started several in the last hour. Give it a few minutes, or carry on in one you already opened.",
    action: null,
  },
  auth: {
    title: "Sign in to join",
    body: "Rooms are sign-in only so the plan can tune itself to everyone's taste.",
    action: null,
  },
};

/** Map a Supabase Realtime subscribe status onto a failure, or null if fine. */
export function failureFromStatus(status: string): RoomFailure | null {
  switch (status) {
    case "SUBSCRIBED":
      return null;
    case "TIMED_OUT":
      return "timeout";
    case "CHANNEL_ERROR":
      // Realtime reports an RLS rejection as a channel error; membership is
      // checked separately before subscribing, so by this point the likelier
      // cause is transport. `denied` is set explicitly by the join path.
      return "channel-error";
    case "CLOSED":
      return "offline";
    default:
      return null;
  }
}

/**
 * Map a room RPC's outcome onto a failure.
 *
 * `mode` matters: the same "rate-limited" reason means "you have started too
 * many rooms" when creating and "we could not let you in" when joining. Before
 * review these shared one string and told a user trying to START a room that
 * they should ask for the link again.
 */
export function failureFromJoin(
  result: { ok: boolean; reason?: string } | null,
  mode: "join" | "create" = "join",
): RoomFailure | null {
  if (result?.ok) return null;
  if (result?.reason === "rate-limited")
    return mode === "create" ? "too-many-rooms" : "denied";
  switch (result?.reason) {
    case "expired":
      return "expired";
    case "closed":
      return "closed";
    case "not-found":
      return "not-found";
    case "rate-limited":
      return "denied";
    case "auth":
      return "auth";
    default:
      return "denied";
  }
}

/**
 * Is this join failure worth keeping the stashed room code for?
 *
 * 🧨 THIS TAKES THE ROOM RESULT'S OWN `reason`, NOT THE MAPPED RoomFailure, and
 * that distinction is the whole point. The first version of the caller tested
 * the mapped value against "timeout" / "channel-error" / "offline" — three
 * values `failureFromJoin` CANNOT PRODUCE. They come from `failureFromStatus`,
 * the Realtime path. So the guard was always false and every join failure
 * deleted the invite, including a transport blip on patchy 4G: the invitee got
 * "You're not in this room" with no action, and because the URL is clean now, a
 * reload started a brand new empty room instead of retrying.
 *
 *   error        — the RPC threw. Network, timeout, a transient DB error.
 *   rate-limited — 20 join attempts per 10 minutes, enforced in the DB. A user
 *                  on a flaky connection burns these through no fault of their
 *                  own, and they refill.
 *
 * Everything else (not-found, expired, closed, auth) is terminal: the room is
 * gone or was never theirs, and holding the code would re-attempt it on every
 * future visit to /plan/together on this browser.
 */
export function isTransientJoinReason(reason?: string): boolean {
  return reason === "error" || reason === "rate-limited";
}
