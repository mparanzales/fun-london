// Where a Plan Together room code lives once it is OUT of the URL.
//
// 🧨 THE PROBLEM THIS SOLVES. A room code is a bearer credential: possessing it
// is authorisation to join. It used to sit in `window.location` as
// `/plan/together?room=CODE`, and posthog-js reads `window.location.href` on
// every captured event AND freezes it once as `$initial_person_info`, which it
// then posts as `$initial_current_url` on every `/flags` request. `/flags` does
// not go through the capture path, so no `sanitize_properties` hook can ever
// reach it. Redacting harder was never going to close that: the fix is for the
// credential not to be in the URL when PostHog starts.
//
// So an inline script in the root layout consumes `?room=` at HTML-parse time,
// hundreds of milliseconds before any app chunk loads, stashes it here, and
// rewrites the address bar to a clean `/plan/together`. This module is the
// stash, and the only place the code lives client-side afterwards.
//
// WHY localStorage AND NOT sessionStorage: a magic link opens in a NEW TAB,
// which destroys sessionStorage. `lib/analytics-keys.ts` already documents the
// same reasoning for the sign-in trigger. The window global is preferred when
// present because it survives storage being blocked entirely (Safari private
// mode throws on access), and dies with the document.
//
// WHY NOT ONE-SHOT, unlike the sign-in trigger: a page reload mid-room has to
// rejoin the SAME room. A one-shot read would consume the code on first load
// and drop the next reload into a brand new empty room, which is a far worse
// outcome for the user than the code sitting in same-origin storage that is
// never transmitted anywhere.

const ROOM_INVITE_KEY = "fl.room.invite.v1";

// Long enough for a real magic-link round trip (open the inbox, wait for
// delivery, tap through) and for ordinary reloads during a session, because it
// is re-armed on every successful attach. Short enough that a forgotten code
// does not linger for days.
const ROOM_INVITE_TTL_MS = 15 * 60 * 1000;

// Mirrors the shape check in lib/room-code.ts. Duplicated on purpose: the
// pre-paint inline script in app/layout.tsx cannot import anything, so this
// module and that script have to agree independently. Real validation is
// server-side in lib/room-action.ts; this only rejects obvious junk.
const ROOM_CODE_RE = /^[A-Z0-9]{6}$/;

type Stashed = { c: string; t: number };

declare global {
  interface Window {
    /** Written by the pre-paint script in app/layout.tsx. */
    __FL_ROOM_INVITE?: Stashed;
  }
}

function fresh(v: unknown): string | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Partial<Stashed>;
  if (typeof s.c !== "string" || !ROOM_CODE_RE.test(s.c)) return null;
  if (typeof s.t !== "number" || Date.now() - s.t > ROOM_INVITE_TTL_MS) {
    return null;
  }
  return s.c;
}

/**
 * The room code this browser should join, or null to start a new room.
 *
 * NOT one-shot: see the note at the top. The window global wins because the
 * pre-paint script always sets it and storage may be unavailable.
 */
export function readRoomInvite(): string | null {
  if (typeof window === "undefined") return null;
  const inMemory = fresh(window.__FL_ROOM_INVITE);
  if (inMemory) return inMemory;
  try {
    const raw = window.localStorage.getItem(ROOM_INVITE_KEY);
    if (!raw) return null;
    const code = fresh(JSON.parse(raw));
    // An expired or malformed entry is removed rather than left to be
    // re-parsed on every load.
    if (!code) window.localStorage.removeItem(ROOM_INVITE_KEY);
    return code;
  } catch {
    return null;
  }
}

/**
 * Remember the room this browser is in.
 *
 * Called after a successful join AND after a successful create, so a reload
 * rejoins the same room. Before this existed, the create path wrote the freshly
 * minted code straight back into the address bar with `history.replaceState` —
 * which meant the HOST leaked their own code, and the host is exactly the
 * visitor most likely to have `$initial_person_info` frozen with it.
 */
export function armRoomInvite(code: string): void {
  if (typeof window === "undefined") return;
  const c = code.trim().toUpperCase();
  if (!ROOM_CODE_RE.test(c)) return;
  const v: Stashed = { c, t: Date.now() };
  window.__FL_ROOM_INVITE = v;
  try {
    window.localStorage.setItem(ROOM_INVITE_KEY, JSON.stringify(v));
  } catch {
    // Private mode or quota. The in-memory copy still covers this document.
  }
}

/**
 * Forget the room.
 *
 * Called on a terminal join failure (so a dead code cannot loop forever) and on
 * SIGN-OUT. The sign-out call is not optional: without it, one person's invite
 * would enrol the next person on a shared browser as a real member of a room
 * they were never invited to.
 */
export function clearRoomInvite(): void {
  if (typeof window === "undefined") return;
  delete window.__FL_ROOM_INVITE;
  try {
    window.localStorage.removeItem(ROOM_INVITE_KEY);
  } catch {
    // ignore
  }
}

/**
 * The inline script that runs before anything else, exported so app/layout.tsx
 * and the tests read the SAME source rather than two copies that can drift.
 *
 * Constraints it works under, all deliberate:
 *   • no imports, no build step: it is injected as raw text;
 *   • guarded on the pathname, so it is a no-op byte on every other route,
 *     including the ISR-cached /anon twins;
 *   • everything in try/catch: it must never be able to break first paint;
 *   • `replaceState` runs BEFORE the shape test, so even a malformed code is
 *     stripped from the URL rather than left sitting there;
 *   • it replaces the current history entry rather than pushing, so the back
 *     button is unaffected.
 */
export const ROOM_INVITE_INLINE_SCRIPT = `(function(){try{
if(location.pathname!=="/plan/together")return;
var q=new URLSearchParams(location.search),r=q.get("room");
if(!r&&location.hash)r=new URLSearchParams(location.hash.slice(1)).get("room");
if(!r)return;
q.delete("room");var s=q.toString();
history.replaceState(null,"",location.pathname+(s?"?"+s:""));
var c=r.trim().toUpperCase();
if(!/^[A-Z0-9]{6}$/.test(c))return;
var v={c:c,t:Date.now()};window.__FL_ROOM_INVITE=v;
try{localStorage.setItem("${ROOM_INVITE_KEY}",JSON.stringify(v))}catch(e){}
}catch(e){}})();`;
