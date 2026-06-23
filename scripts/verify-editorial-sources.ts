// verify-editorial-sources.ts
//
// One-off pass: HEAD/GET-check every editorial_source URL, mark verified:true
// on confirmed-live sources, remove confirmed-dead (404/410) ones.
//
// Strategy by curation tier:
//   curated   — hand-entered by the team; auto-verify all live responses
//   discovered — AI-generated URLs; require venue name to appear in URL path
//                (catches wrong-business cases like Square Meal pointing to
//                a different restaurant with a similar slug)
//
// Bot-blocked publishers (Square Meal, Harden's, Londonist, Guardian, etc.)
// are skipped and listed for manual browser verification.
//
// Usage:
//   pnpm verify:sources              — dry run, no DB writes
//   pnpm verify:sources -- --write   — apply verified flags + remove dead links
//   pnpm verify:sources -- --curated — dry run, curated venues only
//   pnpm verify:sources -- --write --curated — write, curated only

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

// ── Flags ────────────────────────────────────────────────────────────────────

const WRITE = process.argv.includes("--write");
const CURATED_ONLY = process.argv.includes("--curated");

// ── Supabase ─────────────────────────────────────────────────────────────────

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// ── Types ────────────────────────────────────────────────────────────────────

type Source = {
  publication: string;
  url: string;
  title?: string;
  date?: string;
  verified?: boolean;
};

type Venue = {
  id: string;
  slug: string;
  name: string;
  curation_tier: string | null;
  editorial_sources: Source[];
};

// ── Bot-blocked hosts (same list as refresh-venues.ts) ───────────────────────
// These are Cloudflare-protected and will block any automated HTTP check.
// They need manual browser verification.

const BOT_BLOCKED_HOSTS = new Set<string>([
  "www.squaremeal.co.uk",
  "squaremeal.co.uk",
  "www.hardens.com",
  "hardens.com",
  "www.jancisrobinson.com",
  "jancisrobinson.com",
  "thenudge.com",
  "www.thenudge.com",
  "www.eastlondonlines.co.uk",
  "eastlondonlines.co.uk",
  "www.clashmusic.com",
  "clashmusic.com",
  "thequietus.com",
  "www.thequietus.com",
  "foodism.co.uk",
  "www.foodism.co.uk",
  // Guardian + Standard often block scripts
  "www.theguardian.com",
  "theguardian.com",
  "www.standard.co.uk",
  "standard.co.uk",
  // Londonist is Cloudflare-walled
  "londonist.com",
  "www.londonist.com",
]);

const BOT_BLOCKED_SUFFIXES = [".substack.com"];

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function isBotBlockedHost(host: string): boolean {
  if (BOT_BLOCKED_HOSTS.has(host)) return true;
  return BOT_BLOCKED_SUFFIXES.some((s) => host.endsWith(s));
}

// ── HTTP checker (mirrors refresh-venues.ts logic) ────────────────────────────

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

async function checkUrl(url: string): Promise<number | string> {
  try {
    const headRes = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": BROWSER_UA },
    });
    if (headRes.status < 400) return headRes.status;
    if ([403, 405, 501].includes(headRes.status)) {
      const getRes = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(10000),
        headers: {
          "User-Agent": BROWSER_UA,
          Accept: "text/html,application/xhtml+xml",
        },
      });
      return getRes.status;
    }
    return headRes.status;
  } catch (err) {
    return err instanceof Error ? err.message : "ERR";
  }
}

const CONFIRMED_DEAD = new Set<number>([400, 404, 410]);

function classify(
  url: string,
  status: number | string,
): "ok" | "dead" | "blocked" {
  if (typeof status === "number" && status >= 200 && status < 400) return "ok";
  if (typeof status === "number" && status === 405) return "ok"; // HEAD not allowed, page exists
  if (isBotBlockedHost(hostnameOf(url))) return "blocked";
  if (typeof status === "number" && CONFIRMED_DEAD.has(status)) return "dead";
  return "blocked"; // timeout, DNS error, 5xx → uncertain, treat as blocked not dead
}

// ── Name-in-URL check ─────────────────────────────────────────────────────────
// For discovered venues: checks if meaningful words from the venue name
// appear in the URL path. Catches wrong-business cases (e.g. a Square Meal
// URL for "Drunch Regent's Park" on a venue called "The Counter at The Delaunay").

