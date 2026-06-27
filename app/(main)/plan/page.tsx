import { fetchVenues } from "@/lib/queries";
import { getAuthUser } from "@/lib/auth";
import { PlanFlow } from "./plan-flow";
import { PlanTogetherCard } from "./plan-together-card";
import { AuthWall } from "@/components/auth-wall";

export default async function PlanPage() {
  const authUser = await getAuthUser();
  // Anonymous visitors hit the AuthWall and can't build a plan. Never ship them
  // the full catalogue: fetchVenues() is the full select-* row INCLUDING moat
  // fields, which would otherwise serialize into the anonymous RSC payload
  // behind only a CSS blur.
  const venues = authUser ? await fetchVenues() : [];
  return (
    <div className="pt-4 pb-6">
      <PlanFlow venues={venues} authUserId={authUser?.id ?? null} />
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
