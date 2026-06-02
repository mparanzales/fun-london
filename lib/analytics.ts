// Lightweight, privacy-respecting product analytics.
//
// Wraps Vercel Analytics custom events (already mounted via <Analytics /> in
// app/layout.tsx) behind one typed `track()` call so the core conversion
// funnel is measurable. Vercel Analytics is cookieless, so this does not by
// itself require consent — but to be safe under UK PECR we ALSO gate behind
// the cookie-consent choice (see components/consent-banner.tsx): if a visitor
// has explicitly declined, we drop events on the floor.
//
// Why a wrapper and not calls to `track` everywhere:
//   • one place to add/remove a provider (PostHog, etc.) later;
//   • one place to enforce the consent gate and the event allowlist;
//   • safe no-op on the server and before the analytics script loads.
//
// Usage:  import { track } from "@/lib/analytics";
//         track("venue_reserve_click", { venue: "padella", platform: "opentable" });

import { track as vercelTrack } from "@vercel/analytics";

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
  | "together_room_create"
  | "together_room_join"
  | "together_swipe"
  | "share" // Web Share / clipboard from any surface
  | "search_query"
  | "onboarding_complete"
  | "sign_in_complete";

type Props = Record<string, string | number | boolean | null | undefined>;

// Consent gate. Defaults to allowing analytics (cookieless) UNLESS the user
// has explicitly opted out. Kept in localStorage by the consent banner.
const CONSENT_KEY = "fl.consent.v1"; // "granted" | "denied"

function analyticsAllowed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(CONSENT_KEY) !== "denied";
  } catch {
    return true;
  }
}

export function track(event: AnalyticsEvent, props?: Props): void {
  if (!analyticsAllowed()) return;
  try {
    // Vercel's track accepts a flat props object; strip undefined to keep
    // payloads clean.
    const clean: Record<string, string | number | boolean | null> = {};
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v !== undefined) clean[k] = v;
      }
    }
    vercelTrack(event, clean);
  } catch {
    // Never let analytics throw into product code.
  }
}
