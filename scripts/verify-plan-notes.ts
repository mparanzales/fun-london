// Show the Stage 4.3 "why this stop" pipeline end-to-end on recognisable venues
// so a human can judge it: the SOURCE review → Gemini's line → does it pass the
// groundedness gate. Read-only, no writes.
//
//   pnpm verify-plan-notes
//
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import type { VenueReview } from "@/lib/types";
import { pickReviewSnippet, buildPlanNotePrompt, isGrounded, MAX_NOTE_CHARS } from "@/lib/plan-note";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error("Missing GEMINI_API_KEY"); process.exit(1); }
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${KEY}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let last = 0;
async function gemini(prompt: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const gap = Date.now() - last;
    if (gap < 4500) await sleep(4500 - gap);
    last = Date.now();
    const res = await fetch(GEMINI_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
    if ((res.status === 429 || res.status === 503) && attempt < 4) { await sleep(4500 * 2 ** attempt); continue; }
    if (!res.ok) return `(gemini ${res.status})`;
    const d = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    return d.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  }
}
const clean = (raw: string) =>
  (raw.split("\n").find((l) => l.trim().length > 0) ?? "").trim().replace(/^["'“”]+|["'“”]+$/g, "").replace(/\s+/g, " ").slice(0, MAX_NOTE_CHARS).trim();

const WANT = ["Zuma", "Monmouth Coffee", "Artesian", "Ronnie Scott", "Lighterman", "BiBi", "Hoppers", "Spiritland", "Dishoom Shoreditch", "Bao Soho"];

async function main() {
  const orFilter = WANT.map((w) => `name.ilike.%${w}%`).join(",");
  const { data, error } = await sb
    .from("venues").select("id, name, type, neighbourhood, reviews")
    .is("hidden_at", null).or(orFilter);
  if (error) { console.error(error.message); process.exit(1); }

  for (const v of (data ?? []) as { name: string; type: string; neighbourhood: string | null; reviews: VenueReview[] | null }[]) {
    const snippet = pickReviewSnippet(v.reviews);
    console.log(`■ ${v.name} (${v.type})`);
    if (!snippet) { console.log(`   (no review clears the bar → no note)\n`); continue; }
    const venue = { name: v.name, type: v.type, neighbourhood: v.neighbourhood ?? "London" };
    const note = clean(await gemini(buildPlanNotePrompt(venue, snippet)));
    const ok = !!note && isGrounded(note, snippet, venue);
    console.log(`   review (${snippet.rating}★): "${snippet.text.trim().slice(0, 200).replace(/\s+/g, " ")}…"`);
    console.log(`   GEMINI:  "${note}"`);
    console.log(`   gate:    ${ok ? "✅ PASS — would store" : "❌ REJECT — skipped, no note stored"}\n`);
  }
}
main().catch((e) => { console.error("\nFATAL:", e); process.exit(1); });
