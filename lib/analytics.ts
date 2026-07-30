// Lightweight, privacy-respecting product analytics.
//
// One typed `track()` call fans out to BOTH providers we run:
//   • Vercel Analytics  — cookieless, already mounted; kept for continuity;
//   • PostHog (EU)      — product analytics, funnels, and autocapture.
//
// PostHog is initialised lazily from components/analytics-gate.tsx, and ONLY
// when the visitor hasn't declined in the cookie banner. We keep PostHog
// cookieless (localStorage persistence) with session recording OFF, so it
// matches the banner's "cookieless analytics" promise and our UK PECR posture.
//
// Why a wrapper and not posthog.capture() everywhere:
//   • one place to enforce the consent gate and the event allowlist;
//   • one place to add/swap a provider later;
//   • safe no-op on the server, before init, and when no key is configured.
//
// Usage:  import { track } from "@/lib/analytics";
//         track("venue_reserve_click", { venue: "padella", platform: "opentable" });

import { track as vercelTrack } from "@vercel/analytics";
import posthog from "posthog-js";
import { readEntrySurface } from "@/lib/analytics-keys";

export type {
  EntrySurface,
  SignInTrigger,
  PlanHandoff,
} from "@/lib/analytics-keys";

// ── Controlled vocabularies ─────────────────────────────────────────────
//
// Every non-numeric property added by this layer comes from a closed union.
// Two reasons, and neither is tidiness:
//   1. a free-form string property is how PII escapes — an exception message,
//      a search term, a display name, a room code all arrive as "just a
//      string";
//   2. an open-ended value makes a dashboard breakdown unusable within weeks.
// If a value is not in one of these lists it does not get sent.

export type AuthState = "anon" | "signed_in";

// Aligned to the app's own breakpoints (Tailwind sm=640, lg=1024), so a split
// by viewport_bucket answers "does the desktop layout convert differently".
export type ViewportBucket = "mobile" | "tablet" | "desktop";

export type PlanSurface = "solo" | "anon" | "group";

// Why a generation attempt produced nothing usable. Deliberately COARSE
// categories, never a raw exception string.
//
// Reachability, measured rather than assumed (do not "fix" a flat line here):
//   • no_result     — reachable on both surfaces (engine filled zero stops).
//   • rate_limited  — anon only, from the preview cap.
//   • invalid_input / server — anon only, from the server action's own reasons.
//   • network       — anon only, and only when navigator.onLine is false.
//   • timeout       — UNREACHABLE today: there is no AbortController and no
//                     fetch timeout anywhere in the plan path. Shipped so the
//                     category exists the day one is added. Expect zero.
//   • unknown       — the honest bucket, never a dumping ground for a message.
export type PlanFailReason =
  | "no_result"
  | "invalid_input"
  | "rate_limited"
  | "network"
  | "server"
  | "timeout"
  | "unknown";

// Why persisting a plan failed. Mapped from the PostgREST error CODE and the
// HTTP status only. The raw message, `details` and `hint` are NEVER sent:
// on the network path postgrest-js puts a full stack trace in `details`, and
// on the DB path those fields can echo row values.
export type SaveFailReason =
  | "rls_denied"
  | "auth_expired"
  | "schema_mismatch"
  | "constraint"
  | "rate_limited"
  | "network"
  | "server"
  | "unknown";

// What kind of save this was. Note what is ABSENT and why, so nobody reads a
// structural zero as a tracking bug:
//   • no "update"        — the plans write is insert-only and there is no
//                          UPDATE policy on the table.
//   • no "restored_anon" — the Save button is unmounted in exactly the state a
//                          restored anon stash creates, so the value could
//                          never be produced. The `anon_origin` boolean on the
//                          same events carries that information instead.
export type SaveMode =
  "new" | "duplicate" | "resave_after_swap" | "resave_after_reshuffle";

// How a stop was replaced. "group_veto" is the honest third value: on the
// group surface the deciding vote can arrive over Realtime from another
// device, so neither "swipe" nor "button" describes it.
export type SwapMethod = "swipe" | "button" | "group_veto";

export type StopRole = "Start" | "Then" | "Finish";

