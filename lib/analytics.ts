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
    },
  });
  posthogReady = true;
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
