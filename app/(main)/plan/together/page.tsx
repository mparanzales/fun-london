import { fetchPlanVenues, fetchEvents, fetchProfile } from "@/lib/queries";
import { getAuthUser } from "@/lib/auth";
import { TogetherFlow } from "./together-flow";

// Auth-aware (reads cookies for the display name) so the page must stay dynamic.
// The catalogue reads use the per-request Supabase client (cookies), so they are
// NOT wrapped in unstable_cache: doing so threw a Next.js "cookies inside
// unstable_cache" render error and took the page down (regression from #77).
export const dynamic = "force-dynamic";

export default async function PlanTogetherPage() {
  const authUser = await getAuthUser();
  const [venues, events, profile] = await Promise.all([
    fetchPlanVenues(),
    fetchEvents(),
    authUser ? fetchProfile(authUser.id) : Promise.resolve(null),
  ]);
  const myName =
    profile?.displayName ?? authUser?.email?.split("@")[0] ?? "Guest";
  return <TogetherFlow venues={venues} events={events} myName={myName} />;
}
