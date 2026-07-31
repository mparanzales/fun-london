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

// Long enough for a real magic-link round trip: read the wall, tap Sign up,
// type an email, switch apps, wait for delivery, check spam, tap through. The
// first version allowed 15 minutes measured from the ORIGINAL tap and never
// refreshed it at the wall, which is inside the time a slow inbox takes — and
// running out looks exactly like success (see the note on RESUME below for why
// that is the dangerous part). Short enough that a forgotten code does not
// linger for days.
const ROOM_INVITE_TTL_MS = 60 * 60 * 1000;

// A RESUME is a different lifetime question and needs the ROOM's answer, not
// the inbox's: rooms live 6 hours (supabase/migrations/0001_plan_rooms.sql).
//
// 🧨 A resume TTL shorter than the room means a live room silently FORKS. Leave
// the tab open past the TTL — or let iOS discard and reload a backgrounded tab,
// which is routine — and the reload reads nothing, calls createRoom(), and
// makes the user host of a new empty room while their friends are still in the
// old one. No error is shown, because from the app's point of view nothing
// failed. Matching the room's own lifetime removes the window entirely; the
// server still refuses an expired room, so this cannot outlive its usefulness.
const ROOM_RESUME_TTL_MS = 6 * 60 * 60 * 1000;

// Mirrors the shape check in lib/room-code.ts. Duplicated on purpose: the
// pre-paint inline script in app/layout.tsx cannot import anything, so this
// module and that script have to agree independently. Real validation is
// server-side in lib/room-action.ts; this only rejects obvious junk.
const ROOM_CODE_RE = /^[A-Z0-9]{6}$/;

// `s` is WHY the code is here, and the two reasons must not be conflated:
//
//   "i" INVITE — it came out of a `?room=` URL somebody sent this person. It is
//       the whole point of the stash, and it is honoured unconditionally: the
//       user asked to be in that room by opening the link.
//
//   "r" RESUME — we put it here ourselves after a successful create or join, so
//       that RELOADING does not dump the user into a different room. It is
//       honoured only on a reload / back-forward (see isResumeNavigation).
//
// 🧨 CONFLATING THEM WAS A REAL REGRESSION, caught in review before merge. With
// one undifferentiated entry, finishing a room and then tapping "Start a
// session ->" from /plan read the stash back and returned the user to the room
// they had just left, with the old roster, for as long as the TTL lasted. There
// was no way out: "End this room" is host-only, and going back and tapping
// again just re-entered it. Before this file existed the same journey created a
// new room, because the resolver read `?room=` from the URL and a fresh
// /plan/together has no query string.
type Stashed = { c: string; t: number; s?: "i" | "r" };

/**
 * Did this DOCUMENT arrive by reload or back/forward, rather than by someone
 * deliberately navigating here?
 *
 * This is the discriminator that makes a RESUME entry safe. A Next.js client
 * navigation (tapping "Start a session ->") does not create a new document, so
 * the type stays whatever the original load was — "navigate" — and the resume
 * is correctly refused. A genuine reload reports "reload" and the user gets
 * their room back.
 *
 * Known residual: reload some other page, then client-navigate to
 * /plan/together within that same document, and the type is still "reload", so
 * a stale resume entry would be honoured. It costs one wrong lobby in a narrow
 * window and is bounded by the TTL. Closing it properly means tracking room
 * membership server-side rather than in this browser, which is a different and
 * much larger change than taking a credential out of a URL.
 */
function isResumeNavigation(): boolean {
  try {
    const [nav] = performance.getEntriesByType(
      "navigation",
    ) as PerformanceNavigationTiming[];
    return nav?.type === "reload" || nav?.type === "back_forward";
  } catch {
    // No Performance API, or a browser that reports nothing. Fail CLOSED: a
    // refused resume costs a new empty room, an over-eager one silently puts
    // somebody in a room they did not ask for.
    return false;
  }
}

declare global {
  interface Window {
    /** Written by the pre-paint script in app/layout.tsx. */
    __FL_ROOM_INVITE?: Stashed;
  }
}

/** Structurally sound and not expired. Says nothing about whether to use it. */
function fresh(v: unknown): Stashed | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Partial<Stashed>;
  if (typeof s.c !== "string" || !ROOM_CODE_RE.test(s.c)) return null;
  const kind = s.s === "i" ? "i" : "r";
  const ttl = kind === "i" ? ROOM_INVITE_TTL_MS : ROOM_RESUME_TTL_MS;
  if (typeof s.t !== "number" || Date.now() - s.t > ttl) return null;
  return { c: s.c, t: s.t, s: kind };
}

/**
 * Should this entry be acted on RIGHT NOW?
 *
 * Kept separate from `fresh` because the two failures need opposite handling: a
 * stale entry should be deleted, whereas a resume entry refused on this
 * navigation is perfectly good and must survive for the reload it exists for.
 * Collapsing them deleted the entry on the first client navigation, so the next
 * genuine reload had nothing to resume.
 *
 * An entry with no `s` predates the field: read as a resume, the conservative
 * side, so a code stashed by the previous deploy cannot hijack a fresh start.
 */
