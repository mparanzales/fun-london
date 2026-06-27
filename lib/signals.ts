"use client";

// Kind C signals writer — algorithm step 0.4.
//
// Records behavioural taps to public.user_events: the first-party, RLS-locked
// store the recommendation engine reads. This is a DIFFERENT sink from
// lib/analytics.ts (PostHog / Vercel) — analytics is for us (dashboards),
// user_events is for the algorithm (the taste vector, Kind A aggregation, the
// learning loop).
//
// This module is the WRITER LAYER, and per supabase/schema.sql it is the sole
// place that can enforce three invariants the database cannot:
//   • SIGNED-IN ONLY (decision D1) — no session, no write. (RLS would reject
//     anon anyway; this just avoids a guaranteed-failing round-trip.)
//   • CONSENT — respects the same opt-out as analytics, so a user who declined
//     isn't behaviourally profiled either. (Product decision — see note below.)
//   • COARSE CONTEXT ONLY — strips PII / precise-geo keys before they ever
//     leave the browser. The DB CHECK can't see nested JSON, so it's enforced
//     HERE (sanitizeContext).
//
// Always fire-and-forget: never throws into product code, never blocks the UI.

import { createClient } from "@/lib/supabase/client";

// Must mirror the locked taxonomy in supabase/schema.sql (step 0.2). A value
// not in these unions is a compile error here AND a CHECK violation in the DB.
export type SignalType =
  | "impression"
  | "open"
  | "dwell"
  | "outbound_click"
  | "save"
  | "unsave"
  | "dismiss"
  | "react"
  | "veto"
  | "plan_started"
  | "plan_completed"
  | "plan_abandoned"
  | "search"
  | "filter";

export type SignalSurface =
  | "explore"
  | "feed"
  | "plan"
  | "friends"
  | "venue"
  | "saved"
  | "onboarding"
  | "search_results";

type Primitive = string | number | boolean | null;
export type SignalContext = Record<string, Primitive | undefined>;

export interface NewSignal {
  eventType: SignalType;
  surface: SignalSurface;
  venueId?: string | null;
  context?: SignalContext;
}

// Reuse the analytics consent key: opting out of analytics also opts out of
// behavioural profiling. (Decision: personalisation follows the same gate as
// analytics for now; revisit if we ever want a separate personalisation toggle.)
const CONSENT_KEY = "fl.consent.v1";

function signalsAllowed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(CONSENT_KEY) !== "denied";
  } catch {
    return true;
  }
}

// The coarse-only guard. context must never carry PII or precise geolocation —
// the DB can't inspect nested JSON, so we drop any key that looks identifying
// or location-precise, and clamp long strings. Coarse signals (rank, position,
// query length, a neighbourhood label) are tiny and pass through.
const BLOCKED_KEY =
  /(^|_)(lat|lng|lon|long|coord|coords|geo|geohash|email|phone|name|address|postcode|ip|token|device|user|session)(_|$)/i;

export function sanitizeContext(
  ctx?: SignalContext,
): Record<string, Primitive> {
  const out: Record<string, Primitive> = {};
  if (!ctx) return out;
  for (const [k, v] of Object.entries(ctx)) {
    if (v === undefined) continue;
    if (BLOCKED_KEY.test(k)) continue; // drop PII / precise-geo keys
    out[k] = typeof v === "string" && v.length > 120 ? v.slice(0, 120) : v;
  }
  return out;
}

// createBrowserClient is cheap but there's no need for more than one.
let cached: ReturnType<typeof createClient> | null = null;
function browser() {
  return (cached ??= createClient());
}

/** Record one behavioural signal. Fire-and-forget; safe to call anywhere. */
export function recordSignal(
  eventType: SignalType,
  opts: {
    surface: SignalSurface;
    venueId?: string | null;
    context?: SignalContext;
  },
): void {
  recordSignals([{ eventType, ...opts }]);
}

/** Record many signals in ONE insert (e.g. a page of feed impressions). */
export function recordSignals(signals: NewSignal[]): void {
  if (signals.length === 0 || !signalsAllowed()) return;
  void flush(signals);
}

async function flush(signals: NewSignal[]): Promise<void> {
  try {
    const supabase = browser();
    // getSession reads locally (no network) — fine for fire-and-forget
    // telemetry. The browser client attaches the user's JWT to the insert, so
    // it runs as `authenticated` and satisfies the RLS with_check
    // (user_id = auth.uid()).
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return; // D1: signed-in only

    const rows = signals.map((s) => ({
      user_id: userId,
      venue_id: s.venueId ?? null,
      event_type: s.eventType,
      surface: s.surface,
      context: sanitizeContext(s.context),
    }));
    await supabase.from("user_events").insert(rows);
  } catch {
    // Never let signal capture throw into product code.
  }
}
