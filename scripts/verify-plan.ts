// Stage 4.1 proof — does the user's taste actually change Plan My Night?
// Builds the same night WITHOUT taste (vibe/quality only) and WITH the user's
// taste scores, and shows the difference. Read-only.
//
//   pnpm verify-plan
//
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createServiceClient } from "@/lib/supabase/admin";
import { tasteScoresForUser } from "@/lib/taste-feed";
import { computePlan, type PlanVibe, type PlanBudget } from "@/lib/plan-engine";
import type { Venue } from "@/lib/types";

async function main() {
  const sb = createServiceClient();
  if (!sb) { console.error("no service client"); process.exit(1); }

  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("venues")
      .select("id, name, type, vibe, vibe_tags, neighbourhood, price, time_of_day, rating, lat, lng, opening_hours")
      .is("hidden_at", null).not("google_place_id", "is", null).neq("img_url", "")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  // Minimal Venue shape — the engine only reads these fields.
  const venues = rows.map((r) => ({
    id: r.id, name: r.name, type: r.type, vibe: r.vibe ?? "", vibeTags: r.vibe_tags ?? [],
    neighbourhood: r.neighbourhood ?? "", price: r.price ?? "££", timeOfDay: r.time_of_day ?? "Evening",
    rating: r.rating ?? 0, lat: r.lat, lng: r.lng, openingHours: r.opening_hours ?? null,
  })) as unknown as Venue[];

  // Most-active user (founder tap-test account).
  const { data: ev } = await sb.from("user_events").select("user_id");
  const tally = new Map<string, number>();
  for (const e of (ev ?? []) as { user_id: string }[]) tally.set(e.user_id, (tally.get(e.user_id) ?? 0) + 1);
  const userId = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0];
  const ts = userId ? await tasteScoresForUser(userId) : null;
  console.log(`${venues.length} venues · user ${userId?.slice(0, 8)}… · taste=${ts ? "loaded" : "none"}\n`);

  const show = (label: string, plan: ReturnType<typeof computePlan>) => {
    console.log(`${label}  [${plan.daypart}] pool ${plan.poolStage}/${plan.poolSize} · ~${Math.round((plan.totalMins / 60) * 10) / 10}h`);
    for (const s of plan.steps)
      console.log(`   ${s.role.padEnd(7)} ${s.venue.name} (${s.venue.type}) · ${s.dwellMins}min`);
    console.log("");
  };

  const vibe: PlanVibe = "Chill";
  const budget: PlanBudget = "Any";
  for (const area of ["Soho", "Anywhere"]) {
    console.log(`━━ ${area} · ${vibe} (taste-aware) ━━`);
    show("DAY:    ", computePlan(venues, { area, vibe, budget, daypart: "day", tasteScores: ts }));
    show("EVENING:", computePlan(venues, { area, vibe, budget, daypart: "evening", tasteScores: ts }));
  }
}

main().catch((e) => { console.error("\nFATAL:", e); process.exit(1); });
