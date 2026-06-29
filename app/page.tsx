// Splash entry point — Server Component.
//
// Plays every time "/" is visited (no session skip). There is no taste quiz
// anymore — the home is the Explore feed; "What's on" (/events) is the 2nd tab.
//
// Routing rule (resolved in SplashClient after the brand-mark animation):
//   - signed in                       → /explore
//   - anonymous + has visited before  → /explore
//   - anonymous + first time          → reveal the LandingPage rendered here
//     underneath the splash (no redirect) — so funldn.com is a real, indexable,
//     shareable page. "Visited" is marked once they enter the app shell.
//
// Keeping the splash for everyone preserves the brand moment on every cold open.

import type { Metadata } from "next";
import { getAuthUser } from "@/lib/auth";
import { fetchVenuePreview } from "@/lib/queries";
import { CITY, TAGLINE, SITE_URL } from "@/lib/config";
import { SplashClient } from "./splash-client";
import { LandingPage } from "./landing";

// Force dynamic rendering so getAuthUser() (which reads cookies) doesn't
// trigger Next's "can't use cookies in a static page" error at build time.
export const dynamic = "force-dynamic";

// Home-page metadata. The layout supplies sensible defaults; we set an
// explicit canonical so the marketing landing is the indexed home URL.
export const metadata: Metadata = {
  title: `Fun ${CITY}: plan the night, not the place`,
  description:
    "fun london builds you a night out: two or three independent spots, a short walk apart, in the order you'd do them, with the table ready to book in a couple of taps.",
  alternates: { canonical: "/" },
};

// How many real venues to feature on the landing.
const FEATURED_COUNT = 8;

export default async function SplashPage() {
  const user = await getAuthUser();

  // Featured venues for the landing. The landing renders for signed-OUT
  // visitors, and the anon DB role is grant-blocked from the full row, so this
  // MUST be a card-level fetch (curated venues sort first). Failures degrade
  // gracefully to a venue-less landing (the splash + hero still render).
  let featured: Awaited<ReturnType<typeof fetchVenuePreview>> = [];
  try {
    featured = await fetchVenuePreview(FEATURED_COUNT);
  } catch {
    // Leave featured empty — LandingPage hides the section when there are none.
  }

  // WebSite + Organization JSON-LD so the home URL is understood by crawlers.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Fun London",
    url: SITE_URL,
    description: TAGLINE,
    publisher: {
      "@type": "Organization",
      name: "Fun London",
      url: SITE_URL,
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {/* Server-rendered landing sits underneath; the splash overlay either
          redirects past it (returning/signed-in) or fades to reveal it
          (first-time, signed-out visitors). */}
      <LandingPage venues={featured} />
      <SplashClient authed={!!user} />
    </>
  );
}
