import type { Metadata } from "next";
import { getAuthUser } from "@/lib/auth";
import { buildEventMetadata, EventPageBody } from "./event-page-shared";

// DYNAMIC twin of /anon/event/[id]: reads the auth cookie, full data
// signed-in. Cookie-less traffic is rewritten to the ISR twin by the
// middleware. Shared implementation lives in event-page-shared.tsx.

// Force dynamic so changes from the events ingest cron show up
// immediately for signed-in users (no static cache on THIS route; the
// anon twin accepts 15-minute staleness for cacheability).
export const dynamic = "force-dynamic";

export async function generateMetadata(props: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const params = await props.params;
  return buildEventMetadata(params.id);
}

export default async function EventDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const params = await props.params;
  const authUser = await getAuthUser();
  return <EventPageBody id={params.id} signedIn={!!authUser} />;
}
