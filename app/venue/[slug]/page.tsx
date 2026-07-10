import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchVenueBySlug, fetchVenuePreviewBySlug } from "@/lib/queries";
import { getAuthUser } from "@/lib/auth";
import { SITE_URL } from "@/lib/config";
import { VenueDetail } from "./venue-detail";
import { AuthWall } from "@/components/auth-wall";
import { DesktopNav } from "@/components/desktop-nav";

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
export async function generateMetadata(props: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const params = await props.params;
  // Card-level fetch: metadata is public (crawlers/link unfurls run as anon, who
  // are grant-blocked from moat columns), so never select the full row here.
  const venue = await fetchVenuePreviewBySlug(params.slug);
  if (!venue) return { title: "Venue not found" };

  const title = `${venue.name}, ${venue.neighbourhood}, London`;
  const description =
    venue.longDescription?.slice(0, 200) ||
    `${venue.name} in ${venue.neighbourhood}, London. Plan your night and book a table on Fun London.`;
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

export default async function VenuePage(props: {
  params: Promise<{ slug: string }>;
}) {
  const params = await props.params;
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
      {/* Desktop-only top nav (hidden lg:block) — visitors landing here from
          Google/shared links on a laptop need a way into the rest of the app.
          Mobile keeps the immersive no-chrome layout. */}
      <DesktopNav />
      <VenueDetail venue={venue} signedIn={!!authUser} />
      <AuthWall
        signedIn={!!authUser}
        title={`Sign up to see ${venue.name}`}
        backHref="/explore"
      />
    </>
  );
}
