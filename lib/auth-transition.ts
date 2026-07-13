// Auth-transition detection shared by the saved + bookings contexts.
//
// Both contexts hold their state as an in-memory Set/array and re-hydrate
// whenever `authUserId` changes. The one transition they must react to
// specially is SIGN-OUT (a uuid becoming null): the in-memory state still
// holds the just-signed-out account's data, and the anonymous hydrate that
// runs next cannot clear it (localStorage was emptied during that account's
// sign-in migration and never rewritten while signed in). Left untouched, the
// retained data gets persisted back to localStorage and then migrated into the
// NEXT account signed in on the same browser — one user's saves/bookings
// leaking into another's.
//
// This helper isolates the single decision "should we wipe local state now?"
// so it can be unit-tested and so both contexts stay in exact parity.

/**
 * True only on the signed-in → signed-out transition (a previous uuid becoming
 * null). Returns false on a normal anonymous mount (prev === null), so a
 * genuine anonymous user's saved spots are never wiped, and false on token
 * refresh / sign-in / a null first render.
 *
 * A direct account switch (uuid → different uuid, no null in between) does not
 * count: that path re-hydrates authoritatively from the new user's DB rows and
 * localStorage is already empty, so there is nothing to bleed.
 */
export function isSignOutTransition(
  prevAuthUserId: string | null,
  authUserId: string | null,
): boolean {
  return prevAuthUserId !== null && authUserId === null;
}
