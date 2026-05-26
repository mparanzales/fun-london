import { notFound } from "next/navigation";
import { getVenueBySlug } from "@/lib/mock-data";
import { VenueDetail } from "./venue-detail";

// Top-level route OUTSIDE the (main) route group on purpose — that means
// no bottom nav, no max-w-md shell wrapper. The detail screen handles
// its own layout so the hero can be full-bleed and the sticky CTA bar
// pins to the viewport.

export default function VenuePage({ params }: { params: { slug: string } }) {
  const venue = getVenueBySlug(params.slug);
  if (!venue) notFound();
  return <VenueDetail venue={venue} />;
}
