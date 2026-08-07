// Affiliate / attribution tagging for outbound booking + ticket links.
//
// The single place that rewrites an outbound URL with (a) harmless UTM
// attribution (always) and (b) a per-platform affiliate id (ONLY when
// configured via env — otherwise a no-op). It is plumbing: with no id set it
// changes nothing functional. Each platform has its own id + param name (some
// route through a tracking domain rather than a query param), wired per the
// platform's spec when configured. The ids are public by design (they live in
// the outbound URL), so NEXT_PUBLIC_* is correct.
//
//   NEXT_PUBLIC_AFFILIATE_OPENTABLE     e.g. "funlondon"   → ?ref=
//   NEXT_PUBLIC_AFFILIATE_RESY                              → ?ref=
//   NEXT_PUBLIC_AFFILIATE_SEVENROOMS                        → ?ref=
//   NEXT_PUBLIC_AFFILIATE_THEFORK                           → ?partner=
//   NEXT_PUBLIC_AFFILIATE_TICKETMASTER  (Awin/Impact id)    → ?awc= / partner param
//
// ⚠️ BEFORE SETTING NEXT_PUBLIC_AFFILIATE_TICKETMASTER: applyAffiliate
// ("ticketmaster", …) is called for EVERY non-popup event, whatever provider
// the link actually points at, so that id would be stamped onto Eventbrite /
// DICE / Skiddle outbounds too. Harmless today because an unset id makes the
// affiliate half a no-op. The provider→platform map (event-detail.tsx already
// derives the provider for its label) has to land in the SAME change as the
// id, not after it.
//
// 🧨 THERE ARE NOW TWO TICKETMASTER CALL SITES, and they are not equally
// recoverable (lib/booking-link.ts is a third caller, on the reserve path):
//   app/event/[id]/event-detail.tsx   the on-page CTA
//   lib/ics-ticket-url.ts             the .ics calendar entry
// A wrongly-stamped id in the CTA is fixed by the next deploy. The same id
// inside .ics files people have already downloaded is permanent, sitting on
// their devices until they open the link, and is a false attribution claim to
// a partner. Fix the platform map BEFORE the id, not after.
//
// PRE-FLIGHT, before setting the id:
//   1. Land the provider→platform map, so the id only goes on that provider's
//      links. Without it, an Eventbrite/DICE .ics carries both the id and the
//      commission sentence while earning nothing.
//   2. REDEPLOY after setting the variable, do not just set it in the
//      dashboard. NEXT_PUBLIC_* is inlined at build time, so an un-redeployed
//      app serves a server render and a client bundle that disagree about
//      both the id and the disclosure.
//   3. Decide what to do about a source_url that ALREADY carries the
//      platform's param: line ~110 overwrites it, which in a permanent .ics
//      is silent click-hijacking of whoever set it.

import type { BookingLink } from "@/lib/types";

type Platform = BookingLink["platform"] | "ticketmaster" | "generic";

// Per-platform affiliate config: which env var holds the id, and which query
// param that platform expects it in. Param names are best-effort defaults —
// confirm against each programme's spec when wiring the real id.
const AFFILIATE: Partial<Record<Platform, { env: string; param: string }>> = {
  opentable: { env: "NEXT_PUBLIC_AFFILIATE_OPENTABLE", param: "ref" },
  resy: { env: "NEXT_PUBLIC_AFFILIATE_RESY", param: "ref" },
  sevenrooms: { env: "NEXT_PUBLIC_AFFILIATE_SEVENROOMS", param: "ref" },
  thefork: { env: "NEXT_PUBLIC_AFFILIATE_THEFORK", param: "partner" },
  ticketmaster: { env: "NEXT_PUBLIC_AFFILIATE_TICKETMASTER", param: "awc" },
};

// next/env inlines NEXT_PUBLIC_* at build time, so a dynamic process.env[name]
// lookup won't work on the client. Map each id explicitly so it gets inlined.
function affiliateId(env: string): string | undefined {
  switch (env) {
    case "NEXT_PUBLIC_AFFILIATE_OPENTABLE":
      return process.env.NEXT_PUBLIC_AFFILIATE_OPENTABLE;
    case "NEXT_PUBLIC_AFFILIATE_RESY":
      return process.env.NEXT_PUBLIC_AFFILIATE_RESY;
    case "NEXT_PUBLIC_AFFILIATE_SEVENROOMS":
      return process.env.NEXT_PUBLIC_AFFILIATE_SEVENROOMS;
    case "NEXT_PUBLIC_AFFILIATE_THEFORK":
      return process.env.NEXT_PUBLIC_AFFILIATE_THEFORK;
    case "NEXT_PUBLIC_AFFILIATE_TICKETMASTER":
      return process.env.NEXT_PUBLIC_AFFILIATE_TICKETMASTER;
    default:
      return undefined;
  }
}

// Rewrite an outbound URL with attribution + (if configured) an affiliate id.
// Always safe: on a malformed URL it returns the original untouched.
//
// `surface` marks WHERE the click came from (utm_content). Without it every
// outbound carries the same utm_medium/utm_campaign, so a calendar open days
// later is indistinguishable from an on-page tap in the partner's report --
// attribution that cannot answer the one question it exists for. Optional, so
// existing callers keep their exact current output.
export function applyAffiliate(
  platform: Platform,
  rawUrl: string,
  surface?: string,
): string {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return rawUrl;
  }

  // (a) Attribution — harmless, helps partner conversations even pre-deal.
  if (!u.searchParams.has("utm_source")) {
    u.searchParams.set("utm_source", "funlondon");
    u.searchParams.set("utm_medium", "app");
    u.searchParams.set("utm_campaign", "reserve");
    // The surface belongs INSIDE this branch. When the provider already owns
    // the utm namespace we add nothing at all, rather than dropping our
    // utm_content into THEIR campaign's creative dimension, where neither side
    // can read it correctly.
    if (surface) u.searchParams.set("utm_content", surface);
  }

  // (b) Affiliate id — only when the env var is set.
  const cfg = AFFILIATE[platform];
  if (cfg) {
    const id = affiliateId(cfg.env);
    if (id) u.searchParams.set(cfg.param, id);
  }

  return u.toString();
}