export type NearYouResult = "granted" | "denied" | "unavailable" | "error";

// Where a card sat in the feed, bucketed. A raw index is a fingerprinting
// nudge and a useless breakdown; buckets align to FEED_PAGE_SIZE = 24.
export type PositionBucket = "0-4" | "5-11" | "12-23" | "24+";

export type CardType = "venue" | "event";

const VIEWPORT_TABLET_MIN = 640;
const VIEWPORT_DESKTOP_MIN = 1024;

export function viewportBucket(width: number): ViewportBucket {
  // Non-finite or nonsensical widths bucket as mobile: it is the majority
  // case and the safest default for a metric nobody should act on blindly.
  if (!Number.isFinite(width) || width <= 0) return "mobile";
  if (width < VIEWPORT_TABLET_MIN) return "mobile";
  if (width < VIEWPORT_DESKTOP_MIN) return "tablet";
  return "desktop";
}

export function positionBucket(
  position: number | null | undefined,
): PositionBucket {
  if (typeof position !== "number" || !Number.isFinite(position)) return "0-4";
  if (position < 5) return "0-4";
  if (position < 12) return "5-11";
  if (position < 24) return "12-23";
  return "24+";
}

// The full funnel. Keeping this as a union (not free-form strings) means a
// typo'd event name is a compile error, and the set of things we measure is
// self-documenting in one place.
export type AnalyticsEvent =
  | "venue_save"
  | "venue_unsave"
  | "venue_reserve_click" // outbound click to a booking platform (revenue signal)
  | "event_ticket_click" // outbound click to a ticket provider
  | "booking_self_logged" // user self-reported a booking on "Did you book?"
  | "plan_setup_started" // first meaningful setup selection (fires once)
  | "plan_generate" // solo Plan My Night generated an itinerary
  | "plan_generate_failed" // signed-in generation produced nothing usable
  | "plan_preview_failed" // anon generation produced nothing usable
  | "plan_reshuffle"
  // DEPRECATED, dual-emitted alongside plan_save_succeeded until 2026-09-30.
  // Every existing PostHog insight and Vercel series keys on this name, so it
  // cannot be renamed in place. New dashboards must use plan_save_succeeded
  // and must NOT count both, or every save is double-counted.
  | "plan_save" // user saved a generated plan to their account (funnel end)
  // The save split. "tapped" is intent, "succeeded" fires only after the
  // insert comes back clean, "failed" only after a real failed write.
  | "plan_save_tapped"
  | "plan_save_succeeded"
  | "plan_save_failed"
  | "plan_open_maps" // opened the plan's walking route in Google Maps
  | "plan_swap" // swapped a single stop for an alternative
  | "together_room_create"
  | "together_room_join"
  | "together_swipe"
  | "share" // Web Share / clipboard from any surface
  | "search_query"
  | "sign_in_complete"
  // Anon-first plan gate (2026-07-27). plan_preview_built is THE number the
  // anon /plan ships to move; detail_wall_dismissed + plan_stop_opened arm
  // the deferred detail-wall-on-arrival decision with data instead of
  // opinion (ux gate condition 5).
  | "plan_preview_built"
  | "plan_stop_opened"
  | "plan_stash_restored"
  | "detail_wall_dismissed"
  // Explore instrumentation (2026-07-29). None of these carry a search term,
  // a venue identifier, a coordinate or a distance.
  | "explore_filter_applied"
  | "card_dismissed"
  | "feed_end_reached" // fires ONCE per feed session, not per observer entry
  | "near_you_result"
  // Group-room security operations, from PR #187 (merged 2026-07-30). Kept
  // VERBATIM through the rebase: payloads carry ONLY a one-way hashed room
  // reference (lib/room-code.ts) — never a raw room code, display name, taste
  // map, venue choice or coordinate. This branch deliberately did not define
  // these three while #187 was open, precisely so this hunk would resolve by
  // taking both sides rather than by choosing one.
  | "together_join_denied"
  | "together_room_expired"
  | "together_host_handoff";

type Props = Record<string, string | number | boolean | null | undefined>;

