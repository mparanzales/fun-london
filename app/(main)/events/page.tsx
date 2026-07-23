import { fetchEvents, fetchEventCategoryPreview } from "@/lib/queries";
import { getAuthUser } from "@/lib/auth";
import { EventsFeed } from "./events-feed";
import { ANON_BROWSE_MAX } from "@/lib/feed-constants";

// Force dynamic so the header date stays fresh across midnight, and because the
// signed-in vs anonymous payloads differ. fetchEvents() reads cookies (the
// per-request Supabase client), so it must NOT be wrapped in unstable_cache:
// doing so threw a Next.js "cookies inside unstable_cache" render error and
// took /events down (regression from #77).
export const dynamic = "force-dynamic";

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
    ? await fetchEvents()
    : await fetchEventCategoryPreview(ANON_BROWSE_MAX);
  return (
    <EventsFeed
      events={events}
      todayLabel={todayInLondon()}
      signedIn={!!authUser}
    />
  );
}
