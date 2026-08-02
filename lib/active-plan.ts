/**
 * The ACTIVE night — the one plan a browser is currently working on, kept
 * across refresh, navigation and Plan → Venue → Back.
 *
 * WHY. Today a generated night lives only in React state, so a refresh, a tap
 * through to a venue page, or the three navigations through /auth/callback all
 * destroy it. The anon flow already worked around this with a one-shot
 * localStorage stash (`fl.anonplan.v1`) read exactly once at sign-in; this
 * generalises that into a proper store so the signed-in flow gets the same
 * durability instead of a second bespoke workaround.
 *
 * 🧨 OWNER-SCOPED KEYS, NOT ONE GLOBAL KEY.
 *
 * This repo has already been bitten by shared-browser bleed: an
 * anon-localStorage / signed-in-DB context that did not reset when the user id
 * went uuid -> null let one account's saves show up for the next person on the
 * same browser (fixed for saved venues and bookings in PR #129). A single
 * `fl:active-plan` key would reintroduce exactly that: sign out, and the next
 * visitor inherits your night.
 *
 * So the key CONTAINS the owner. An anonymous browser and every signed-in user
 * get physically separate slots, and there is no code path that can read
 * another owner's slot — the bleed is impossible by construction rather than
 * prevented by remembering to clear.
 *
 * Handing a night from anon to a signed-in user is therefore an EXPLICIT act
 * (`claimAnonPlan`), which is the correct shape anyway: it is the moment we
 * want to measure, and it should not happen by accident.
 */
import { parseNightPlan, type NightPlan } from "@/lib/night-plan";

/** Exported so a cross-tab listener can recognise ANY owner's slot without
 *  knowing the uuid — the signal that somebody signed in and claimed. */
export const ACTIVE_PLAN_PREFIX = "fl:active-plan:v1";
const PREFIX = ACTIVE_PLAN_PREFIX;

/**
 * 🧨 EVERY KEY THAT CAN HOLD THE ANONYMOUS BROWSER'S NIGHT, IN ONE PLACE.
 *
 * The owner-scoped key below makes bleed impossible for the store's OWN slot.
 * It says nothing about a key the store has never heard of — and that is
 * exactly how this bug came back. A second anon key was added elsewhere for
 * the signed-out result screen, nothing cleared it on claim or on sign-out,
 * and so: A builds a night and signs in (canonical + legacy copies destroyed,
 * the third survives) -> A signs out -> B opens /plan and A's night rehydrates
 * onto B's screen, is re-persisted into the anon slot from there, and is then
 * claimed into B's account, firing a false conversion and letting B save A's
 * night as their own row. That is the PR #129 bug class through a new door.
 *
 * So the list lives HERE, next to the invariant it serves, and the owners of
 * these keys import them rather than declaring their own. Adding an anon key
 * anywhere else is the mistake; adding it to this list is the fix.
 */
export const ANON_PLAN_STASH_KEY = "fl.anonplan.v1";
export const ANON_RESULT_KEY = "fl.anonresult.v1";

/**
 * The per-stop replacement history for the night in the active slot.
 *
 * Owner-scoped like the night itself, and — 🧨 — listed in the anon sweep
 * below. It holds venue references for a night one person built; leaving it
 * behind on a shared browser is the same bleed as leaving the night behind,
 * and this repo has now shipped that bug twice through keys the store did not
 * know about.
 *
 * Kept SEPARATE from the NightPlan rather than folded into it: a NightPlan is
 * the interchange shape written to a jsonb column and handed between surfaces,
 * and an undo stack is neither durable product data nor anything the database
 * should carry.
 */
const UNDO_PREFIX = "fl:plan-undo:v1";

export function undoStackKey(owner: PlanOwner): string {
  return `${UNDO_PREFIX}:${owner ?? "anon"}`;
}

/** One arrangement in the history: the night's stops as references. */
export type StoredUndoEntry = {
  stops: { venueId: string; slug: string; role: string }[];
  cycle: Record<number, string[]>;
};

type StoredUndo = {
  v: 1;
  /** Venue ids of the night this history belongs to, in order. */
  sig: string;
  entries: StoredUndoEntry[];
};

/** Drop one owner's replacement history. Used on the sign-out transition, so
 *  the departing account's venue ids do not sit on a shared browser. */
export function clearUndoStack(owner: PlanOwner, store?: StorageLike | null) {
  const s = store ?? defaultStorage();
  if (!s) return;
  try {
    s.removeItem(undoStackKey(owner));
  } catch {
    /* nothing to do */
  }
}

export function readUndoStack(
  owner: PlanOwner,
  sig: string,
  store?: StorageLike | null,
): StoredUndoEntry[] {
  const s = store ?? defaultStorage();
  if (!s) return [];
  let raw: string | null = null;
  try {
    raw = s.getItem(undoStackKey(owner));
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as StoredUndo;
    // 🧨 The signature must match. A history is only meaningful against the
    // night it was made on — replaying one night's stack onto another would
    // restore stops that belong somewhere else.
    if (parsed?.v !== 1 || parsed.sig !== sig) return [];
    if (!Array.isArray(parsed.entries)) return [];
    return parsed.entries.filter(
      (e) =>
        e &&
        Array.isArray(e.stops) &&
        e.stops.every(
          (st) =>
            st &&
            typeof st.venueId === "string" &&
            st.venueId.length > 0 &&
            typeof st.role === "string",
        ),
    );
  } catch {
    return [];
  }
}