// Consent gate. Defaults to allowing analytics (cookieless) UNLESS the user
// has explicitly opted out. Kept in localStorage by the consent banner.
const CONSENT_KEY = "fl.consent.v1"; // "granted" | "denied"

// Set once PostHog has been initialised. Keeps track()/consent toggles as
// no-ops until then — e.g. before the gate mounts, or when no key is configured.
let posthogReady = false;

function analyticsAllowed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(CONSENT_KEY) !== "denied";
  } catch {
    return true;
  }
}

// ── Common properties ───────────────────────────────────────────────────
//
// Three properties every event should carry, so any dashboard can be split by
// them without each call site remembering to pass them.
//
// 🧨 DERIVED PER EVENT, NEVER POSTHOG SUPER-PROPERTIES. `posthog.register()`
// looked like the obvious implementation and is the wrong one: persistence is
// localStorage (see initAnalytics), super-properties are cleared only by
// posthog.reset(), and on a SHARED BROWSER that means auth_state:"signed_in"
// would be stamped onto the next person's anonymous session. Deriving costs
// three cheap reads per event and cannot leak across identities. It also keeps
// the Vercel leg identical to the PostHog leg, which register() would not.
//
// The auth state is held in a module variable rather than read from Supabase,
// because track() is synchronous and must never do IO. It is a COARSE ENUM.
// The user's uuid is never stored here and never sent as a property; PostHog
// learns the identity only through identifyUser().
let analyticsAuthState: AuthState = "anon";

/**
 * Reflect the signed-in state into the analytics layer. Called from
 * AuthUserProvider on every auth transition. Takes the enum, never the uuid.
 */
export function setAnalyticsAuthState(state: AuthState): void {
  analyticsAuthState = state;
}

function commonProps(): Props {
  if (typeof window === "undefined") return {};
  let width = 0;
  try {
    width = window.innerWidth;
  } catch {
    width = 0;
  }
  return {
    auth_state: analyticsAuthState,
    // Read per event, never cached at init: a rotation or a resized desktop
    // window changes the answer, and a stale bucket is worse than none.
    viewport_bucket: viewportBucket(width),
    entry_surface: readEntrySurface(),
  };
}

// ── Property sanitizer ──────────────────────────────────────────────────
//
// The same coarse-only guard lib/signals.ts already applies to `user_events`,
// applied here too. It was a real asymmetry: recordSignal() dropped
// identifying keys and clamped long strings, and track() stripped only
// `undefined`, so the PATH THAT LEAVES THE COUNTRY was the unguarded one.
//
// This is a backstop, not a licence. Call sites must still pass coarse values;
// the guard exists so that one careless spread cannot ship a coordinate, an
// email, a token or a display name to two third parties.
// Verbatim from lib/signals.ts so the two sinks agree, plus password/secret.
const BLOCKED_KEY =
  /(^|_)(lat|lng|lon|long|coord|coords|geo|geohash|email|phone|name|address|postcode|ip|token|device|user|session|password|secret)(_|$)/i;

// Bearer-shaped names, matched WHOLE. A Plan Together room code is a bearer
// credential: possessing it is authorisation to join. It must never be a
// property, and neither must a hash of it (the code is 4 characters, so any
// hash is a rainbow table).
//
// `room_id` is deliberately NOT blocked. It is the opaque row uuid used by the
// group-security work's own events, carries no join capability, and blocking it
// here would silently strip the only correlation property those events have.
const BLOCKED_EXACT =
  /^(room_?code|invite_?code|join_?code|share_?link|room_?link|code)$/i;

const MAX_STRING_LEN = 120;

function sanitizeProps(
  event: string,
  props?: Props,
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  if (!props) return out;
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined) continue; // keep payloads clean
    if (BLOCKED_KEY.test(k) || BLOCKED_EXACT.test(k)) {
      // A dropped property is a bug at the call site, not a routine event.
      // Say so in development rather than shipping a silently thinner payload
      // that looks fine on a dashboard and is missing a dimension.
      if (process.env.NODE_ENV !== "production") {
        console.warn(
          `[analytics] dropped disallowed property "${k}" from "${event}". ` +
            "Send a coarse, non-identifying value instead.",
        );
      }
      continue;
    }
    out[k] =
      typeof v === "string" && v.length > MAX_STRING_LEN
        ? v.slice(0, MAX_STRING_LEN)
        : v;
  }
  return out;
}

