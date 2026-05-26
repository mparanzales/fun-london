import { notFound } from "next/navigation";
import { fetchVenueBySlug } from "@/lib/queries";
import { VenueDetail } from "./venue-detail";

// Top-level route OUTSIDE the (main) route group on purpose — that means
// no bottom nav, no max-w-md shell wrapper. The detail screen handles
// its own layout so the hero can be full-bleed and the sticky CTA bar
// pins to the viewport.
//
// Server Component: fetches the venue from Supabase and hands it to
// the (client) VenueDetail. notFound() triggers app/not-found.tsx.

export default async function VenuePage({
  params,
}: {
  params: { slug: string };
}) {
  const venue = await fetchVenueBySlug(params.slug);
  if (!venue) notFound();
  return <VenueDetail venue={venue} />;
}
