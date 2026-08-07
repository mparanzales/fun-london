// Runtime proof, not a unit test: stand up a real listener on loopback, then
// show that the OLD code path reaches it and the NEW one refuses — and that
// real catalogue URLs still fetch normally.
//
// Run:  pnpm tsx scripts/__tests__/ssrf-runtime-probe.ts
//
// This file is a verification harness kept with the fix so the evidence is
// reproducible. It writes nothing and calls no metered API.
//
// It lives under __tests__/ deliberately, for two reasons: it is apparatus
// rather than a product script, and section 2 below makes a BARE fetch on
// purpose — that is the counterfactual the whole change rests on. The
// "no NEW unguarded fetch" inventory in safe-fetch.test.ts scans the top level
// of scripts/ only, so this file does not have to be granted an exemption that
// would then also cover a real sink. Not a vitest file: the runner only picks
// up *.test.ts, and this one needs live credentials and the network.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createServer } from "node:http";
import { createClient } from "@supabase/supabase-js";
import { isBlockedUrlError, safeFetch, parseFetchTarget } from "../safe-fetch";

const SECRET = "SUPABASE_SERVICE_ROLE_KEY=eyJ.PRETEND.INTERNAL.SECRET";

async function main() {
  // A stand-in for anything listening on loopback in the runner: the local
  // Supabase REST port, a metadata service, a debug endpoint.
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ leaked: SECRET }));
  });
  await new Promise<void>((r) => server.listen(54321, "127.0.0.1", r));

  const HOSTILE = [
    "http://127.0.0.1:54321/rest/v1/venues?x=places.googleapis.com",
    "http://169.254.169.254/latest/meta-data/iam/security-credentials/?x=places.googleapis.com",
  ];
  const PHOTO = { allowInitialHosts: ["places.googleapis.com"] as const };

  console.log("\n── 1. The SQL filter the script used to trust ──────────────");
  for (const u of HOSTILE) {
    console.log(
      // 🧨 CodeQL raises "incomplete URL substring sanitization" (high) here.
      // It is correct about the shape, and that is precisely what is being
      // shown: this line REPRODUCES the `.ilike("%places.googleapis.com%")`
      // filter the backfill used to trust, so the run can print that both
      // hostile URLs satisfy it. The value of the line is that it IS the bad
      // check. An inline `// codeql[...]` suppression was tried and does not
      // take effect in GitHub code scanning — do not re-add one and assume the
      // alert is handled. CodeQL does not gate the merge on this repo.
      `  ${u.includes("places.googleapis.com") ? "MATCHES" : "misses "} ilike %places.googleapis.com%  ${u.slice(0, 62)}…`,
    );
  }

  console.log("\n── 2. Plain fetch (the code before this change) ────────────");
  for (const u of HOSTILE) {
    try {
      const res = await fetch(u, { signal: AbortSignal.timeout(2500) });
      const body = (await res.text()).slice(0, 90);
      console.log(`  🔴 REACHED  HTTP ${res.status}  ${new URL(u).host}`);
      console.log(
        `      body that would have gone to the PUBLIC bucket: ${body}`,
      );
    } catch (e) {
      console.log(
        `  ⚪ no listener (${new URL(u).host}): ${(e as Error).message}`,
      );
    }
  }

  console.log("\n── 3. safeFetch (the code after this change) ───────────────");
  for (const u of HOSTILE) {
    try {
      const res = await safeFetch(
        u,
        { signal: AbortSignal.timeout(2500) },
        PHOTO,
      );
      console.log(
        `  🔴 LEAK — reached HTTP ${res.status} on ${new URL(u).host}`,
      );
    } catch (e) {
      if (isBlockedUrlError(e))
        console.log(`  ✅ REFUSED  ${e.message.slice(0, 110)}`);
      else console.log(`  ⚠️  other error: ${(e as Error).message}`);
    }
  }
  server.close();

  // ── 4. Real catalogue data still passes ────────────────────────────────
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log(
      "\n── 4. skipped (no Supabase creds in .env.local) ───────────",
    );
    return;
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  console.log("\n── 4. Every live catalogue URL, screened ───────────────────");
  // Count first, then page past PostgREST's 1000-row cap, then re-count at the
  // end: a .limit(2000) silently returns 1000 and a partial scan reported as
  // "the catalogue" is exactly the false all-clear this repo keeps paying for.
  const { count: total } = await supabase
    .from("venues")
    .select("id", { count: "exact", head: true });
  console.log(`  venues in table:       ${total ?? "?"}`);

  type Row = {
    slug: string;
    img_url: string | null;
    website_url: string | null;
    editorial_sources: { url?: string }[] | null;
  };
  const rows: Row[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("venues")
      .select("slug,img_url,website_url,editorial_sources")
      .order("slug", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      console.log(`  read failed: ${error.message}`);
      return;
    }
    const page = (data ?? []) as Row[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  if (total != null && rows.length !== total) {
    console.log(
      `  ⚠️  scanned ${rows.length} but table holds ${total} — INCOMPLETE`,
    );
  }
  let img = 0,
    imgBad = 0,
    site = 0,
    siteBad = 0,
    src = 0,
    srcBad = 0;
  const rejects: string[] = [];
  for (const v of rows) {
    if (v.img_url) {
      img++;
      if (!parseFetchTarget(v.img_url)) {
        imgBad++;
        rejects.push(`img_url  ${v.slug}: ${String(v.img_url).slice(0, 80)}`);
      }
    }
    if (v.website_url) {
      site++;
      if (!parseFetchTarget(v.website_url)) {
        siteBad++;
        rejects.push(
          `website  ${v.slug}: ${String(v.website_url).slice(0, 80)}`,
        );
      }
    }
    for (const s of (v.editorial_sources ?? []) as { url?: string }[]) {
      if (!s?.url) continue;
      src++;
      if (!parseFetchTarget(s.url)) {
        srcBad++;
        rejects.push(`source   ${v.slug}: ${String(s.url).slice(0, 80)}`);
      }
    }
  }
  console.log(`  venues scanned:        ${rows.length}`);
  console.log(`  img_url:               ${img - imgBad}/${img} pass`);
  console.log(`  website_url:           ${site - siteBad}/${site} pass`);
  console.log(`  editorial source urls: ${src - srcBad}/${src} pass`);
  if (rejects.length) {
    console.log(
      `\n  ⚠️  ${rejects.length} live value(s) the guard would refuse:`,
    );
    for (const r of rejects.slice(0, 25)) console.log(`     ${r}`);
  } else {
    console.log(`\n  ✅ zero false positives on live catalogue data`);
  }

  // A real outbound fetch through the guard, to prove it is not refusing
  // everything: hit a publisher URL that is actually in the catalogue.
  const live = rows
    .flatMap((v) =>
      ((v.editorial_sources ?? []) as { url?: string }[]).map((s) => s?.url),
    )
    .filter(
      (u): u is string => typeof u === "string" && u.startsWith("https://"),
    )
    .slice(0, 3);
  console.log("\n── 5. Real outbound requests through safeFetch ─────────────");
  for (const u of live) {
    try {
      const res = await safeFetch(
        u,
        { method: "HEAD", signal: AbortSignal.timeout(8000) },
        {},
      );
      console.log(`  ✅ HTTP ${res.status}  ${new URL(u).host}`);
    } catch (e) {
      console.log(
        `  ${isBlockedUrlError(e) ? "🔴 REFUSED" : "⚪ network"}  ${new URL(u).host}: ${(e as Error).message.slice(0, 70)}`,
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
