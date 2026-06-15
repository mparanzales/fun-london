import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  fetchEventById,
  fetchVenueById,
  fetchEventPreviewById,
  fetchVenuePreviewById,
} from "@/lib/queries";
import { getAuthUser } from "@/lib/auth";
import { SITE_URL } from "@/lib/config";
import { EventDetail } from "./event-detail";
import { AuthWall } from "@/components/auth-wall";

// Force dynamic so changes from the events ingest cron show up
// immediately on the detail page (no static cache).
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  const event = await fetchEventById(params.id);
  if (!event) return { title: "Event not found" };

  const title = `${event.name}, ${event.venueName}, ${event.area}`;
  const description = `${event.name} at ${event.venueName}, ${event.area}. ${event.dateLabel}${event.timeLabel ? ` · ${event.timeLabel}` : ""}.`;
  const url = `${SITE_URL}/event/${event.id}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    // OG/Twitter images auto-wired by opengraph-image.tsx in this folder.
    openGraph: { type: "article", url, title, description },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function EventDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const authUser = await getAuthUser();
  // Signed-out visitors get a CARD-LEVEL preview only (no sourceUrl /
  // description / moat fields); the AuthWall overlays the sign-up prompt.
  const event = authUser
    ? await fetchEventById(params.id)
    : await fetchEventPreviewById(params.id);
  if (!event) notFound();

  // Pull the linked venue when we have one. Gives the detail page access to
  // neighbourhood vibe for richer context. Null is fine — the UI degrades
  // gracefully. Anonymous visitors get the card-level venue preview, not the
  // full row.
  const venue = event.venueId
    ? authUser
      ? await fetchVenueById(event.venueId)
      : await fetchVenuePreviewById(event.venueId)
    : null;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.name,
    startDate: event.startsAt,
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    image: event.imgUrl,
    url: `${SITE_URL}/event/${event.id}`,
    location: {
      "@type": "Place",
      name: event.venueName,
      address: {
        "@type": "PostalAddress",
        addressLocality: event.area,
        addressRegion: "London",
        addressCountry: "GB",
      },
    },
    ...(event.sourceUrl
      ? {
          offers: {
            "@type": "Offer",
            url: event.sourceUrl,
            availability: "https://schema.org/InStock",
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
      <EventDetail event={event} venue={venue} />
      <AuthWall
        signedIn={!!authUser}
        title={`Sign up to see ${event.name}`}
        backHref="/explore"
      />
    </>
  );
}
