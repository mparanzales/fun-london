// Fun London — Tier 1 maintenance: daily refresh of real venues.
//
// For each venue with google_place_id IS NOT NULL:
//   1. Re-pull Google Places Details (rating, review_count, photo, address,
//      businessStatus, websiteUri, phone).
//   2. Diff against current DB row, build a minimal update payload.
//   3. UPDATE the row + set last_synced_at = now().
//   4. If businessStatus flips to CLOSED_PERMANENTLY and closed_at IS NULL,
//      set closed_at = now(). closed_at is an alert flag for the maintainer's
//      review — the venue is NOT auto-hidden from the catalog.
//   5. HEAD-check every URL in editorial_sources + creator_coverage,
//      collect any that return non-2xx.
//
// Output a summary to stdout (captured by GitHub Actions logs).
//
// Run locally:
//   pnpm refresh-venues:dry   # log diffs, no DB writes, skip link check
//   pnpm refresh-venues       # writes
//
// Run in CI:
//   .github/workflows/maintenance.yml triggers this script daily.

import * as dotenv from "dotenv";
// Next.js convention: env vars live in .env.local (not .env). Load it
// explicitly so this script works from any cwd inside the repo.
dotenv.config({ path: ".env.local" });

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

const DRY_RUN = process.argv.includes("--dry-run");
const SKIP_LINK_CHECK = process.argv.includes("--skip-link-check");

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!GOOGLE_PLACES_API_KEY) {
  console.error("Missing GOOGLE_PLACES_API_KEY in env");
  process.exit(1);
}
if (!SUPABASE_URL) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL in env");
  process.exit(1);
}
if (!SUPABASE_SERVICE_ROLE_KEY && !DRY_RUN) {
  console.error(
    "Missing SUPABASE_SERVICE_ROLE_KEY in env (required for writes). " +
      "Run with --dry-run to skip writes.",
  );
  process.exit(1);
}

const supabase =
  SUPABASE_SERVICE_ROLE_KEY && SUPABASE_URL
    ? createSupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      })
    : null;

// ── Google Places API (mirrors scripts/ingest-venues.ts) ────────────────

const PLACES_BASE = "https://places.googleapis.com/v1/places";

type PlaceDetails = {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  rating?: number;
  userRatingCount?: number;
  photos?: { name: string }[];
  websiteUri?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  businessStatus?: string;
};

async function placeDetails(placeId: string): Promise<PlaceDetails> {
  const fieldMask = [
    "id",
    "displayName",
    "formattedAddress",
    "rating",
    "userRatingCount",
    "photos",
    "websiteUri",
    "nationalPhoneNumber",
    "internationalPhoneNumber",
    "businessStatus",
  ].join(",");
  const res = await fetch(`${PLACES_BASE}/${placeId}`, {
    method: "GET",
    headers: {
      "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY!,
      "X-Goog-FieldMask": fieldMask,
    },
  });
  if (!res.ok) {
    throw new Error(
      `Place details failed for ${placeId}: ${res.status} ${await res.text()}`,
    );
  }
  return (await res.json()) as PlaceDetails;
}

function photoUrl(photoName: string, maxWidth = 1600): string {
  return `https://places.googleapis.com/v1/${photoName}/media?key=${GOOGLE_PLACES_API_KEY}&maxWidthPx=${maxWidth}`;
}

// ── Types for current DB row ────────────────────────────────────────────

type VenueRow = {
  id: string;
  slug: string;
  name: string;
  rating: number;
  review_count: number;
  address: string;
  phone: string | null;
  website_url: string | null;
  img_url: string;
  google_place_id: string;
  closed_at: string | null;
  editorial_sources: { url?: string }[] | null;
  creator_coverage: { url?: string }[] | null;
};

type Diff = {
  slug: string;
  field: string;
  before: unknown;
  after: unknown;
};

