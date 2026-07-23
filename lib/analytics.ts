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

// The full funnel. Keeping this as a union (not free-form strings) means a
// typo'd event name is a compile error, and the set of things we measure is
// self-documenting in one place.
export type AnalyticsEvent =
  | "venue_save"
  | "venue_unsave"
  | "venue_reserve_click" // outbound click to a booking platform (revenue signal)
  | "event_ticket_click" // outbound click to a ticket provider
  | "booking_self_logged" // user self-reported a booking on "Did you book?"
  | "plan_generate" // solo Plan My Night generated an itinerary
  | "plan_reshuffle"
  | "plan_save" // user saved a generated plan to their account (funnel end)
  | "plan_open_maps" // opened the plan's walking route in Google Maps
  | "plan_swap" // swapped a single stop for an alternative
  | "together_room_create"
  | "together_room_join"
  | "together_swipe"
  | "share" // Web Share / clipboard from any surface
  | "search_query"
  | "sign_in_complete";

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

// Identify can be requested before PostHog finishes initialising (the
// SignInTracker mounts alongside the AnalyticsGate). Park the id and apply it
// in init's `loaded` callback so the identity is never dropped to a race.
let pendingIdentify: string | null = null;

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
    loaded: (ph) => {
      if (!analyticsAllowed()) ph.opt_out_capturing();
      else if (pendingIdentify) {
        try {
          ph.identify(pendingIdentify);
        } catch {
          // Never let analytics throw into product code.
        }
      }
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
  // Strip undefined to keep payloads clean; both providers take a flat object.
  const clean: Record<string, string | number | boolean | null> = {};
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v !== undefined) clean[k] = v;
    }
  }
  try {
    vercelTrack(event, clean);
  } catch {
    // Never let analytics throw into product code.
  }
  try {
    if (posthogReady) posthog.capture(event, clean);
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
