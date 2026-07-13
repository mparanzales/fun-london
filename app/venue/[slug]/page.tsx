import type { Metadata } from "next";
import { getAuthUser } from "@/lib/auth";
import { buildVenueMetadata, VenuePageBody } from "./venue-page-shared";

// Top-level route OUTSIDE the (main) route group on purpose — that means
// no bottom nav, no max-w-md shell wrapper. The detail screen handles
// its own layout so the hero can be full-bleed and the sticky CTA bar
// pins to the viewport.
//
// DYNAMIC twin of /anon/venue/[slug]: this route reads the auth cookie and
// renders the full signed-in page. Cookie-less traffic never reaches it —
// the middleware rewrites those requests to the ISR-cached /anon twin.
// Shared implementation lives in venue-page-shared.tsx (one source for
// both routes).

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const params = await props.params;
  return buildVenueMetadata(params.slug);
}

export default async function VenuePage(props: {
  params: Promise<{ slug: string }>;
}) {
  const params = await props.params;
  const authUser = await getAuthUser();
  return <VenuePageBody slug={params.slug} signedIn={!!authUser} />;
}
