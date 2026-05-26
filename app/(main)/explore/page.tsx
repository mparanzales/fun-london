import { getAuthUser } from "@/lib/auth";
import { fetchVenues, fetchEvents, fetchProfile } from "@/lib/queries";
import { ExploreFeed } from "./explore-feed";

// Server Component: fetches the catalog from Supabase plus the auth
// user's profile (when signed in) and hands the greeting name to the
// (client) ExploreFeed. Parallel fetches via Promise.all keep
// round-trips overlapped.

export default async function ExplorePage() {
  const authUser = await getAuthUser();
  const [venues, events, profile] = await Promise.all([
    fetchVenues(),
    fetchEvents(),
    authUser ? fetchProfile(authUser.id) : Promise.resolve(null),
  ]);
  const greetingName =
    profile?.displayName ?? authUser?.email?.split("@")[0] ?? "there";
  return (
    <ExploreFeed venues={venues} events={events} greetingName={greetingName} />
  );
}
