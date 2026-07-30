// Browser-storage carriers for analytics attribution. ZERO imports on purpose.
//
// WHY A SEPARATE FILE: `app/(main)/plan/anon-plan-flow.tsx` is pinned by
// lib/__tests__/plan-preview-guard.test.ts, which asserts it never imports the
// Supabase browser client, `lib/signals`, or `lib/queries`. Anything the anon
// flow needs must therefore be reachable without dragging a data path in.
// This module is plain literals plus `window.sessionStorage` /
// `window.localStorage`, so it is safe from any surface.
//
// WHY STORAGE AND NOT THE URL: two of these values (the sign-in trigger, the
// plan handoff) have to survive a navigation, and the obvious carrier is a
// query string. Both would be wrong:
//   • `lib/safe-redirect.ts` lets any site-internal path through /auth/callback
//     INCLUDING its query string, so a query-string trigger is attacker
//     controllable, and PostHog attaches $current_url to every event;
//   • adding `searchParams` / `useSearchParams()` to the venue route would opt
//     it out of static rendering and kill the /anon/venue/[slug] ISR cache.
//
// Every read is ONE-SHOT (removeItem BEFORE the value is used) and TTL-bounded,
// so a stale value cannot be misattributed to an unrelated later action. Every
// access is wrapped: Safari private mode throws on storage access.

// ── Controlled vocabularies ─────────────────────────────────────────────

// Where the visitor was when they did the thing. The first eight mirror
// `SignalSurface` in lib/signals.ts (which is itself mirrored by a DB CHECK
// constraint), so an analytics funnel can be joined against `user_events`.
// "event" and "direct" are analytics-only additions: the event detail page has
// no SignalSurface today, and "direct" is the honest value for a visitor whose
// entry we never observed. Extending here does NOT change the DB vocabulary.
export type EntrySurface =
  | "explore"
  | "feed"
  | "plan"
  | "friends"
  | "venue"
  | "saved"
  | "onboarding"
  | "search_results"
  | "event"
  | "direct";

const ENTRY_SURFACES: readonly EntrySurface[] = [
  "explore",
  "feed",
  "plan",
  "friends",
  "venue",
  "saved",
  "onboarding",
  "search_results",
  "event",
  "direct",
];

// Which door the visitor came through to sign in. Allow-listed because the
// value crosses a navigation, and an un-validated value that crosses a
// navigation is an injection surface, not a metric.
export type SignInTrigger =
  | "venue_teaser_readmore"
  | "venue_reviews_locked"
  | "venue_booking_cta"
  | "event_ticket_cta"
  | "plan_save"
  | "plan_rate_limited"
  | "saved_screen"
  | "explore_wall"
  | "events_wall"
  | "together"
  | "profile"
  | "unknown";

const SIGN_IN_TRIGGERS: readonly SignInTrigger[] = [
  "venue_teaser_readmore",
  "venue_reviews_locked",
  "venue_booking_cta",
  "event_ticket_cta",
  "plan_save",
  "plan_rate_limited",
  "saved_screen",
  "explore_wall",
  "events_wall",
  "together",
  "profile",
  "unknown",
];

export function isEntrySurface(v: unknown): v is EntrySurface {
  return typeof v === "string" && (ENTRY_SURFACES as string[]).includes(v);
}

export function isSignInTrigger(v: unknown): v is SignInTrigger {
  return typeof v === "string" && (SIGN_IN_TRIGGERS as string[]).includes(v);
}

// ── Storage keys ────────────────────────────────────────────────────────

// sessionStorage: per-TAB, dies with the tab. Correct for "where did this
// visitor enter from", and it means a shared browser cannot carry one person's
// entry surface into another person's session.
export const ENTRY_SURFACE_KEY = "fl.entry.v1";

// sessionStorage: plan -> venue is a same-tab client navigation, no auth round
// trip, so the narrower store is the right one.
export const PLAN_HANDOFF_KEY = "fl.planjump.v1";

// localStorage: a magic link can open in a NEW TAB, which would destroy a
// sessionStorage value. Deliberately short-lived instead (see TTL below).
export const SIGNIN_TRIGGER_KEY = "fl.signintrigger.v1";

const PLAN_HANDOFF_TTL_MS = 5 * 60 * 1000; // 5 min: a tap, then a page read.
const SIGNIN_TRIGGER_TTL_MS = 15 * 60 * 1000; // 15 min: covers a magic-link
// round trip through an email client without letting a forgotten value
// misattribute a sign-in the next day.

