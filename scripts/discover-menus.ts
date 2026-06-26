// Discover a real MENU URL from each food venue's own website and store it in
// venues.menu_url, so the detail page's "See the menu" button links to an
// actual menu instead of the homepage.
//
// HONEST by design: menu_url is set ONLY when a real menu page/PDF is found.
// The UI shows "See the menu" -> menu_url when present, else "Visit website".
//
//   pnpm discover-menus:dry           # list what it WOULD set, no writes
//   pnpm discover-menus               # fetch + store
//   MENU_MAX=50 pnpm discover-menus   # cap the run (cost/time guardrail)
//
// No API key, no cost — just HTTP fetches of public homepages. JS-only or
// bot-blocked sites simply yield no link and keep "Visit website".

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { findMenuUrl } from "@/lib/menu-extract";

const DRY_RUN = process.argv.includes("--dry-run");
const MAX = Number(process.env.MENU_MAX ?? "0") || Infinity;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL in .env.local");
  process.exit(1);
}
if (!SERVICE_ROLE && !DRY_RUN) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE ?? "anon", {
  auth: { persistSession: false },
});

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Food-serving types where a menu makes sense.
const FOOD_TYPES = ["Restaurant", "Cafe", "Wine Bar", "Pub", "Listening Bar"];

async function fetchPage(
  url: string,
): Promise<{ html: string; finalUrl: string } | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": UA, accept: "text/html,*/*" },
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return null;
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("text/html") && !ct.includes("xml")) return null;
      const html = (await res.text()).slice(0, 600000);
      return { html, finalUrl: res.url || url };
    } catch {
      if (attempt === 0) await sleep(500); // one retry on a transient error
    }
  }
  return null;
}

async function main(): Promise<void> {
  console.log(DRY_RUN ? "DRY RUN (no writes)\n" : "");

  // Paginate past PostgREST's 1000-row cap. Best-known venues first.
  const PAGE = 1000;
  type Row = {
    id: string;
    slug: string;
    type: string;
    website_url: string;
  };
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("venues")
      .select("id, slug, type, website_url")
      .in("type", FOOD_TYPES)
      .not("google_place_id", "is", null)
      .is("hidden_at", null)
      .is("menu_url", null)
      .not("website_url", "is", null)
      .neq("website_url", "")
      .order("review_count", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`read venues: ${error.message}`);
    const batch = (data ?? []) as Row[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  const work = rows
    .filter((r) => !/instagram\.com|facebook\.com/i.test(r.website_url))
    .slice(0, MAX);
  console.log(`Scanning ${work.length} food venues with a website...\n`);

  let found = 0;
  let none = 0;
  let failed = 0;
  for (const v of work) {
    const page = await fetchPage(v.website_url);
    if (!page) {
      failed += 1;
      console.log(`  x ${v.slug} (fetch failed / blocked)`);
      await sleep(100);
      continue;
    }
    const menu = findMenuUrl(page.html, page.finalUrl);
    if (!menu) {
      none += 1;
      console.log(`  . ${v.slug} (no menu link found)`);
      await sleep(100);
      continue;
    }
    found += 1;
    if (DRY_RUN) {
      console.log(`  > ${v.slug} -> ${menu}`);
    } else {
      const { error } = await supabase
        .from("venues")
        .update({ menu_url: menu })
        .eq("id", v.id);
      if (error) console.error(`  x ${v.slug}: ${error.message}`);
      else console.log(`  > ${v.slug} -> ${menu}`);
    }
    await sleep(150); // be a polite crawler
  }
  console.log(
    `\n${DRY_RUN ? "[dry] " : ""}menus: ${found} found, ${none} no-link, ${failed} fetch-failed, of ${work.length}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
