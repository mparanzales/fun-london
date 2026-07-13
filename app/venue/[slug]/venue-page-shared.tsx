import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchVenueBySlug, fetchVenuePreviewBySlug } from "@/lib/queries";
import { fetchAnonVenueTeaser } from "@/lib/venue-teaser";
import { SITE_URL } from "@/lib/config";
import { VenueDetail } from "./venue-detail";
import { DetailAuthWall } from "@/components/detail-auth-wall";
import { DesktopNav } from "@/components/desktop-nav";

// Shared implementation behind TWO routes:
//   /venue/[slug]       — dynamic; reads the auth cookie, full data signed-in
//   /anon/venue/[slug]  — ISR (revalidate); middleware rewrites cookie-less
//                         traffic here so anonymous/SEO hits serve from the
//                         CDN instead of a full SSR + auth round-trip
// The anon route calls this with signedIn=false and NEVER touches cookies —
// that's what makes it statically cacheable. Moat safety is by path
// separation: signed-in requests are never rewritten, so the cached page is
// only ever built from the anon preview fetchers + the capped teaser.

export async function buildVenueMetadata(slug: string): Promise<Metadata> {
  // Card-level fetch: metadata is public (crawlers/link unfurls run as anon,
  // who are grant-blocked from moat columns), so never select the full row.
  const venue = await fetchVenuePreviewBySlug(slug);
  if (!venue) return { title: "Venue not found" };

  const title = `${venue.name}, ${venue.neighbourhood}, London`;
  // The SAME capped teaser string the anon page renders — one string, one
  // exposure decision (SERP snippet always matches the page).
  const { teaser } = await fetchAnonVenueTeaser(slug);
  const description =
    teaser?.text ||
    `${venue.name} in ${venue.neighbourhood}, London. Plan your night and book a table on Fun London.`;
  const url = `${SITE_URL}/venue/${venue.slug}`;
  // Explicit OG image: the opengraph-image.tsx file convention only wires
  // itself on THIS folder's route; the /anon twin needs the image named
  // explicitly (same URL — /venue/... is not rewritten for deep paths).
  const ogImage = `${url}/opengraph-image`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { type: "article", url, title, description, images: [ogImage] },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
  };
}

export async function VenuePageBody({
  slug,
  signedIn,
}: {
  slug: string;
  signedIn: boolean;
}) {
  // Signed-out visitors get a CARD-LEVEL preview only — never the moat fields
  // (full editorial, sources, creator coverage, flags, booking links, phone,
  // address, opening hours). fetchVenueBySlug (cookie-reading) is only
  // reached when signedIn — the anon/ISR render stays cookie-free.
  const venue = signedIn
    ? await fetchVenueBySlug(slug)
    : await fetchVenuePreviewBySlug(slug);
  if (!venue) notFound();

  // Anon teaser + top-3 tags (server-derived, capped — see lib/anon-teaser).
  const anonExtras = signedIn ? null : await fetchAnonVenueTeaser(slug);

  // Structured data → rich results in Google (rating stars, price, area).
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: venue.name,
    address: {
      "@type": "PostalAddress",
      streetAddress: venue.address,
      addressLocality: venue.neighbourhood,
      addressRegion: "London",
      addressCountry: "GB",
    },
    image: venue.imgUrl,
    url: `${SITE_URL}/venue/${venue.slug}`,
    priceRange: venue.price,
    ...(venue.lat && venue.lng
      ? {
          geo: {
            "@type": "GeoCoordinates",
            latitude: venue.lat,
            longitude: venue.lng,
          },
        }
      : {}),
    ...(venue.rating && venue.reviewCount
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: venue.rating,
            reviewCount: venue.reviewCount,
          },
        }
      : {}),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {/* Desktop-only top nav (hidden lg:block) — visitors landing here from
          Google/shared links on a laptop need a way into the rest of the app.
          Mobile keeps the immersive no-chrome layout. */}
      <DesktopNav />
      <VenueDetail
        venue={venue}
        signedIn={signedIn}
        anonTeaser={anonExtras?.teaser?.text ?? null}
        anonTeaserTruncated={anonExtras?.teaser?.truncated ?? false}
        anonTags={anonExtras?.tags ?? []}
      />
      {/* Mobile: the hard wall, unchanged. Desktop: dismissable ("Just
          looking") and re-surfaces every few minutes — Maria's funnel
          call, 2026-07-10. */}
      <DetailAuthWall
        signedIn={signedIn}
        title={`Sign up for the full guide to ${venue.name}`}
        backHref="/explore"
      />
    </>
  );
}
