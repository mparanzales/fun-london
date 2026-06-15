import { fetchEvents, fetchEventCategoryPreview } from "@/lib/queries";
import { getAuthUser } from "@/lib/auth";
import { EventsFeed, PREVIEW_COUNT } from "./events-feed";

// Force dynamic so the header date stays fresh across midnight rather
// than getting baked into a static build at deploy time.
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
    : await fetchEventCategoryPreview(PREVIEW_COUNT);
  return (
    <EventsFeed
      events={events}
      todayLabel={todayInLondon()}
      signedIn={!!authUser}
    />
  );
}