function honour(s: Stashed): boolean {
  return s.s === "i" || isResumeNavigation();
}

/**
 * The room code this browser should join, or null to start a new room.
 *
 * NOT one-shot: see the note at the top. The window global wins because the
 * pre-paint script always sets it and storage may be unavailable.
 */
export function readRoomInvite(): string | null {
  if (typeof window === "undefined") return null;
  // 🧨 ONCE PER DOCUMENT. Not one-shot across reloads — a reload is a new
  // document and must still rejoin — but a code may only be handed out once
  // within the life of one document. Two review findings both reduce to this:
  //
  //   • an INVITE was never consumed, so after a failed retry the entry stayed
  //     "i" and was honoured unconditionally on any later client navigation:
  //     tapping "Start a session ->" ten minutes later dropped the user back
  //     into the abandoned room, with no way out;
  //   • isResumeNavigation() is a DOCUMENT-level fact, so one pull-to-refresh
  //     on /plan/together licensed every later client navigation in that
  //     document to resume the same finished room.
  //
  // Module state dies with the document, which is exactly the lifetime wanted.
  if (handedOutThisDocument) return null;
  const code = readStash();
  if (code) handedOutThisDocument = true;
  return code;
}

let handedOutThisDocument = false;

function readStash(): string | null {
  const inMemory = fresh(window.__FL_ROOM_INVITE);
  if (inMemory) return honour(inMemory) ? inMemory.c : null;
  try {
    const raw = window.localStorage.getItem(ROOM_INVITE_KEY);
    if (!raw) return null;
    const stashed = fresh(JSON.parse(raw));
    if (!stashed) {
      // Expired or malformed: remove it rather than re-parse it every load.
      window.localStorage.removeItem(ROOM_INVITE_KEY);
      return null;
    }
    return honour(stashed) ? stashed.c : null;
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
 *
 * Written as a RESUME, never an invite: nobody sent this person here, so it may
 * only take effect on a reload. See the `Stashed` note for the regression that
 * distinction exists to prevent.
 */
export function armRoomInvite(
  code: string,
  // "invite" is for a deliberate act that then NAVIGATES rather than reloads —
  // the retry button on a transient failure screen. Without it the resolver
  // would refuse the resume it had just written and drop the user into a new
  // empty room, which is the exact failure the retry exists to undo.
  kind: "invite" | "resume" = "resume",
): void {
  if (typeof window === "undefined") return;
  const c = code.trim().toUpperCase();
  if (!ROOM_CODE_RE.test(c)) return;
  const v: Stashed = { c, t: Date.now(), s: kind === "invite" ? "i" : "r" };
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
  // Forgetting the room includes forgetting that one was handed out, so a code
  // armed after this point is still usable in this document. Deliberately NOT
  // done by armRoomInvite: arming happens right after a successful join, and
  // resetting there would re-license the finished-room resume that the
  // once-per-document rule exists to stop.
  handedOutThisDocument = false;
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
 *   • it STRIPS on every route but only STASHES on /plan/together. The strip
 *     used to be guarded on the pathname too, which left a real channel open:
 *     posthog freezes `location.href` into `$initial_person_info` on the first
 *     pageview of a browser and then posts it as `$initial_current_url` on
 *     every /flags request forever, and /flags does not go through the capture
 *     path, so no sanitize hook can reach it. A `?room=` on ANY path was
 *     therefore permanent. Stashing stays scoped, because a code arriving on
 *     /explore is not a request to join anything and must not arm an invite;
 *   • the first thing it does is look for `room`, so it is a few microseconds
 *     and no DOM access on every other page load, including the ISR-cached
 *     /anon twins;
 *   • everything in try/catch: it must never be able to break first paint;
 *   • `replaceState` runs BEFORE the shape test, so even a malformed code is
 *     stripped from the URL rather than left sitting there;
 *   • it replaces the current history entry rather than pushing, so the back
 *     button is unaffected.
 */
export const ROOM_INVITE_INLINE_SCRIPT = `(function(){try{
var q=new URLSearchParams(location.search),r=q.get("room");
if(!r&&location.hash)r=new URLSearchParams(location.hash.slice(1)).get("room");
if(!r)return;
q.delete("room");var s=q.toString();
history.replaceState(null,"",location.pathname+(s?"?"+s:""));
if(location.pathname!=="/plan/together")return;
var c=r.trim().toUpperCase();
if(!/^[A-Z0-9]{6}$/.test(c))return;
var v={c:c,t:Date.now(),s:"i"};window.__FL_ROOM_INVITE=v;
try{localStorage.setItem("${ROOM_INVITE_KEY}",JSON.stringify(v))}catch(e){}
}catch(e){}})();`;
