import { notFound } from "next/navigation";
import { fetchVenueBySlug } from "@/lib/queries";
import { DidYouBook } from "./did-you-book";

// "Did you book?" page. Reached after the Reserve sheet hands the user off
// to the venue's booking platform (pre-filled with their date/time/party).
// The actual reservation happens there; here we let them log it so it
// becomes a real entry in Saved → "Coming up". No phantom bookings.

export default async function BookingConfirmedPage(props: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ d?: string; t?: string; p?: string }>;
}) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const venue = await fetchVenueBySlug(params.slug);
  if (!venue) notFound();

  return (
    <DidYouBook
      venue={venue}
      date={searchParams.d ?? ""}
      time={searchParams.t ?? ""}
      party={Number(searchParams.p ?? "2") || 2}
    />
  );
}