// Identify can be requested before PostHog finishes initialising (the
// SignInTracker mounts alongside the AnalyticsGate). Park the id and apply it
// in init's `loaded` callback so the identity is never dropped to a race.
let pendingIdentify: string | null = null;

/**
 * Remove `room=` from any URL-shaped analytics property.
 *
 * Applies to $current_url, $referrer, $pathname and anything else carrying a
 * query string. Replaced with a placeholder rather than dropped so funnels on
 * /plan/together still work.
 */
function stripRoomCodes(
  props: Record<string, unknown>,
  _event: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...props };
  for (const [k, v] of Object.entries(out)) {
    if (typeof v === "string" && v.includes("room=")) {
      out[k] = v.replace(/([?&]room=)[^&#]*/gi, "$1redacted");
    }
  }
  return out;
}

// 🧨 The same race, for EVENTS, which was NOT handled and silently dropped
// them. `pendingIdentify` above proves the race was known for identify(): a
// component can call into this module before AnalyticsGate has run its effect
// and initialised PostHog. Until now track() simply skipped posthog.capture()
// in that window, so `sign_in_complete` — fired by SignInTracker, which mounts
// as a sibling of AnalyticsGate — reached Vercel and never reached PostHog at
// all. A property added to a dropped event is wasted work, so the queue comes
// first.
//
// Bounded at 20: this window is milliseconds long, so anything past 20 events
// means a loop, and an unbounded array in that case is a memory leak. Consent
// is re-checked at FLUSH time, not just at enqueue time, so a visitor who
// declines during the window has their queued events discarded.
const MAX_PENDING_EVENTS = 20;
let pendingEvents: { event: AnalyticsEvent; props: Record<string, unknown> }[] =
  [];

function flushPendingEvents(): void {
  const queued = pendingEvents;
  pendingEvents = [];
  if (!analyticsAllowed()) return; // declined mid-window: drop, do not send
  for (const q of queued) {
    try {
      posthog.capture(q.event, q.props);
    } catch {
      // Never let analytics throw into product code.
    }
  }
}

// Called by the consent-gated AnalyticsGate. Safe to call repeatedly: inits at
// most once, and no-ops when there's no key configured yet (so the app runs
// fine before the PostHog project key is added to the env).
export function initAnalytics(): void {
  if (posthogReady || typeof window === "undefined") return;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return;
  posthog.init(key, {
    api_host:
      process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com",
    person_profiles: "identified_only", // no anon person profiles → cheaper, less PII
    persistence: "localStorage", // cookieless — matches the consent-banner copy
    capture_pageview: true, // "app open" / page views
    autocapture: true, // broad capture: clicks, inputs, etc.
    disable_session_recording: true, // explicit: no screen recordings
    // 🧨 A Plan Together room code is a BEARER SECRET and it lives in the URL
    // (/plan/together?room=CODE). PostHog attaches $current_url (and referrer /
    // pathname) to EVERY captured event, including autocaptured clicks — so
    // without this hook a code lifted from the analytics feed would be a
    // working key to a live room, defeating the membership check. Strip it
    // from every URL-bearing property before anything leaves the browser.
    sanitize_properties: stripRoomCodes,
    loaded: (ph) => {
      if (!analyticsAllowed()) {
        ph.opt_out_capturing();
        pendingEvents = []; // declined: never send what was queued
        return;
      }
      if (pendingIdentify) {
        try {
          ph.identify(pendingIdentify);
        } catch {
          // Never let analytics throw into product code.
        }
      }
      // Identify FIRST, then flush, so queued events land on the identified
      // person rather than an anonymous distinct_id that has to be merged.
      flushPendingEvents();
    },
  });
  posthogReady = true;
}

// Tie this browser's events to the signed-in user. With person_profiles:
// "identified_only", PostHog creates NO person until identify() is called:
// before this existed, 100% of events were anonymous distinct-ids that never
// merged into a user, so retention and per-user funnels were unmeasurable.
// The id is the Supabase UUID (opaque, no email/PII). Idempotent: PostHog
// treats a repeat identify(sameId) as a no-op.
export function identifyUser(userId: string): void {
  if (!userId || typeof window === "undefined" || !analyticsAllowed()) return;
  if (!posthogReady) {
    pendingIdentify = userId; // applied by init's `loaded` callback
    return;
  }
  try {
    posthog.identify(userId);
  } catch {
    // Never let analytics throw into product code.
  }
}

// Drop the person identity + device state on sign-out, so the next account on
// this browser doesn't inherit the previous person profile.
export function resetAnalyticsIdentity(): void {
  pendingIdentify = null;
  pendingEvents = []; // never replay the previous account's queued events
  analyticsAuthState = "anon"; // the next event on this browser is anonymous
  if (!posthogReady) return;
  try {
    posthog.reset();
  } catch {
    // ditto
  }
}

// Reflects a consent change (from the banner) into PostHog without a reload.
export function setAnalyticsConsent(allowed: boolean): void {
  if (allowed) initAnalytics();
  if (!posthogReady) return;
  if (allowed) posthog.opt_in_capturing();
  else posthog.opt_out_capturing();
}

export function track(event: AnalyticsEvent, props?: Props): void {
  if (!analyticsAllowed()) return;
  // Common properties first so an explicit call-site value always wins, then
  // the sanitizer: drops `undefined`, drops identifying / bearer-shaped keys,
  // clamps long strings. Both providers get the IDENTICAL payload behind this
  // one consent gate.
  const clean = {
    ...commonProps(),
    ...sanitizeProps(event, props),
  } as Record<string, string | number | boolean | null>;
  try {
    vercelTrack(event, clean);
  } catch {
    // Never let analytics throw into product code.
  }
  try {
    if (posthogReady) posthog.capture(event, clean);
    else if (pendingEvents.length < MAX_PENDING_EVENTS) {
      // PostHog has not finished initialising. Queue rather than drop; the
      // `loaded` callback flushes (and re-checks consent) a few ms from now.
      pendingEvents.push({ event, props: clean });
    }
  } catch {
    // ditto
  }
}

// Where an error boundary fired. A closed union for the same reason
// AnalyticsEvent is one: a typo becomes a compile error, and the set of places
// we can break is legible in one spot.
export type ErrorSurface =
  | "global" // app/global-error.tsx — the root layout itself threw
  | "main-shell" // explore / events / saved / plan / profile
  | "venue" // /venue/[slug] (and its /anon ISR twin, which re-exports it)
  | "event" // /event/[id] (ditto)
  | "booking" // /booking/[slug]
  | "component"; // the <ErrorBoundary> class, wrapping a subtree

// Report a caught error to PostHog.
//
// WHY: every boundary in this app catches, renders a friendly fallback, and
// then console.errors into a browser nobody is watching. Vercel only sees
// SERVER function errors, so client-side crashes — most of what actually
// breaks in a Next app — were completely invisible.
//
// Same guarantees as track(): no-ops on the server, before PostHog inits, with
// no key configured, and when the visitor declined in the consent banner.
// Because consent-gated, coverage is partial by design: enough to learn THAT
// something breaks and where, not a complete incident log.
export function reportError(
  error: unknown,
  surface: ErrorSurface,
  extra?: Props,
): void {
  if (!analyticsAllowed() || !posthogReady) return;
  try {
    const err = error instanceof Error ? error : new Error(String(error));
    // Next puts a `digest` on server-thrown errors; it is the only handle that
    // ties a client-side report back to the server log line.
    const digest = (error as { digest?: unknown } | null)?.digest;
    posthog.captureException(err, {
      ...commonProps(),
      surface,
      ...(typeof digest === "string" ? { digest } : {}),
      ...extra,
    });
  } catch {
    // Never let analytics throw into product code — least of all here. This
    // runs INSIDE an error boundary, so throwing again would replace the
    // fallback UI with a hard crash: the one place a reporting bug could make
    // things strictly worse than no reporting at all.
  }
}
