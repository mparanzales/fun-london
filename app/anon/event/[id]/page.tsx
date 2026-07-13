import type { Metadata } from "next";
import {
  buildEventMetadata,
  EventPageBody,
} from "@/app/event/[id]/event-page-shared";

// ISR twin of /event/[id] for COOKIE-LESS traffic — see
// app/anon/venue/[slug]/page.tsx for the full pattern notes. Browser URL
// stays /event/[id] (middleware rewrite); canonical points there too.

// 15-minute background revalidation. Trade-off accepted: ingest-cron
// changes and cancellations take ≤15 min to reach signed-out visitors
// (signed-in stays force-dynamic on the primary route).
export const revalidate = 900;

// Registers the route as ISR-capable without baking any paths at build.
// See app/anon/venue/[slug]/page.tsx for the full rationale.
export function generateStaticParams() {
  return [];
}

export async function generateMetadata(props: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const params = await props.params;
  return buildEventMetadata(params.id);
}

export default async function AnonEventPage(props: {
  params: Promise<{ id: string }>;
}) {
  const params = await props.params;
  return <EventPageBody id={params.id} signedIn={false} />;
}
