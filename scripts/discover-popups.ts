// Fun London — Pop-up radar: autonomous London pop-up discovery (Gemini, free).
//
// Sibling to scripts/discover-venues.ts, but for TEMPORARY things — supper
// clubs, chef residencies, temporary bars, immersive shows, art installations,
// seasonal markets, brand/retail pop-ups. Pop-ups are stored as rows in
// public.events with source='popup' and an ends_at run date, so they reuse the
// events read path + auto-expire when their run is over.
//
// Pipeline per run (unattended, GitHub Actions every 4h):
//   1. DISCOVER  — Gemini 2.5 Flash + built-in Google Search grounding returns
//      current/upcoming London pop-ups with dates, location, category, link,
//      and which publications cover each.
//   2. GUARDRAIL — keep only pop-ups a REPUTABLE EDITORIAL publication actually
//      covers (a fresh per-candidate grounding check, >= 1 trusted source).
//      This is what stops a "wide" scope from filling up with marketing PR.
//   3. PUBLISH   — upsert to public.events (source='popup') with starts_at/
//      ends_at, idempotent on (source, source_id).
//   4. EXPIRE    — delete pop-up rows whose run has ended (housekeeping; the
//      read path already hides them, this just keeps the table tidy).
//
// All-Google + free: one Gemini key (GEMINI_API_KEY), shared with the venue
// robot's free daily quota — so keep TARGET modest and the crons offset.
//
// Run:
//   pnpm discover-popups:dry            # no DB writes, just print what it found
//   pnpm discover-popups                # auto-publish
//   pnpm discover-popups -- --limit=3   # cap target (for testing)

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { realVenuePhoto } from "./places-photo";
import { makeRow, isDuplicate, type DedupeRow } from "./event-dedupe";
import type { EventCategory } from "@/lib/types";

const DRY_RUN = process.argv.includes("--dry-run");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
// Modest per-run target: the cron fires 6x/day and shares the Gemini free
// daily quota with the venue robot, so trickle pop-ups through rather than
// draining the quota in one run.
const TARGET = limitArg ? Number(limitArg.split("=")[1]) : 5;
const MAX_CANDIDATES = 12; // bound Gemini calls: validate at most this many

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

for (const [k, v] of Object.entries({
  GEMINI_API_KEY,
  NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
})) {
  if (!v) {
    console.error(`Missing ${k} in env`);
    process.exit(1);
  }
}
if (!SUPABASE_SERVICE_ROLE_KEY && !DRY_RUN) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY (required for writes).");
  process.exit(1);
}

const supabase =
  SUPABASE_SERVICE_ROLE_KEY && SUPABASE_URL
    ? createSupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      })
    : null;

// ── Guardrail: the publications that count toward "recognised by reputable
// sources". Pop-ups skew newer than restaurants, so the bar is >= 1 (vs the
// venue robot's 2), but it MUST be editorial coverage, not the brand's own PR.
const TRUSTED_PUBLICATIONS = [
  "Time Out",
  "The Infatuation",
  "Eater London",
  "Hot Dinners",
  "Square Meal",
  "Harden's",
  "Londonist",
  "Secret London",
  "The Guardian",
  "Evening Standard",
  "Condé Nast Traveller",
  "DesignMyNight",
  "Resident Advisor",
  "The Nudge",
];

const CATEGORIES: EventCategory[] = ["Music", "Food", "Art", "Comedy", "Club"];

// Real images only. A pop-up must carry its OWN promo image — the official
// page's og:image, mirrored to Supabase Storage — to be published. We used to
// fall back to per-category Unsplash stock photos, but a generic photo that
// isn't the event is a wrong "fact" against the cross-checked promise, and it
// made unrelated pop-ups share the same image. A pop-up with no real,
// mirrorable image is now SKIPPED, not published (see the build loop below).