function session(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function local(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

// ── entry_surface ───────────────────────────────────────────────────────

/**
 * Record where the visitor was when they moved deeper into the app. Called on
 * navigation clicks (a feed card, a search result, a plan stop), NOT on mount:
 * a mount-time write would relabel the surface on every back-navigation.
 */
export function writeEntrySurface(surface: EntrySurface): void {
  const s = session();
  if (!s) return;
  try {
    s.setItem(ENTRY_SURFACE_KEY, surface);
  } catch {
    // Quota or private mode. Analytics must never break navigation.
  }
}

/**
 * Read the current entry surface. NOT one-shot: it describes the tab until
 * something overwrites it, and several events on the destination page want it.
 * Falls back to "direct" so the property is always present and the "we did not
 * observe an entry" population is measurable instead of missing.
 */
export function readEntrySurface(): EntrySurface {
  const s = session();
  if (!s) return "direct";
  try {
    const raw = s.getItem(ENTRY_SURFACE_KEY);
    return isEntrySurface(raw) ? raw : "direct";
  } catch {
    return "direct";
  }
}

// ── plan -> venue handoff (booking attribution) ─────────────────────────

export type PlanHandoff = { slug: string; stopIndex: 0 | 1 | 2 };

/**
 * Remember that the visitor opened this venue FROM a plan stop, so a booking
 * click on the venue page can be attributed to the plan without putting
 * anything in the URL.
 *
 * Stores the slug (already public, it is the URL path) and the 0-based stop
 * index. Nothing else: no plan title, no venue id, no route, no coordinates.
 */
export function writePlanHandoff(slug: string, stopIndex: number): void {
  const s = session();
  if (!s) return;
  if (stopIndex !== 0 && stopIndex !== 1 && stopIndex !== 2) return;
  try {
    s.setItem(
      PLAN_HANDOFF_KEY,
      JSON.stringify({ slug, stopIndex, at: Date.now() }),
    );
  } catch {
    // ignore
  }
}

/**
 * One-shot read, scoped to the venue that is asking. Removes the value BEFORE
 * validating it, so a mismatched or expired handoff can never be replayed onto
 * a later, unrelated venue page.
 */
export function readPlanHandoff(slug: string): PlanHandoff | null {
  const s = session();
  if (!s) return null;
  let raw: string | null = null;
  try {
    raw = s.getItem(PLAN_HANDOFF_KEY);
    if (raw !== null) s.removeItem(PLAN_HANDOFF_KEY); // one-shot, always
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as {
      slug?: unknown;
      stopIndex?: unknown;
      at?: unknown;
    };
    if (v.slug !== slug) return null;
    if (typeof v.at !== "number" || Date.now() - v.at > PLAN_HANDOFF_TTL_MS) {
      return null;
    }
    if (v.stopIndex !== 0 && v.stopIndex !== 1 && v.stopIndex !== 2) return null;
    return { slug, stopIndex: v.stopIndex };
  } catch {
    return null;
  }
}

// ── sign-in trigger ─────────────────────────────────────────────────────

/**
 * Arm the trigger just before sending the visitor to sign in. Set on the CTA's
 * own click handler, so the value describes the door they actually used.
 */
export function writeSignInTrigger(trigger: SignInTrigger): void {
  const l = local();
  if (!l) return;
  try {
    l.setItem(SIGNIN_TRIGGER_KEY, JSON.stringify({ trigger, at: Date.now() }));
  } catch {
    // ignore
  }
}

/**
 * One-shot read for the sign-in-complete event. Removes BEFORE validating: the
 * failure paths in /auth/callback arm this value and never consume it, so
 * without a hard one-shot a failed OAuth attempt would attribute the visitor's
 * NEXT successful sign-in, days later, to the wrong door.
 *
 * Returns "unknown" rather than null, so the event always carries the property
 * and carrier loss (a magic link opened on a different device) is measurable.
 */
export function consumeSignInTrigger(): SignInTrigger {
  const l = local();
  if (!l) return "unknown";
  let raw: string | null = null;
  try {
    raw = l.getItem(SIGNIN_TRIGGER_KEY);
    if (raw !== null) l.removeItem(SIGNIN_TRIGGER_KEY); // one-shot, always
  } catch {
    return "unknown";
  }
  if (!raw) return "unknown";
  try {
    const v = JSON.parse(raw) as { trigger?: unknown; at?: unknown };
    if (
      typeof v.at !== "number" ||
      Date.now() - v.at > SIGNIN_TRIGGER_TTL_MS
    ) {
      return "unknown";
    }
    return isSignInTrigger(v.trigger) ? v.trigger : "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Drop the armed trigger. Called from sign-out, so a trigger armed and never
 * consumed cannot survive into the next account on this browser.
 */
export function clearSignInTrigger(): void {
  const l = local();
  if (!l) return;
  try {
    l.removeItem(SIGNIN_TRIGGER_KEY);
  } catch {
    // ignore
  }
}
