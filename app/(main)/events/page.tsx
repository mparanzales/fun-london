import { fetchEvents } from "@/lib/queries";
import type { DateLabel, Event } from "@/lib/types";
import { EventsFeed } from "./events-feed";

// Force dynamic so the header date + smart default filter stay fresh
// across midnight rather than getting baked into a static build.
export const dynamic = "force-dynamic";

// Server-side picks the first date-filter chip that actually has
// events under it. Keeps the user from landing on an empty "Nothing
// matches that filter" page when the data is sparse (e.g. early days
// of Tier 3 when only a handful of "This Week" events have been
// ingested).
function defaultDateFilter(events: Event[]): DateLabel {
  const order: DateLabel[] = ["Tonight", "This Weekend", "This Week"];
  for (const f of order) {
    if (events.some((e) => e.dateLabel === f)) return f;
  }
  return "Tonight";
}

// "Friday 29 May" — Europe/London tz so the date the user reads matches
// the city in the brand.
function todayInLondon(): string {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return fmt.format(new Date());
}

export default async function EventsPage() {
  const events = await fetchEvents();
  return (
    <EventsFeed
      events={events}
      initialDateFilter={defaultDateFilter(events)}
      todayLabel={todayInLondon()}
    />
  );
}
