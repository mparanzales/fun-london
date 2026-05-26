import { fetchVenues, fetchEvents } from "@/lib/queries";
import { ExploreFeed } from "./explore-feed";

// Server Component: fetches the catalog from Supabase and hands it to the
// (client) ExploreFeed which holds filter state. Parallel fetches via
// Promise.all keep the round-trips overlapped.

export default async function ExplorePage() {
  const [venues, events] = await Promise.all([fetchVenues(), fetchEvents()]);
  return <ExploreFeed venues={venues} events={events} />;
}
