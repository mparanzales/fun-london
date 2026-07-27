import { fetchPlanVenues, fetchAllVenueCards } from "@/lib/queries";
import { tasteScoresForUser } from "@/lib/taste-feed";
import { getAuthUser } from "@/lib/auth";
import { PlanFlow } from "./plan-flow";
import { AnonPlanFlow } from "./anon-plan-flow";
import { PlanTogetherCard } from "./plan-together-card";

export default async function PlanPage() {
  const authUser = await getAuthUser();

  if (!authUser) {
    // Signed out: build one real night, free. Until 2026-07-27 this branch
    // shipped an empty array under the app's only NON-dismissible wall — the
    // tab carrying "plan the night, not the place" was a locked door over
    // nothing (gate review: persona-panel, ux-critic and coach all converged
    // on this as the structural inversion — commodity previewed,
    // differentiator gated). The engine runs SERVER-SIDE for anon
    // (lib/plan-preview.ts, moat) — the client below never sees the
    // catalogue, only area options derived from a public card column. This
    // fetch runs as the anon role and its rows never serialize to the
    // client; only the tiny counts array does.
    const cards = await fetchAllVenueCards();
    const counts = new Map<string, number>();
    for (const v of cards) {
      const n = v.neighbourhood?.trim();
      if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    const neighbourhoods = [...counts]
      .map(([name, n]) => ({ name, n }))
      .sort((a, b) => b.n - a.n);
    return (
      <div className="pt-4 pb-6">
        <div className="px-5 pt-4 pb-1">
          <h1 className="text-[28px] font-extrabold tracking-tight text-heading m-0">
            Plan your night
          </h1>
          <p className="text-[13px] text-muted-fg mt-1 mb-0">
            Two or three spots, a short walk apart, in the order you&apos;d do
            them. Try one, no account needed.
          </p>
        </div>
        <AnonPlanFlow neighbourhoods={neighbourhoods} />
        <PlanTogetherCard />
      </div>
    );
  }

  // Signed in: the LEAN plan catalogue (fetchPlanVenues) — only the columns
  // the engine reads + the cards render, never the heavy moat fields
  // (reviews, long_description, …) that the old fetchVenues select-*
  // serialized into the RSC payload for ~2,100 rows.
  const venues = await fetchPlanVenues();
  // Taste scores computed server-side (the client engine can't read the
  // service-role embeddings) and handed to the planner as a venueId→score map.
  const tasteScores = await tasteScoresForUser(authUser.id);
  return (
    <div className="pt-4 pb-6">
      <PlanFlow
        venues={venues}
        authUserId={authUser.id}
        tasteScores={tasteScores}
      />
      <PlanTogetherCard />
    </div>
  );
}
