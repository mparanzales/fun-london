// One-off backfill: find each existing reservable venue's OpenTable / Resy /
// SevenRooms reservation URL (via Gemini + Google Search) and store it as the
// priority booking link, so the Reserve picker can pre-fill date/time/party
// for the venues that were added before the discovery robot learned to do
// this. Idempotent: skips venues that already have a major-platform link.
//
// Run: pnpm exec tsx scripts/backfill-booking-links.ts [--dry-run]

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import type { BookingLink } from "@/lib/types";

const DRY_RUN = process.argv.includes("--dry-run");
const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!GEMINI_API_KEY || !SUPABASE_URL || (!SERVICE_KEY && !DRY_RUN)) {
  console.error("Missing GEMINI_API_KEY / SUPABASE creds in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const RESERVABLE = new Set([
  "Restaurant",
  "Bar",
  "Wine Bar",
  "Pub",
  "Listening Bar",
  "Live Music",
]);
const MAJOR = new Set(["opentable", "resy", "sevenrooms", "thefork"]);

async function findBookingLink(
  name: string,
  area: string,
): Promise<{ platform: BookingLink["platform"]; url: string } | null> {
  const prompt =
    `Using Google Search, find the direct online reservation page for the ` +
    `London venue "${name}" in ${area} on OpenTable, Resy, or SevenRooms. ` +
    `Reply ONLY with the single reservation URL, or "none".`;
  try {
    let res: Response | null = null;
    // Free-tier grounding is rate-limited; back off and retry on 429.
    for (let attempt = 0; attempt < 4; attempt++) {
      res = await fetch(GEMINI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
        }),
      });
      if (res.status === 429) {
        await sleep(20000);
        continue;
      }
      break;
    }
    if (!res || !res.ok) {
      console.error(`  gemini ${res?.status ?? "no-response"}`);
      return null;
    }
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text =
      data.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? "")
        .join("") ?? "";
    const m = text.match(/https?:\/\/[^\s"')]+/);
    if (!m) return null;
    const url = m[0].replace(/[.,)]+$/, "");
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host.includes("opentable")) return { platform: "opentable", url };
    if (host.includes("resy")) return { platform: "resy", url };
    if (host.includes("sevenrooms")) return { platform: "sevenrooms", url };
    return null;
  } catch {
    return null;
  }
}

async function main() {
  const { data, error } = await supabase
    .from("venues")
    .select("id,slug,name,type,neighbourhood,website_url,booking_links")
    .not("google_place_id", "is", null);
  if (error) throw new Error(error.message);

  const venues = (data ?? []).filter((v) => RESERVABLE.has(v.type as string));
  console.log(
    `Backfill booking links · ${venues.length} reservable venues · ${DRY_RUN ? "DRY RUN" : "WRITING"}\n`,
  );

  let updated = 0;
  let skipped = 0;
  let none = 0;

  for (const v of venues) {
    const links = (v.booking_links as BookingLink[] | null) ?? [];
    if (links.some((l) => MAJOR.has(l.platform))) {
      skipped++;
      continue;
    }
    const found = await findBookingLink(
      v.name as string,
      (v.neighbourhood as string) ?? "London",
    );
    await sleep(4500);
    if (!found) {
      console.log(`  – ${v.name}: no OpenTable/Resy found`);
      none++;
      continue;
    }
    const website = v.website_url as string | null;
    const newLinks: BookingLink[] = [
      { platform: found.platform, url: found.url, priority: 1 },
      ...(website ? [{ platform: "website" as const, url: website, priority: 99 }] : []),
    ];
    console.log(`  ✓ ${v.name}: ${found.platform} → ${found.url}`);
    if (!DRY_RUN) {
      const { error: upErr } = await supabase
        .from("venues")
        .update({ booking_links: newLinks })
        .eq("id", v.id);
      if (upErr) console.error(`    ✗ update failed: ${upErr.message}`);
    }
    updated++;
  }

  console.log(
    `\nSUMMARY · ${DRY_RUN ? "would update" : "updated"}: ${updated} · already had platform: ${skipped} · none found: ${none}`,
  );
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