const STOP_WORDS = new Set([
  "the", "and", "of", "at", "in", "on", "a", "an", "for", "to", "by",
  "with", "from", "&", "bar", "cafe", "london",
]);

function nameInUrl(venueName: string, url: string): boolean {
  let path: string;
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return false;
  }

  const words = venueName
    .toLowerCase()
    .replace(/['’&.]/g, "") // strip apostrophes, ampersands, dots
    .split(/[\s\-\/\+,]+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));

  if (words.length === 0) return true; // short/stop-word-only name — can't check

  return words.some((w) => path.includes(w));
}

// ── Concurrency helper ────────────────────────────────────────────────────────

async function withConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  const queue = tasks.map((t, i) => ({ t, i }));

  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      results[item.i] = await item.t();
    }
  }

  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

// ── Main ──────────────────────────────────────────────────────────────────────

type CheckResult = {
  venueId: string;
  venueName: string;
  curationTier: string;
  source: Source;
  action: "verify" | "dead" | "blocked" | "suspicious" | "skip";
  detail: string;
};

async function main() {
  console.log(
    `\n── Verify editorial sources ──────────────────────────────────────`,
  );
  console.log(`Mode: ${WRITE ? "WRITE" : "DRY RUN"}`);
  console.log(`Scope: ${CURATED_ONLY ? "curated only" : "all tiers"}`);

  // ── Fetch venues ───────────────────────────────────────────────────────────
  // Filter server-side for non-empty arrays to avoid hitting the 1000-row
  // default limit (2,100+ venues have editorial_sources: [] from the cron).
  let query = supabase
    .from("venues")
    .select("id, slug, name, curation_tier, editorial_sources")
    .not("editorial_sources", "is", null)
    .neq("editorial_sources", "[]")
    .limit(2000);

  if (CURATED_ONLY) {
    query = query.eq("curation_tier", "curated");
  }

  const { data, error } = await query;
  if (error) throw new Error(`DB fetch failed: ${error.message}`);

  const venues = (data ?? []).filter(
    (v) => Array.isArray(v.editorial_sources) && v.editorial_sources.length > 0,
  ) as Venue[];

  const totalSources = venues.reduce(
    (n, v) => n + v.editorial_sources.length,
    0,
  );
  console.log(
    `\nFetched ${venues.length} venues, ${totalSources} total sources.\n`,
  );

  // ── Check all sources ──────────────────────────────────────────────────────
  // Flatten into tasks for concurrency
  type Task = { venue: Venue; src: Source };
  const tasks: Task[] = [];
  for (const venue of venues) {
    for (const src of venue.editorial_sources) {
      tasks.push({ venue, src });
    }
  }

  const results = await withConcurrency<CheckResult>(
    tasks.map(({ venue, src }) => async () => {
      // Already verified — skip
      if (src.verified === true) {
        return {
          venueId: venue.id,
          venueName: venue.name,
          curationTier: venue.curation_tier ?? "discovered",
          source: src,
          action: "skip" as const,
          detail: "already verified",
        };
      }

      const host = hostnameOf(src.url);

      // Known bot-blocked — needs browser verification
      if (isBotBlockedHost(host)) {
        return {
          venueId: venue.id,
          venueName: venue.name,
          curationTier: venue.curation_tier ?? "discovered",
          source: src,
          action: "blocked" as const,
          detail: `bot-blocked host: ${host}`,
        };
      }

      // Check URL
      const status = await checkUrl(src.url);
      const kind = classify(src.url, status);

      if (kind === "dead") {
        return {
          venueId: venue.id,
          venueName: venue.name,
          curationTier: venue.curation_tier ?? "discovered",
          source: src,
          action: "dead" as const,
          detail: `HTTP ${status}`,
        };
      }

      if (kind === "ok") {
        const isCurated = venue.curation_tier === "curated";
        const hasNameMatch = nameInUrl(venue.name, src.url);

        if (isCurated || hasNameMatch) {
          return {
            venueId: venue.id,
            venueName: venue.name,
            curationTier: venue.curation_tier ?? "discovered",
            source: src,
            action: "verify" as const,
            detail: isCurated
              ? `curated + HTTP ${status}`
              : `name match + HTTP ${status}`,
          };
        }

        // Live but name not in URL — suspicious
        return {
          venueId: venue.id,
          venueName: venue.name,
          curationTier: venue.curation_tier ?? "discovered",
          source: src,
          action: "suspicious" as const,
          detail: `HTTP ${status}, name not found in URL path`,
        };
      }

      // Blocked (from classify — not in known list but still blocked)
      return {
        venueId: venue.id,
        venueName: venue.name,
        curationTier: venue.curation_tier ?? "discovered",
        source: src,
        action: "blocked" as const,
        detail: `HTTP ${status}`,
      };
    }),
    8, // concurrency limit
  );

  // ── Print results ─────────────────────────────────────────────────────────
  const byAction = {
    verify: results.filter((r) => r.action === "verify"),
    dead: results.filter((r) => r.action === "dead"),
    blocked: results.filter((r) => r.action === "blocked"),
    suspicious: results.filter((r) => r.action === "suspicious"),
    skip: results.filter((r) => r.action === "skip"),
  };

  if (byAction.dead.length > 0) {
    console.log(`\n── DEAD LINKS (will be removed) ─────────────────────`);
    for (const r of byAction.dead) {
      console.log(`  ❌ [${r.curationTier}] ${r.venueName}`);
      console.log(`     ${r.source.url} — ${r.detail}`);
    }
  }

  if (byAction.suspicious.length > 0) {
    console.log(`\n── SUSPICIOUS (live but name not in URL) ────────────`);
    for (const r of byAction.suspicious) {
      console.log(`  ⚠️  [${r.curationTier}] ${r.venueName}`);
      console.log(`     ${r.source.publication}: ${r.source.url}`);
    }
  }

  if (byAction.blocked.length > 0) {
    // Group by publication for readability
    const byPub: Record<string, number> = {};
    for (const r of byAction.blocked) {
      const pub = r.source.publication ?? hostnameOf(r.source.url);
      byPub[pub] = (byPub[pub] ?? 0) + 1;
    }
    console.log(`\n── BOT-BLOCKED (needs manual browser verification) ──`);
    for (const [pub, n] of Object.entries(byPub).sort((a, b) => b[1] - a[1])) {
      console.log(`  🤖 ${pub}: ${n} links`);
    }
  }

  console.log(`\n── Summary ─────────────────────────────────────────────`);
  console.log(`  ✅ Will verify:    ${byAction.verify.length}`);
  console.log(`  ❌ Dead (remove):  ${byAction.dead.length}`);
  console.log(`  🤖 Bot-blocked:    ${byAction.blocked.length}`);
  console.log(`  ⚠️  Suspicious:    ${byAction.suspicious.length}`);
  console.log(`  ⏭  Already done:  ${byAction.skip.length}`);

  // ── Apply writes ──────────────────────────────────────────────────────────
  if (!WRITE) {
    console.log(
      `\n[DRY RUN] Pass -- --write to apply verified flags and remove dead links.\n`,
    );
    return;
  }

  // Build per-venue updated source lists
  const venueMap = new Map<string, Venue>(venues.map((v) => [v.id, v]));
  const toVerifyIds = new Set(
    byAction.verify.map((r) => r.source.url + "|" + r.venueId),
  );
  const toRemoveIds = new Set(
    byAction.dead.map((r) => r.source.url + "|" + r.venueId),
  );

  let updatedCount = 0;

  for (const venue of venues) {
    const updatedSources: Source[] = [];
    let changed = false;

    for (const src of venue.editorial_sources) {
      const key = src.url + "|" + venue.id;

      if (toRemoveIds.has(key)) {
        // Drop dead source
        changed = true;
        continue;
      }

      if (toVerifyIds.has(key)) {
        updatedSources.push({ ...src, verified: true });
        changed = true;
      } else {
        updatedSources.push(src);
      }
    }

    if (!changed) continue;

    const { error: updateError } = await supabase
      .from("venues")
      .update({ editorial_sources: updatedSources })
      .eq("id", venue.id);

    if (updateError) {
      console.error(
        `  ERROR updating ${venue.slug}: ${updateError.message}`,
      );
    } else {
      updatedCount++;
      process.stdout.write(".");
    }
  }

  console.log(
    `\n\nWrote ${updatedCount} venue updates. Phase 3A complete.\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
