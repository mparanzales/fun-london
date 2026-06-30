// Stage 3 (pt B) proof — exercise the ACTUAL feed code path (lib/taste-feed.ts
// rankRowsByTaste) against prod: load the feed-eligible rows, rank them for the
// most-active real user, and print the head. Confirms the wiring (service-role
// index load + taste build + bounded MMR + fail-open) — not just the primitives.
//
//   pnpm verify-feed-rank
//
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createServiceClient } from "@/lib/supabase/admin";
import { rankRowsByTaste } from "@/lib/taste-feed";

type Row = { id: string; name: string; type: string; rating: number | null; review_count: number | null; curation_tier: string | null };

async function main() {
  const sb = createServiceClient();
  if (!sb) { console.error("no service client"); process.exit(1); }

  // Most-active user (the founder's tap-test account).
  const { data: ev } = await sb.from("user_events").select("user_id");
  const tally = new Map<string, number>();
  for (const e of (ev ?? []) as { user_id: string }[]) tally.set(e.user_id, (tally.get(e.user_id) ?? 0) + 1);
  const userId = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!userId) { console.log("no user_events"); return; }

  // Feed-eligible rows (same gate as getVenueIndex: visible, has place_id + photo).
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("venues")
      .select("id, name, type, rating, review_count, curation_tier")
      .is("hidden_at", null).not("google_place_id", "is", null).neq("img_url", "")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    rows.push(...(data as Row[]));
    if (data.length < 1000) break;
  }
  console.log(`user ${userId.slice(0, 8)}… · ${rows.length} feed-eligible venues\n`);

  const ranked = await rankRowsByTaste(userId, rows);
  if (!ranked) {
    console.log("rankRowsByTaste returned null → feed would fall back to default order.");
    return;
  }
  console.log("Top 12 of the personalised For You feed (via the real feed code path):");
  for (const r of ranked.slice(0, 12)) console.log(`   ${r.name} (${r.type})`);

  // Sanity: the order must differ from the raw (unranked) order.
  const movedTop = ranked[0].id !== rows[0].id;
  console.log(`\npersonalised order differs from default: ${movedTop ? "yes ✓" : "no ✗"}`);
}

main().catch((e) => { console.error("\nFATAL:", e); process.exit(1); });
