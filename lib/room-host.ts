// Deterministic host resolution for Plan Together.
//
// The problem this solves (documented in the feasibility pack): host was
// decided purely by "did my URL have ?room" — so when the host closed their
// tab, NO device held the host role, majority-veto swaps silently stopped
// applying, and the room degraded into a read-only artefact with no owner.
//
// The rule, deliberately boring: the host is the earliest-joined member who
// is still present. `joined_at` comes from the database (server clock), so
// every device sorts the same list the same way and converges on the same
// answer WITHOUT any negotiation, election message, or race.
//
// ⚠️ The client rule and the DB rule are NOT identical, and that is deliberate:
// the client knows who is PRESENT (Realtime presence); the database only knows
// who has not written `left_at`, which is best-effort. So the client decides
// WHEN a handoff is needed and who should ask; the database decides WHO gets
// it (earliest-joined member excluding the outgoing host) and makes that
// choice single-valued via a conditional UPDATE. The DB is the authority; this
// module is the trigger. Where they can disagree — a member who is recorded
// but not currently looking at the screen — the DB's answer wins and every
// device then reads it back on the next tick.

export type RosterEntry = {
  userId: string;
  /** ISO timestamp from the database, never a client clock. */
  joinedAt: string;
};

/** Milliseconds a host may be unseen before the room promotes someone else. */
export const HOST_STALE_MS = 30_000;

/**
 * The member who should hold the host role.
 *
 * Ordering: joined_at ascending, then userId ascending as a stable tiebreak
 * (two members can share a millisecond; string order is total and identical
 * on every device, unlike Array#sort's default on equal keys).
 */
export function resolveHost(
  roster: RosterEntry[],
  presentUserIds: Iterable<string>,
): string | null {
  const present = new Set(presentUserIds);
  const candidates = roster
    .filter((r) => present.has(r.userId))
    .sort((a, b) => {
      const t = Date.parse(a.joinedAt) - Date.parse(b.joinedAt);
      return t !== 0
        ? t
        : a.userId < b.userId
          ? -1
          : a.userId > b.userId
            ? 1
            : 0;
    });
  return candidates[0]?.userId ?? null;
}

/**
 * Should this device ask the database to promote a new host?
 *
 * True only when the recorded host is both absent and stale, AND this device
 * is the one the rule would pick. Every other device stays quiet, so the
 * common case is exactly one RPC — and if two devices disagree about presence
 * for a moment, the conditional UPDATE inside promote_plan_room_host() still
 * makes the outcome single-valued.
 */
export function shouldClaimHost(args: {
  roster: RosterEntry[];
  presentUserIds: Iterable<string>;
  hostUserId: string | null;
  hostSeenAt: string | null;
  myUserId: string;
  now?: number;
}): boolean {
  const now = args.now ?? Date.now();
  const present = new Set(args.presentUserIds);
  if (args.hostUserId && present.has(args.hostUserId)) return false;
  const seen = args.hostSeenAt ? Date.parse(args.hostSeenAt) : 0;
  if (now - seen < HOST_STALE_MS) return false;
  return resolveHost(args.roster, present) === args.myUserId;
}
