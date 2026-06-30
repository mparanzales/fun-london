import { unstable_cache } from "next/cache";
import { fetchEvents, fetchEventCategoryPreview } from "@/lib/queries";
import { getAuthUser } from "@/lib/auth";
import { EventsFeed, PREVIEW_COUNT } from "./events-feed";

// Force dynamic so the header date stays fresh across midnight (and because the
// signed-in vs anonymous payloads differ) rather than getting baked into a
// static build at deploy time. The signed-in catalogue read carries no user
// data, so it's cached across requests (5-min TTL) via unstable_cache — the
// page stays dynamic while the heavy DB work is shared.
export const dynamic = "force-dynamic";

const cachedEvents = unstable_cache(() => fetchEvents(), ["events-page-all"], {
  revalidate: 300,
});

// "Friday 29 May" — Europe/London tz so the date the user reads matches
// the city in the brand.
function todayInLondon(): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
}

export default async function EventsPage() {
  const authUser = await getAuthUser();
  // Anonymous visitors get only a trimmed, metered preview — never the full
  // events catalogue in the RSC payload (mirrors /explore).
  const events = authUser
    ? await cachedEvents()
    : await fetchEventCategoryPreview(PREVIEW_COUNT);
  return (
    <EventsFeed
      events={events}
      todayLabel={todayInLondon()}
      signedIn={!!authUser}
    />
  );
}
