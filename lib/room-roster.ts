// Roster-gated payload acceptance for Plan Together.
//
// THE ATTACK THIS CLOSES: member identity used to be a client-minted
// crypto.randomUUID(). Because every vote, reaction and taste payload carried
// its own `memberId`, one signed-in client could emit N payloads under N
// invented ids and manufacture a veto majority (or drown out real votes)
// without anyone else in the room being able to tell.
//
// THE FIX HERE: identity is the authenticated user id, and the roster is read
// from the database (plan_room_members), not from presence. Every inbound
// payload is checked against that roster before it is applied, so:
//   · invented members are dropped — the roster is server-owned;
//   · a departed member's late payloads are dropped;
//   · a payload claiming to be from ME that I did not send is dropped
//     (a real member cannot silently overwrite my own vote on my screen).
//
// 🧨 HONEST LIMIT, do not overstate it in copy or docs: broadcast payloads are
// still client-authored, so member A can still send a payload stamped with
// member B's user id, and other devices cannot cryptographically disprove it.
// What is now impossible is inflating the group beyond its real membership —
// the majority denominator and the voter set are both server-owned. Closing
// member-to-member impersonation needs server-authoritative votes (writes to
// the DB rather than broadcast), which is a product change, not a security
// patch, and is recorded as a remaining limitation.

export type RosterGuard = {
  /** Authoritative member ids, from plan_room_members. */
  memberIds: Set<string>;
  /** My own authenticated id. */
  myUserId: string;
};

/**
 * Should an inbound broadcast payload be applied?
 *
 * `selfEcho` must be the answer to "did I actually send this?", NOT
 * "is it stamped with my id?" — passing the latter makes the self-spoof check
 * vacuous (it was, before review). Callers track their own outbound payload
 * keys and pass the real answer; see `sentKeysRef` in lib/realtime/room.ts.
 */
export function acceptsPayload(
  guard: RosterGuard,
  memberId: unknown,
  selfEcho = false,
): boolean {
  if (typeof memberId !== "string" || memberId.length === 0) return false;
  if (!guard.memberIds.has(memberId)) return false;
  if (memberId === guard.myUserId && !selfEcho) return false;
  return true;
}

/** Drop presence entries that aren't on the server-owned roster. */
export function filterPresence<T extends { id: string }>(
  guard: RosterGuard,
  present: T[],
): T[] {
  const seen = new Set<string>();
  return present.filter((p) => {
    if (!guard.memberIds.has(p.id) || seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}
