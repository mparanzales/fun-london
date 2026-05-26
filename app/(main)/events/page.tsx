import { fetchEvents } from "@/lib/queries";
import { EventsFeed } from "./events-feed";

export default async function EventsPage() {
  const events = await fetchEvents();
  return <EventsFeed events={events} />;
}
