// Home ("/") — Server Component.
//
// A quick brand-mark splash on a cold open, then straight into the app
// (/explore). There is no marketing landing anymore: the front door is the
// metered Explore feed (a few preview cards + a sign-up prompt for anonymous
// visitors, the full feed once signed in). The LandingPage component is kept
// in the repo (app/landing.tsx) but no longer routed, so it's easy to restore.

import type { Metadata } from "next";
import { CITY, TAGLINE, SITE_URL } from "@/lib/config";
import { SplashClient } from "./splash-client";

// Home-page metadata + canonical. Crawlers still get a titled, described home
// with WebSite/Organization JSON-LD even though the page redirects into the app.
export const metadata: Metadata = {
  title: `Fun ${CITY}: plan the night, not the place`,
  description:
    "fun london builds you a night out: independent spots, a short walk apart, in the order you'd do them, with the table ready to book in a couple of taps.",
  alternates: { canonical: "/" },
};

export default function SplashPage() {
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
      <SplashClient />
    </>
  );
}