type DeadLink = {
  slug: string;
  source: "editorial" | "creator";
  url: string;
  status: number | string;
  kind: "dead" | "bot-blocked";
};

// Domains that aggressively block automated HEAD/GET requests via
// Cloudflare-style anti-bot protection. URLs at these hosts that return
// 403/503 (or time out) are almost always fine in a real browser — we
// surface them in a separate "bot-blocked" section so they don't drown
// out real 404s.
//
// This is a known-friction list — add domains as they show up in CI
// runs with the runner's IP being flagged. The cost of including a
// domain here is that a REAL 404 at it will get classified as
// "bot-blocked" rather than "dead" (the maintainer has to browse-verify
// periodically). The cost of excluding it is alert noise that trains
// the eye to ignore the digest.
const BOT_BLOCKED_HOSTS = new Set<string>([
  // Publication sites with Cloudflare bot challenges
  "www.squaremeal.co.uk",
  "squaremeal.co.uk",
  "www.jancisrobinson.com",
  "jancisrobinson.com",
  "thenudge.com",
  "www.thenudge.com",
  "www.eastlondonlines.co.uk",
  "eastlondonlines.co.uk",
  "www.hardens.com",
  "hardens.com",
  "www.clashmusic.com",
  "clashmusic.com",
  "thequietus.com",
  "www.thequietus.com",
  "foodism.co.uk",
  "www.foodism.co.uk",
]);

// Suffix matches — any subdomain of these hosts is treated as bot-blocked.
// Substack blocks all substack.com subdomains from automated GET.
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
  return BOT_BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

// ── Diff helpers ────────────────────────────────────────────────────────

function diffRow(
  row: VenueRow,
  details: PlaceDetails,
): {
  update: Partial<VenueRow> & { last_synced_at: string; closed_at?: string };
  diffs: Diff[];
} {
  const nowIso = new Date().toISOString();
  const update: Partial<VenueRow> & {
    last_synced_at: string;
    closed_at?: string;
  } = {
    last_synced_at: nowIso,
  };
  const diffs: Diff[] = [];

  const newRating = details.rating ?? row.rating;
  if (Math.abs(newRating - row.rating) >= 0.05) {
    update.rating = newRating;
    diffs.push({
      slug: row.slug,
      field: "rating",
      before: row.rating,
      after: newRating,
    });
  }

  const newReviewCount = details.userRatingCount ?? row.review_count;
  if (newReviewCount !== row.review_count) {
    update.review_count = newReviewCount;
    // Don't surface review_count changes in the summary — too noisy.
  }

  const newAddress = details.formattedAddress ?? row.address;
  if (newAddress !== row.address) {
    update.address = newAddress;
    diffs.push({
      slug: row.slug,
      field: "address",
      before: row.address,
      after: newAddress,
    });
  }

  const newPhone =
    details.nationalPhoneNumber ??
    details.internationalPhoneNumber ??
    row.phone;
  if (newPhone !== row.phone) {
    update.phone = newPhone;
  }

  const newWebsite = details.websiteUri ?? row.website_url;
  if (newWebsite !== row.website_url) {
    update.website_url = newWebsite;
    diffs.push({
      slug: row.slug,
      field: "website_url",
      before: row.website_url,
      after: newWebsite,
    });
  }

  // Photo refresh — Google's photo names rotate. Only update if there's a
  // fresh photo AND the current img_url is still a Google Places URL
  // (don't clobber a manually-set img_url).
  const photoName = details.photos?.[0]?.name;
  if (photoName && row.img_url.startsWith("https://places.googleapis.com/")) {
    const newImg = photoUrl(photoName);
    if (newImg !== row.img_url) {
      update.img_url = newImg;
      // No diff entry — image-URL diffs are noise in logs.
    }
  }

  // Closure detection — once a venue is marked closed, never auto-unmark.
  if (
    details.businessStatus === "CLOSED_PERMANENTLY" &&
    row.closed_at === null
  ) {
    update.closed_at = nowIso;
    diffs.push({
      slug: row.slug,
      field: "BUSINESS_STATUS",
      before: "OPEN",
      after: "CLOSED_PERMANENTLY",
    });
  }

  return { update, diffs };
}

