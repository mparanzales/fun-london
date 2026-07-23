import { notFound, redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
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

  // Defence-in-depth: this page calls the FULL fetcher below (every moat
  // field serializes into DidYouBook). Anonymous traffic is already bounced by
  // middleware (isPublicPath omits /booking → signInRedirect), but we do NOT
  // rely on the allow-list alone — an in-page gate means the moat row can never
  // reach an anon client even if that list ever changes. Logging a booking
  // needs an account anyway, so send anon to sign-in and back.
  const authUser = await getAuthUser();
  if (!authUser) {
    const qs = new URLSearchParams();
    if (searchParams.d) qs.set("d", searchParams.d);
    if (searchParams.t) qs.set("t", searchParams.t);
    if (searchParams.p) qs.set("p", searchParams.p);
    const query = qs.toString();
    const dest = `/booking/${params.slug}/confirmed${query ? `?${query}` : ""}`;
    redirect(`/sign-in?return=${encodeURIComponent(dest)}`);
  }

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
