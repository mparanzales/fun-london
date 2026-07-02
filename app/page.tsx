// Entry point for "/" — Server Component.
//
// "/" is now just the brand splash, which routes everyone to /explore (the home
// feed). The old marketing landing was removed; the home of the product is the
// Explore feed, and "What's on" (/events) is the second tab.

import type { Metadata } from "next";
import { CITY, TAGLINE, SITE_URL } from "@/lib/config";
import { SplashClient } from "./splash-client";

// Force dynamic so "/" never gets statically generated at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Fun ${CITY}: plan the night, not the place`,
  description:
    "fun london builds you a night out: two or three independent spots, a short walk apart, in the order you'd do them, with the table ready to book in a couple of taps.",
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
