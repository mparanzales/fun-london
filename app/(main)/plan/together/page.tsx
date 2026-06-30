import { unstable_cache } from "next/cache";
import { fetchPlanVenues, fetchEvents, fetchProfile } from "@/lib/queries";
import { getAuthUser } from "@/lib/auth";
import { TogetherFlow } from "./together-flow";

// Auth-aware (reads cookies for the display name) so the page itself must stay
// dynamic. But the two catalogue reads carry NO user data, so we cache them
// across requests (5-min TTL) via unstable_cache — the slow DB work is shared
// while the page still renders per-user. The cached fns take no per-user args.
export const dynamic = "force-dynamic";

const cachedPlanVenues = unstable_cache(
  () => fetchPlanVenues(),
  ["together-plan-venues"],
  { revalidate: 300 },
);
const cachedEvents = unstable_cache(() => fetchEvents(), ["together-events"], {
  revalidate: 300,
});

export default async function PlanTogetherPage() {
  const authUser = await getAuthUser();
  const [venues, events, profile] = await Promise.all([
    cachedPlanVenues(),
    cachedEvents(),
    authUser ? fetchProfile(authUser.id) : Promise.resolve(null),
  ]);
  const myName =
    profile?.displayName ?? authUser?.email?.split("@")[0] ?? "Guest";
  return <TogetherFlow venues={venues} events={events} myName={myName} />;
}
