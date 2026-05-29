import { notFound } from "next/navigation";
import { fetchEventById, fetchVenueById } from "@/lib/queries";
import { EventDetail } from "./event-detail";

// Force dynamic so changes from the events ingest cron show up
// immediately on the detail page (no static cache).
export const dynamic = "force-dynamic";

export default async function EventDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const event = await fetchEventById(params.id);
  if (!event) notFound();

  // Pull the linked venue when we have one. Gives the detail page
  // access to neighbourhood vibe + booking-link metadata for richer
  // context. Null is fine — the UI degrades gracefully.
  const venue = event.venueId ? await fetchVenueById(event.venueId) : null;

  return <EventDetail event={event} venue={venue} />;
}