// ── Dead-link checker ───────────────────────────────────────────────────
//
// Many editorial sites (Square Meal, Jancis Robinson, The Nudge, etc.)
// reject HEAD requests as an anti-bot measure but happily serve GET
// requests from a real browser. To avoid false-positive "dead link"
// noise, we first HEAD; on 403/405/501 we fall back to a browser-UA GET
// that only reads the response headers. Only persistent 4xx/5xx (or a
// total network failure) is treated as a real dead link.

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
    // HEAD blocked or weird — try GET before declaring dead.
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

// Classifier philosophy: high-PRECISION dead-link alerts. The cron only
// flags a link as "dead" when the response says, with confidence, that
// the page is gone (HTTP 404 / 410). Timeouts, DNS errors, 403/503, and
// other 4xx/5xx responses fall into the softer "bot-blocked / uncertain"
// bucket. This means some genuinely-dead pages might slip into the
// FYI section — but the daily alert stays signal-rich rather than noise.
const CONFIDENT_DEAD_STATUSES = new Set<number>([
  400, // explicit bad request — the URL is malformed
  404, // page not found
  410, // gone, intentionally removed
]);

function classify(
  url: string,
  status: number | string,
): "ok" | "dead" | "bot-blocked" {
  if (typeof status === "number" && status >= 200 && status < 400) return "ok";
  if (typeof status === "number" && status === 405) return "ok"; // HEAD not allowed
  if (isBotBlockedHost(hostnameOf(url))) return "bot-blocked";
  // Only HTTP responses that explicitly mean "this page is gone" count
  // as dead. Anything else is uncertain.
  if (typeof status === "number" && CONFIDENT_DEAD_STATUSES.has(status)) {
    return "dead";
  }
  return "bot-blocked";
}

async function deadLinksForVenue(row: VenueRow): Promise<DeadLink[]> {
  const out: DeadLink[] = [];

  const editorialUrls = (row.editorial_sources ?? [])
    .map((s) => s.url)
    .filter((u): u is string => typeof u === "string");
  for (const url of editorialUrls) {
    const status = await checkUrl(url);
    const k = classify(url, status);
    if (k === "ok") continue;
    out.push({ slug: row.slug, source: "editorial", url, status, kind: k });
  }

  const creatorUrls = (row.creator_coverage ?? [])
    .map((c) => c.url)
    .filter((u): u is string => typeof u === "string");
  for (const url of creatorUrls) {
    const status = await checkUrl(url);
    const k = classify(url, status);
    if (k === "ok") continue;
    out.push({ slug: row.slug, source: "creator", url, status, kind: k });
  }

  return out;
}

// ── Per-venue processor ─────────────────────────────────────────────────

