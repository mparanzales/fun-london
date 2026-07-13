import type { Metadata } from "next";
import {
  buildVenueMetadata,
  VenuePageBody,
} from "@/app/venue/[slug]/venue-page-shared";

// ISR twin of /venue/[slug] for COOKIE-LESS traffic (anon visitors, Google,
// link unfurlers) — the middleware rewrites those requests here, so the
// browser URL stays /venue/[slug] and canonicals/sitemap never change.
// No cookies are read anywhere in this render, which is what lets Next
// cache it; the moat holds because this page is built exclusively from the
// anon preview fetchers + the capped teaser (see venue-page-shared.tsx).
// Direct hits on /anon/venue/x are harmless: canonical points at /venue/x.

// Repeat anonymous hits serve from the CDN for 15 minutes, then revalidate
// in the background. Trade-off accepted: catalogue edits take ≤15 min to
// reach signed-out visitors.
export const revalidate = 900;

// Prerender ZERO paths at build (we don't want 2,000 pages baked into the
// bundle), but this export is what registers the route as ISR-capable:
// without it a dynamic [slug] segment renders on-demand and is NEVER cached,
// so `revalidate` above is inert. dynamicParams defaults to true, so any slug
// renders on first hit, then serves from the cache for the revalidate window.
export function generateStaticParams() {
  return [];
}

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const params = await props.params;
  return buildVenueMetadata(params.slug);
}

export default async function AnonVenuePage(props: {
  params: Promise<{ slug: string }>;
}) {
  const params = await props.params;
  return <VenuePageBody slug={params.slug} signedIn={false} />;
}