export function writeUndoStack(
  owner: PlanOwner,
  sig: string,
  entries: StoredUndoEntry[],
  store?: StorageLike | null,
): void {
  const s = store ?? defaultStorage();
  if (!s) return;
  try {
    if (entries.length === 0) {
      s.removeItem(undoStackKey(owner));
      return;
    }
    const payload: StoredUndo = { v: 1, sig, entries };
    s.setItem(undoStackKey(owner), JSON.stringify(payload));
  } catch {
    // Quota or private mode. The history stays in memory for this session.
  }
}

/** `null` owner = the anonymous browser. */
export type PlanOwner = string | null;

export function activePlanKey(owner: PlanOwner): string {
  return `${PREFIX}:${owner ?? "anon"}`;
}

/**
 * The slice of localStorage this module uses.
 *
 * Injectable so the tests can exercise the store without a DOM — this repo's
 * suite runs framework-free in the Node environment, and adding jsdom for four
 * functions would be a heavier dependency than the code under test.
 */
export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/** localStorage is unavailable in Safari private mode and in SSR. Every access
 *  here is best-effort: losing the active plan is a downgrade, never an error. */
function defaultStorage(): StorageLike | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/** An in-memory StorageLike. Exported for tests and for any future
 *  non-browser caller; nothing in the app should reach for this. */
export function memoryStorage(): StorageLike {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

export function readActivePlan(
  owner: PlanOwner,
  store?: StorageLike | null,
): NightPlan | null {
  const s = store ?? defaultStorage();
  if (!s) return null;
  let raw: string | null = null;
  try {
    raw = s.getItem(activePlanKey(owner));
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Corrupt entry: drop it rather than leaving it to fail on every load.
    clearActivePlan(owner, s);
    return null;
  }
  const plan = parseNightPlan(parsed);
  if (!plan) {
    // Structurally invalid, or written by a future version. Either way this
    // browser cannot use it, so stop trying.
    clearActivePlan(owner, s);
    return null;
  }
  return plan;
}

export function writeActivePlan(
  owner: PlanOwner,
  plan: NightPlan,
  store?: StorageLike | null,
): void {
  const s = store ?? defaultStorage();
  if (!s) return;
  try {
    s.setItem(activePlanKey(owner), JSON.stringify(plan));
  } catch {
    // Quota exceeded, or private mode. The night stays in memory for this
    // session; it simply will not survive a refresh.
  }
}

export function clearActivePlan(
  owner: PlanOwner,
  store?: StorageLike | null,
): void {
  const s = store ?? defaultStorage();
  if (!s) return;
  try {
    s.removeItem(activePlanKey(owner));
  } catch {
    /* nothing to do */
  }
}

/**
 * EVERY key that can hold the anonymous browser's night, from one place.
 *
 * 🧨 Exported so the tests assert over THIS, not over a list they keep
 * themselves. The hand-written version stayed green when a new anon key was
 * added and not swept — which is precisely the bug those tests exist to catch,
 * and precisely the comment they carry. A guard that maintains its own copy of
 * the thing it guards cannot see what the code added.
 */
export function anonPlanKeys(): string[] {
  return [
    activePlanKey(null),
    ANON_PLAN_STASH_KEY,
    ANON_RESULT_KEY,
    undoStackKey(null),
  ];
}

/** Wipe the anonymous browser's night in every form it can take. Safe to call
 *  when there is nothing there. */
export function clearAnonPlanKeys(store?: StorageLike | null): void {
  const s = store ?? defaultStorage();
  if (!s) return;
  for (const k of anonPlanKeys()) {
    try {
      s.removeItem(k);
    } catch {
      /* nothing to do */
    }
  }
}

/**
 * Move the anonymous browser's night to a signed-in owner, once.
 *
 * This is the "I built a night, then signed in to save it" path. It is
 * deliberately destructive on the anon side: leaving a copy behind is how the
 * next person on a shared browser inherits it.
 *
 * Returns the claimed plan, or null when there was nothing to claim.
 *
 * 🧨 The anonymous night WINS over anything already in the owner slot. The
 * first draft had this backwards, on the reasoning that "silently replacing
 * the plan someone is looking at is worse". At claim time the user is looking
 * at the ANONYMOUS night — they just built it and tapped Save — and the owner
 * slot can only have been written while signed in, i.e. strictly before the
 * sign-out that led here. So the anonymous one is provably the newer, and the
 * one they are asking to keep. Discarding it loses the exact night they
 * created an account to save.
 */
export function claimAnonPlan(
  owner: string,
  store?: StorageLike | null,
): NightPlan | null {
  const s = store ?? defaultStorage();
  const anon = readActivePlan(null, s);
  if (!anon) return null;
  // ALL of them, not just the slot we read from — see clearAnonPlanKeys.
  clearAnonPlanKeys(s);
  const claimed: NightPlan = { ...anon, source: "anon" };
  writeActivePlan(owner, claimed, s);
  return claimed;
}
