import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  fetchEventById,
  fetchVenueById,
  fetchEventPreviewById,
  fetchVenuePreviewById,
} from "@/lib/queries";
import { SITE_URL } from "@/lib/config";
import { EventDetail } from "./event-detail";
import { fetchAnonEventTeaser } from "@/lib/event-teaser";
import { DetailAuthWall } from "@/components/detail-auth-wall";
import { DesktopNav } from "@/components/desktop-nav";

// Shared implementation behind TWO routes (same split as the venue page):
//   /event/[id]       — dynamic (force-dynamic), auth-aware
//   /anon/event/[id]  — ISR; middleware rewrites cookie-less traffic here
// The anon route calls this with signedIn=false and never touches cookies.

export async function buildEventMetadata(id: string): Promise<Metadata> {
  // Card-level fetch: metadata is public (crawlers/link unfurls run as
  // anon), so never select the full row here.
  const event = await fetchEventPreviewById(id);
  if (!event) return { title: "Event not found" };

  const title = `${event.name}, ${event.venueName}, ${event.area}`;
  const description = `${event.name} at ${event.venueName}, ${event.area}. ${event.dateLabel}${event.timeLabel ? ` · ${event.timeLabel}` : ""}.`;
  const url = `${SITE_URL}/event/${event.id}`;
  // Explicit OG image — the file convention only wires itself on the
  // /event/[id] folder's route; the /anon twin needs it named.
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

export async function EventPageBody({
  id,
  signedIn,
}: {
  id: string;
  signedIn: boolean;
}) {
  // Signed-out visitors get a CARD-LEVEL preview only (no sourceUrl /
  // description / moat fields). fetchEventById (cookie-reading) is only
  // reached when signedIn — the anon/ISR render stays cookie-free.
  const event = signedIn
    ? await fetchEventById(id)
    : await fetchEventPreviewById(id);
  if (!event) notFound();

  // Pull the linked venue when we have one. Null is fine — the UI degrades
  // gracefully. Anonymous visitors get the card-level venue preview.
  const venue = event.venueId
    ? signedIn
      ? await fetchVenueById(event.venueId)
      : await fetchVenuePreviewById(event.venueId)
    : null;

  // Anon teaser of the event's own description (server-derived, capped — see
  // lib/event-teaser). Signed-in users get the full description on the event
  // object instead. Cookie-free so the /anon event twin stays ISR.
  const anonTeaser = signedIn ? null : (await fetchAnonEventTeaser(id)).teaser;

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
      {/* Desktop-only top nav (hidden lg:block) — same treatment as the
          venue route: laptop landers need a way into the app. */}
      <DesktopNav />
      <EventDetail
        event={event}
        venue={venue}
        signedIn={signedIn}
        anonTeaser={anonTeaser?.text ?? null}
        anonTeaserTruncated={anonTeaser?.truncated ?? false}
      />
      {/* Mobile: hard wall unchanged. Desktop: dismissable ("Just looking")
          and re-surfaces every few minutes — same DetailAuthWall as /venue. */}
      <DetailAuthWall
        signedIn={signedIn}
        title={`Sign up to see ${event.name}`}
        backHref="/explore"
      />
    </>
  );
}
