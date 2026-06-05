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
import { fetchVenues } from "@/lib/queries";
import { CITY, TAGLINE, SITE_URL } from "@/lib/config";
import { SplashClient } from "./splash-client";
import { LandingPage } from "./landing";

// Force dynamic rendering so getAuthUser() (which reads cookies) doesn't
// trigger Next's "can't use cookies in a static page" error at build time.
export const dynamic = "force-dynamic";

// Home-page metadata. The layout supplies sensible defaults; we set an
// explicit canonical so the marketing landing is the indexed home URL.
export const metadata: Metadata = {
  title: `Fun ${CITY}: the independent ${CITY} worth leaving the house for`,
  description:
    "A curated guide to independent London. No chains, every bar, restaurant and event cross-checked in at least two trusted sources.",
  alternates: { canonical: "/" },
};

// How many real venues to feature on the landing.
const FEATURED_COUNT = 8;

export default async function SplashPage() {
  const user = await getAuthUser();

  // Featured venues for the landing — highest-rated first. Failures degrade
  // gracefully to a venue-less landing (the splash + hero still render).
  let featured: Awaited<ReturnType<typeof fetchVenues>> = [];
  try {
    const venues = await fetchVenues();
    featured = [...venues]
      .sort((a, b) => b.rating - a.rating)
      .slice(0, FEATURED_COUNT);
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
