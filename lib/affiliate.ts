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
export function applyAffiliate(platform: Platform, rawUrl: string): string {
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
  }

  // (b) Affiliate id — only when the env var is set.
  const cfg = AFFILIATE[platform];
  if (cfg) {
    const id = affiliateId(cfg.env);
    if (id) u.searchParams.set(cfg.param, id);
  }

  return u.toString();
}
