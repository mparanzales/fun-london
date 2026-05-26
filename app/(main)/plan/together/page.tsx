import { fetchVenues } from "@/lib/queries";
import { TogetherFlow } from "./together-flow";

export default async function PlanTogetherPage() {
  const venues = await fetchVenues();
  return <TogetherFlow venues={venues} />;
}
