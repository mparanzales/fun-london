import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchVenueBySlug, fetchVenuePreviewBySlug } from "@/lib/queries";
import { getAuthUser } from "@/lib/auth";
import { SITE_URL } from "@/lib/config";
import { VenueDetail } from "./venue-detail";
import { AuthWall } from "@/components/auth-wall";

// Top-level route OUTSIDE the (main) route group on purpose — that means
// no bottom nav, no max-w-md shell wrapper. The detail screen handles
// its own layout so the hero can be full-bleed and the sticky CTA bar
// pins to the viewport.
//
// Server Component: fetches the venue from Supabase and hands it to
// the (client) VenueDetail. notFound() triggers app/not-found.tsx.

// Per-page metadata so a shared /venue/[slug] link renders a rich preview
// (name, neighbourhood, description, OG image) instead of the generic site
// card — and so Google can index each venue page distinctly.
export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const venue = await fetchVenueBySlug(params.slug);
  if (!venue) return { title: "Venue not found" };

  const title = `${venue.name}, ${venue.neighbourhood}, London`;
  const description =
    venue.longDescription?.slice(0, 200) ||
    `${venue.name} in ${venue.neighbourhood}. Independent London, checked in 2+ trusted sources.`;
  const url = `${SITE_URL}/venue/${venue.slug}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    // OG/Twitter images are auto-wired by the opengraph-image.tsx file
    // convention in this folder — no need to list them here.
    openGraph: { type: "article", url, title, description },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function VenuePage({
  params,
}: {
  params: { slug: string };
}) {
  const authUser = await getAuthUser();
  // Signed-out visitors get a CARD-LEVEL preview only — never the moat fields
  // (full editorial, sources, creator coverage, flags, booking links, phone,
  // address, opening hours). The AuthWall overlays a sign-up prompt; the
  // sensitive data simply never reaches the anonymous client payload.
  const venue = authUser
    ? await fetchVenueBySlug(params.slug)
    : await fetchVenuePreviewBySlug(params.slug);
  if (!venue) notFound();

  // Structured data → rich results in Google (rating stars, price, area).
  // Only assert aggregateRating when we actually hold a rating + count.
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
      <VenueDetail venue={venue} />
      <AuthWall
        signedIn={!!authUser}
        title={`Sign up to see ${venue.name}`}
        backHref="/explore"
      />
    </>
  );
}
