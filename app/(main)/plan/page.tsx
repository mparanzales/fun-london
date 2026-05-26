import { PlanFlow } from "./plan-flow";
import { PlanTogetherCard } from "./plan-together-card";

export default function PlanPage() {
  return (
    <div className="pt-4 pb-6">
      <PlanFlow />
      <PlanTogetherCard />
    </div>
  );
}
