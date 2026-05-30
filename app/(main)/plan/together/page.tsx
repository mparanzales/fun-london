import { fetchVenues, fetchProfile } from "@/lib/queries";
import { getAuthUser } from "@/lib/auth";
import { TogetherFlow } from "./together-flow";

// Auth-aware (reads cookies for the display name) so render dynamically.
export const dynamic = "force-dynamic";

export default async function PlanTogetherPage() {
  const authUser = await getAuthUser();
  const [venues, profile] = await Promise.all([
    fetchVenues(),
    authUser ? fetchProfile(authUser.id) : Promise.resolve(null),
  ]);
  const myName =
    profile?.displayName ?? authUser?.email?.split("@")[0] ?? "Guest";
  return <TogetherFlow venues={venues} myName={myName} />;
}
