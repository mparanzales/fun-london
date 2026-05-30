import { fetchVenues } from "@/lib/queries";
import { getAuthUser } from "@/lib/auth";
import { PlanFlow } from "./plan-flow";
import { PlanTogetherCard } from "./plan-together-card";

export default async function PlanPage() {
  const [venues, authUser] = await Promise.all([fetchVenues(), getAuthUser()]);
  return (
    <div className="pt-4 pb-6">
      <PlanFlow venues={venues} authUserId={authUser?.id ?? null} />
      <PlanTogetherCard />
    </div>
  );
}
