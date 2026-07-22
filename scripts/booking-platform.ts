// Booking-platform detection, shared by ingest-venues.ts and
// ingest-from-pending.ts.
//
// WHY THIS EXISTS AS ITS OWN MODULE. Both scripts carried their own identical
// copy of PLATFORM_PATTERNS, so a fix to one silently left the other wrong.
// Several writers feed public.venues; the rule is fix every writer, not the
// one you happened to find.
//
// WHY IT PARSES INSTEAD OF SUBSTRING-MATCHING. The old patterns were bare
// substrings against the whole URL:
//
//     /opentable\.(com|co\.uk)/i.test(url)
//
// which matches any URL merely CONTAINING the string, so all of these were
// attributed to OpenTable:
//
//     https://notopentable.com                  (different company)
//     https://opentable.com.phishing.example    (attacker-controlled)
//     https://myrestaurant.com/?ref=opentable.com
//
// The consequence is not a security hole: it mislabels a booking link and
// sends affiliate attribution to the wrong partner, and marks a walk-in venue
// as "reservable". Both are wrong in the catalogue and in the money.
//
// So detection now parses the URL and compares the HOSTNAME, accepting the
// registrable domain or any subdomain of it, and nothing else.

import type { BookingLink, BookingPlatform } from "@/lib/types";

// Registrable domains per platform. Add a domain, not a pattern.
const PLATFORM_HOSTS: { platform: BookingPlatform; domains: string[] }[] = [
  { platform: "opentable", domains: ["opentable.com", "opentable.co.uk"] },
  { platform: "resy", domains: ["resy.com"] },
  { platform: "sevenrooms", domains: ["sevenrooms.com"] },
  { platform: "thefork", domains: ["thefork.com", "thefork.co.uk"] },
  { platform: "quandoo", domains: ["quandoo.com", "quandoo.co.uk"] },
  { platform: "tablein", domains: ["tablein.com"] },
];

export const MAJOR_PLATFORMS: BookingPlatform[] = PLATFORM_HOSTS.map(
  (p) => p.platform,
);

// Hostname of a URL, lowercased, with a leading "www." removed. Returns null
// when the input is not a parseable absolute URL. Google's websiteUri is
// normally absolute, but ingest also sees hand-entered values, so a bare
// "opentable.com/foo" is retried as https:// rather than silently dropped.
export function hostnameOf(url: string | null | undefined): string | null {
  if (typeof url !== "string" || url.trim() === "") return null;
  const raw = url.trim();
  for (const candidate of [raw, `https://${raw}`]) {
    try {
      const h = new URL(candidate).hostname.toLowerCase();
      if (h) return h.replace(/^www\./, "");
    } catch {
      // try the next candidate
    }
  }
  return null;
}

// True when `hostname` IS `domain` or a subdomain of it. Deliberately not a
// substring test: "notopentable.com" and "opentable.com.evil.io" must fail.
function hostMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

// The booking platform a URL belongs to, or null if it is not one we know.
export function detectBookingPlatform(
  url: string | null | undefined,
): BookingPlatform | null {
  const host = hostnameOf(url);
  if (!host) return null;
  for (const { platform, domains } of PLATFORM_HOSTS) {
    if (domains.some((d) => hostMatches(host, d))) return platform;
  }
  return null;
}

// Booking links for a venue's website URL. A recognised platform wins at
// priority 1; anything else falls back to the venue's own site at 99.
export function detectBookingLinks(
  websiteUri?: string | null,
): BookingLink[] {
  if (!websiteUri) return [];
  const platform = detectBookingPlatform(websiteUri);
  if (platform) return [{ platform, url: websiteUri, priority: 1 }];
  return [{ platform: "website", url: websiteUri, priority: 99 }];
}

export function hasMajorBookingPlatform(links: BookingLink[]): boolean {
  return links.some((l) =>
    (MAJOR_PLATFORMS as readonly BookingPlatform[]).includes(l.platform),
  );
}