async function processVenue(row: VenueRow): Promise<{
  diffs: Diff[];
  deadLinks: DeadLink[];
  closure: boolean;
}> {
  console.log(`\n→ ${row.slug}`);

  const details = await placeDetails(row.google_place_id);
  const { update, diffs } = diffRow(row, details);

  if (diffs.length === 0) {
    console.log(`  no field changes`);
  } else {
    for (const d of diffs) {
      console.log(`  Δ ${d.field}: ${String(d.before)} → ${String(d.after)}`);
    }
  }

  if (DRY_RUN) {
    console.log(
      `  [dry-run] would update last_synced_at + ${Object.keys(update).length - 1} other fields`,
    );
  } else {
    if (!supabase) throw new Error("Supabase client not initialised");
    const { error } = await supabase
      .from("venues")
      .update(update)
      .eq("id", row.id);
    if (error) {
      throw new Error(`UPDATE failed for ${row.slug}: ${error.message}`);
    }
    console.log(`  ✓ updated (last_synced_at set)`);
  }

  let deadLinks: DeadLink[] = [];
  if (!SKIP_LINK_CHECK) {
    deadLinks = await deadLinksForVenue(row);
    for (const dl of deadLinks) {
      const icon = dl.kind === "dead" ? "✗ dead link" : "🛡 bot-blocked";
      console.log(`  ${icon} (${dl.source}): ${dl.url} → ${dl.status}`);
    }
  }

  return {
    diffs,
    deadLinks,
    closure: update.closed_at !== undefined,
  };
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  if (!supabase) {
    // In dry-run mode without service key, fall back to a read-only client
    // using the anon key — still lets us fetch the venues to refresh.
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!anonKey) {
      console.error(
        "Need NEXT_PUBLIC_SUPABASE_ANON_KEY for dry-run reads when service key is absent.",
      );
      process.exit(1);
    }
  }

  const readClient =
    supabase ??
    createSupabaseClient(
      SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    );

  console.log(
    `Fun London — refresh-venues · ${DRY_RUN ? "DRY RUN" : "WRITING"}${SKIP_LINK_CHECK ? " · link-check off" : ""}\n`,
  );

  const { data: rows, error } = await readClient
    .from("venues")
    .select(
      "id, slug, name, rating, review_count, address, phone, website_url, img_url, google_place_id, closed_at, editorial_sources, creator_coverage",
    )
    .not("google_place_id", "is", null)
    .order("created_at", { ascending: true });

  if (error) {
    console.error(`Failed to fetch venues: ${error.message}`);
    process.exit(1);
  }
  if (!rows || rows.length === 0) {
    console.log("No real venues to refresh.");
    return;
  }

  console.log(`Refreshing ${rows.length} real venues...`);

  const allDiffs: Diff[] = [];
  const allDead: DeadLink[] = [];
  const closures: string[] = [];
  const failed: { slug: string; error: string }[] = [];

  for (const row of rows as VenueRow[]) {
    try {
      const r = await processVenue(row);
      allDiffs.push(...r.diffs);
      allDead.push(...r.deadLinks);
      if (r.closure) closures.push(row.slug);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ FAILED: ${msg}`);
      failed.push({ slug: row.slug, error: msg });
    }
  }

  const reallyDead = allDead.filter((d) => d.kind === "dead");
  const botBlocked = allDead.filter((d) => d.kind === "bot-blocked");

  console.log("\n─────────── SUMMARY ───────────");
  console.log(
    `Refreshed: ${rows.length - failed.length}/${rows.length} venues`,
  );
  console.log(`Field changes surfaced: ${allDiffs.length}`);
  console.log(`Real dead links: ${reallyDead.length}`);
  console.log(
    `Bot-blocked (FYI, likely fine in browser): ${botBlocked.length}`,
  );
  console.log(`New closures: ${closures.length}`);

  if (closures.length > 0) {
    console.log("\n🚨 NEW CLOSURES (review needed):");
    closures.forEach((s) => console.log(`  - ${s}`));
  }

  if (reallyDead.length > 0) {
    console.log("\n⚠ REAL DEAD LINKS (replace these):");
    for (const dl of reallyDead) {
      console.log(`  - [${dl.slug}] ${dl.source}: ${dl.url} → ${dl.status}`);
    }
  }

  if (botBlocked.length > 0) {
    console.log(
      "\n🛡 BOT-BLOCKED (Cloudflare etc. — open in browser to verify):",
    );
    for (const dl of botBlocked) {
      console.log(`  - [${dl.slug}] ${dl.source}: ${dl.url} → ${dl.status}`);
    }
  }

  if (failed.length > 0) {
    console.log(`\n✗ FAILED: ${failed.length}`);
    failed.forEach((f) => console.log(`  - ${f.slug}: ${f.error}`));
  }

  console.log(`\n${DRY_RUN ? "Dry run complete." : "Refresh complete."}`);
  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
