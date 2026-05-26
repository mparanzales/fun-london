import { fetchVenues } from "@/lib/queries";
import { PlanFlow } from "./plan-flow";
import { PlanTogetherCard } from "./plan-together-card";

export default async function PlanPage() {
  const venues = await fetchVenues();
  return (
    <div className="pt-4 pb-6">
      <PlanFlow venues={venues} />
      <PlanTogetherCard />
    </div>
  );
}
