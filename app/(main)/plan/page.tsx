import { fetchPlanVenues } from "@/lib/queries";
import { tasteScoresForUser } from "@/lib/taste-feed";
import { getAuthUser } from "@/lib/auth";
import { PlanFlow } from "./plan-flow";
import { PlanTogetherCard } from "./plan-together-card";
import { AuthWall } from "@/components/auth-wall";

export default async function PlanPage() {
  const authUser = await getAuthUser();
  // Anonymous visitors hit the AuthWall and can't build a plan, so never ship
  // them the catalogue at all. Signed-in users get the LEAN plan catalogue
  // (fetchPlanVenues) — only the columns the engine reads + the cards render,
  // never the heavy moat fields (reviews, long_description, …) that the old
  // fetchVenues select-* serialized into the RSC payload for ~2,100 rows.
  const venues = authUser ? await fetchPlanVenues() : [];
  // Taste scores computed server-side (the client engine can't read the
  // service-role embeddings) and handed to the planner as a venueId→score map.
  const tasteScores = authUser ? await tasteScoresForUser(authUser.id) : null;
  return (
    <div className="pt-4 pb-6">
      <PlanFlow
        venues={venues}
        authUserId={authUser?.id ?? null}
        tasteScores={tasteScores}
      />
      <PlanTogetherCard />
      <AuthWall
        signedIn={!!authUser}
        title="Sign up to plan your night"
        mainShell
        backHref="/explore"
      />
    </div>
  );
}