// ── Gemini (discovery + validation via Google Search grounding) ────────────
// Pacing + retry mirrors scripts/discover-venues.ts (free-tier safe).

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
const GEMINI_MIN_GAP_MS = 4500;
const GEMINI_MAX_RETRIES = 4;
let lastGeminiAt = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function geminiFetch(body: unknown): Promise<Response> {
  let attempt = 0;
  for (;;) {
    const since = Date.now() - lastGeminiAt;
    if (since < GEMINI_MIN_GAP_MS) await sleep(GEMINI_MIN_GAP_MS - since);
    lastGeminiAt = Date.now();
    const res = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (
      (res.status === 429 || res.status === 503) &&
      attempt < GEMINI_MAX_RETRIES
    ) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const backoff =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : GEMINI_MIN_GAP_MS * Math.pow(2, attempt);
      console.log(
        `    ⏳ Gemini ${res.status} — backing off ${Math.round(backoff / 1000)}s (retry ${attempt + 1}/${GEMINI_MAX_RETRIES})`,
      );
      await sleep(backoff);
      attempt++;
      continue;
    }
    return res;
  }
}

function geminiText(data: unknown): string {
  const d = data as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  return (
    d.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? ""
  );
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced ? fenced[1] : text).trim();
  const start = raw.search(/[[{]/);
  if (start === -1) return null;
  // Trim to the matching end bracket region; JSON.parse tolerates trailing prose
  // only if we slice from the first bracket, so try the whole tail then shrink.
  const tail = raw.slice(start);
  try {
    return JSON.parse(tail);
  } catch {
    const lastArr = tail.lastIndexOf("]");
    const lastObj = tail.lastIndexOf("}");
    const end = Math.max(lastArr, lastObj);
    if (end > 0) {
      try {
        return JSON.parse(tail.slice(0, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

type RawPopup = {
  name?: string;
  blurb?: string;
  category?: string;
  venue?: string;
  neighbourhood?: string;
  start_date?: string;
  end_date?: string;
  price?: string;
  url?: string;
};

// Ask Gemini (grounded in Google Search) for pop-ups happening now / soon.
async function discoverPopups(): Promise<RawPopup[]> {
  const prompt =
    `Using Google Search, list independent or culturally notable POP-UPS in ` +
    `London that are running now or opening within the next 8 weeks. Include ` +
    `temporary/limited-time things only: supper clubs, chef residencies, ` +
    `temporary restaurants and bars, immersive experiences, art installations ` +
    `and exhibitions, seasonal or one-off markets, and design/fashion/retail ` +
    `pop-ups. Prefer ones covered by London press (Time Out, The Infatuation, ` +
    `Hot Dinners, Eater, Londonist, Secret London, Evening Standard, ` +
    `Resident Advisor, DesignMyNight). For each, reply with an object: ` +
    `{"name","blurb" (one honest sentence),"category" (one of ` +
    `Music/Food/Art/Comedy/Club),"venue" (host venue or location),` +
    `"neighbourhood","start_date" (YYYY-MM-DD),"end_date" (YYYY-MM-DD, the last ` +
    `day it runs),"price" (e.g. Free or "From £15"),"url" (official link)}. ` +
    `Reply ONLY with a JSON array of up to 15 such objects, no prose.`;
  const res = await geminiFetch({
    contents: [{ parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
  });
  if (!res.ok) throw new Error(`Gemini discover ${res.status}`);
  const parsed = extractJson(geminiText(await res.json()));
  return Array.isArray(parsed) ? (parsed as RawPopup[]) : [];
}

type Source = { publication: string; url: string };

// Independently confirm (fresh grounding) that >= 1 trusted publication really
// covers this pop-up. The integrity gate — discovery claims aren't trusted on
// their own (avoids hallucinated or pure-PR pop-ups).
async function validatePopup(name: string, where: string): Promise<Source[]> {
  const prompt =
    `Using Google Search, which of these publications have a genuine article, ` +
    `review, or listing for the London pop-up "${name}" (${where}): ` +
    `${TRUSTED_PUBLICATIONS.join(", ")}. Only include a publication if you ` +
    `actually find its page for THIS pop-up. Reply ONLY with a JSON array of ` +
    `{"publication","url"} — no prose.`;
  const res = await geminiFetch({
    contents: [{ parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
  });
  if (!res.ok) throw new Error(`Gemini validate ${res.status}`);
  const parsed = extractJson(geminiText(await res.json()));
  if (!Array.isArray(parsed)) return [];
  const known = new Set(TRUSTED_PUBLICATIONS.map((p) => p.toLowerCase()));
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const s of parsed as Source[]) {
    const pub = (s?.publication ?? "").trim();
    const url = (s?.url ?? "").trim();
    if (!pub || !url.startsWith("http")) continue;
    if (!known.has(pub.toLowerCase()) || seen.has(pub.toLowerCase())) continue;
    seen.add(pub.toLowerCase());
    out.push({ publication: pub, url });
  }
  return out;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function normCategory(c: string | undefined): EventCategory {
  const v = (c ?? "").toLowerCase();
  if (/(music|gig|dj|jazz|band|live)/.test(v)) return "Music";
  if (/(club|party|rave|disco|dance)/.test(v)) return "Club";
  if (/(comedy|stand.?up)/.test(v)) return "Comedy";
  if (/(food|drink|dining|restaurant|supper|bar|wine|market|tasting)/.test(v))
    return "Food";
  // art / immersive / exhibition / installation / design / fashion / retail
  return CATEGORIES.includes(c as EventCategory) ? (c as EventCategory) : "Art";
}

// Parse a YYYY-MM-DD (tolerant) to a UTC Date at a given hour, or null.
function parseDate(s: string | undefined, hour: number): Date | null {
  if (!s) return null;
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hour, 0, 0),
  );
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtDay(d: Date): string {
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Europe/London",
  });
}

// Pop-up date label for the Events date pills. Never "Tonight" (pop-ups are
// multi-day). "This Weekend" if the run ends on the coming Sat/Sun, else
// "This Week".
function popupDateLabel(end: Date, today: Date): "This Weekend" | "This Week" {
  const days = Math.ceil((end.getTime() - today.getTime()) / 86_400_000);
  const dow = end.getUTCDay(); // 0 Sun .. 6 Sat
  if (days <= 7 && (dow === 0 || dow === 6)) return "This Weekend";
  return "This Week";
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log(
    `Fun London — pop-up radar · target ${TARGET} · ${DRY_RUN ? "DRY RUN" : "AUTO-PUBLISH"}\n`,
  );

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // Existing pop-up source_ids + normalized name keys (dedupe) — only when we
  // have DB access. The name key catches NEAR-duplicates the source_id misses
  // (e.g. "Citizens of Soil" vs "Citizens of Soil's", "X" vs "X by Y") that
  // discovery surfaces under slightly different names across runs.
  const existing = new Set<string>();
  const existingRows: DedupeRow[] = [];
  if (supabase) {
    const { data } = await supabase
      .from("events")
      .select("source_id, name, venue_name, starts_at, ends_at")
      .eq("source", "popup");
    for (const r of data ?? []) {
      if (r.source_id) existing.add(r.source_id as string);
      if (r.name)
        existingRows.push(
          makeRow(
            r.name as string,
            (r.venue_name as string) ?? "",
            (r.starts_at as string) ?? null,
            (r.ends_at as string) ?? null,
          ),
        );
    }
  }

  let candidates: RawPopup[] = [];
  try {
    candidates = await discoverPopups();
  } catch (e) {
    console.error(`Discovery failed: ${(e as Error).message}`);
  }
  console.log(`Discovered ${candidates.length} candidate pop-up(s).\n`);

  const published: { name: string; ends: string; sources: string }[] = [];
  let scanned = 0;

  for (const c of candidates) {
    if (published.length >= TARGET || scanned >= MAX_CANDIDATES) break;
    const name = (c.name ?? "").trim();
    const neighbourhood = (c.neighbourhood ?? "London").trim();
    const venue = (c.venue ?? neighbourhood).trim();
    if (!name) continue;

    const start = parseDate(c.start_date, 12) ?? today;
    const end = parseDate(c.end_date, 22) ?? start; // single-day fallback
    // Skip anything whose run is already over.
    if (end.getTime() < today.getTime()) {
      console.log(`  ⊘ over: ${name}`);
      continue;
    }

    const source_id = `popup-${slugify(name)}-${slugify(neighbourhood)}`.slice(
      0,
      120,
    );
    if (existing.has(source_id)) {
      console.log(`  ↺ already have: ${name}`);
      continue;
    }
    const candRow = makeRow(name, venue, start.toISOString(), end.toISOString());
    if (isDuplicate(candRow, existingRows)) {
      console.log(`  ↺ duplicate of an existing pop-up: ${name}`);
      continue;
    }
    existingRows.push(candRow);
    scanned++;

    // Guardrail: must be recognised by >= 1 trusted publication.
    let sources: Source[] = [];
    try {
      sources = await validatePopup(name, `${venue}, ${neighbourhood}`);
    } catch (e) {
      console.error(`  ✗ validate ${name}: ${(e as Error).message}`);
      continue;
    }
    if (sources.length < 1) {
      console.log(`  ✗ ${name}: no trusted source found`);
      continue;
    }

    const category = normCategory(c.category);
    const officialUrl = (c.url ?? "").trim() || null;

    // Image: the event's VENUE photo from Google Places, mirrored keyless to
    // Storage — the real place, never a brand logo (og:image was the logo
    // source). No real venue photo → NOT published (the read-side img_url<>''
    // filter would hide it anyway, and a wrong photo breaks the cross-checked
    // promise). Dry runs can't mirror, so the skip is enforced on real writes.
    let imgUrl: string | null = null;
    if (!DRY_RUN && supabase) {
      imgUrl = await realVenuePhoto(venue, neighbourhood, source_id, supabase);
    }
    if (!imgUrl && !DRY_RUN) {
      console.log(`  ✗ ${name}: no real venue photo, skipping (not published)`);
      continue;
    }

    const row = {
      name,
      venue_name: venue,
      venue_id: null,
      area: neighbourhood,
      date_label: popupDateLabel(end, today),
      time_label: `Until ${fmtDay(end)}`,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      price: (c.price ?? "See site").trim() || "See site",
      category,
      img_url: imgUrl,
      source: "popup",
      source_id,
      source_url: officialUrl,
      description: (c.blurb ?? "").trim() || null,
      last_synced_at: new Date().toISOString(),
      sold_out: false,
    };

    if (DRY_RUN) {
      console.log(
        `  ✅ [dry] ${name} — ${venue}, ${neighbourhood} · ${row.date_label} · ${row.time_label} · ${sources.map((s) => s.publication).join(", ")}`,
      );
      published.push({
        name,
        ends: fmtDay(end),
        sources: sources.map((s) => s.publication).join(", "),
      });
      continue;
    }
    if (!supabase) continue;
    const { error } = await supabase
      .from("events")
      .upsert(row, { onConflict: "source,source_id" });
    if (error) {
      console.error(`  ✗ upsert ${name}: ${error.message}`);
    } else {
      console.log(
        `  ✅ published ${name} (ends ${fmtDay(end)}) — ${sources.map((s) => s.publication).join(", ")}`,
      );
      published.push({
        name,
        ends: fmtDay(end),
        sources: sources.map((s) => s.publication).join(", "),
      });
    }
  }

  // Expire: remove pop-ups whose run has ended (read path already hides them).
  let expired = 0;
  if (supabase && !DRY_RUN) {
    const { data, error } = await supabase
      .from("events")
      .delete()
      .eq("source", "popup")
      .lt("ends_at", today.toISOString())
      .select("id");
    if (error) console.error(`  ✗ expire pass: ${error.message}`);
    else expired = data?.length ?? 0;
  }

  // Heads-up SUMMARY (the GitHub Actions step renders this block for the maintainer).
  console.log("\n─────────── SUMMARY ───────────");
  console.log(`Examined:  ${scanned} candidate(s)`);
  console.log(
    `${DRY_RUN ? "Would publish" : "Published"}: ${published.length} pop-up(s)`,
  );
  for (const p of published)
    console.log(`  • ${p.name} (ends ${p.ends}) — ${p.sources}`);
  if (!DRY_RUN) console.log(`Expired/removed: ${expired}`);
  console.log(`\n${DRY_RUN ? "Dry run complete." : "Pop-up radar complete."}`);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
