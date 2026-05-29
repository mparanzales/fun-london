// Fun London — events ingestion (Phase 5 Tier 3).
//
// SKELETON ONLY — provider adapters are stubs. The script reads
// scripts/events-seed.ts and walks each subscription:
//
//   1. Look up the local venue row by slug (so we can write venue_id +
//      venue_name in the events row from canonical data).
//   2. Call the provider adapter to fetch events in the next ~14 days.
//   3. Map provider rows into the public.events shape.
//   4. Upsert via ON CONFLICT (source, source_id) — idempotent.
//   5. Re-check existing rows from this provider that AREN'T in the
//      pulled set, and mark cancelled_at on them.
//
// Each provider adapter is a separate file under scripts/event-sources/
// (created in follow-up sessions when API keys are in place):
//
//   scripts/event-sources/eventbrite.ts
//   scripts/event-sources/ticketmaster.ts
//   scripts/event-sources/skiddle.ts
//   scripts/event-sources/dice.ts
//
// Required env (none for the dry-run skeleton; added per-adapter):
//   EVENTBRITE_PRIVATE_TOKEN
//   TICKETMASTER_API_KEY
//   SKIDDLE_API_KEY
//
// Run:
//   pnpm ingest-events:dry           # log what each adapter would do, no DB writes
//   pnpm ingest-events               # writes (once adapters are real)

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { EVENT_SUBSCRIPTIONS, type EventSubscription } from "./events-seed";

const DRY_RUN = process.argv.includes("--dry-run");

// Which passes to run this invocation:
//   curated   — only the per-venue subscriptions (your hand-picked
//               independents). Runs at :30 past 0/4/8/12/16/20h.
//   discovery — only the London-wide top-10 best-of. Runs at :30 past
//               2/6/10/14/18/22h, interleaved with curated.
//   both      — run everything (default; used for manual/local runs).
type IngestMode = "curated" | "discovery" | "both";
function parseMode(): IngestMode {
  const arg = process.argv.find((a) => a.startsWith("--mode="));
  const val = arg?.split("=")[1];
  if (val === "curated" || val === "discovery" || val === "both") return val;
  return "both";
}
const MODE: IngestMode = parseMode();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

// ── Helpers ──────────────────────────────────────────────────────────────

// public.events.date_label is a UI display label ("Tonight" / "This
// Weekend" / "This Week"). We compute it at ingest time relative to
// the wall clock and overwrite on every cron run (4-hourly), so the
// label stays fresh as time passes. Events further than ~7 days out
// still get "This Week" — the UI doesn't filter beyond a week, so
// they're effectively "upcoming" until the day approaches.
function dateLabelFor(
  startsAt: Date,
  now: Date = new Date(),
): "Tonight" | "This Weekend" | "This Week" {
  const startOfTomorrow = new Date(now);
  startOfTomorrow.setHours(0, 0, 0, 0);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

  if (startsAt < startOfTomorrow) return "Tonight";

  // "This Weekend" = the next Sat/Sun within 7 days
  const day = startsAt.getDay(); // 0 = Sun, 6 = Sat
  const dayDelta = (startsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  if ((day === 0 || day === 6) && dayDelta <= 7) return "This Weekend";

  return "This Week";
}

// Generic placeholder when a provider doesn't return an image and the
// venue itself has no img_url. public.events.img_url is NOT NULL.
const FALLBACK_IMG_URL =
  "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=1600&q=80";

// Image hosts the Next.js <Image> optimizer is allowed to load — must
// stay in sync with the remotePatterns allowlist in next.config.js.
// Providers (especially the London-wide Ticketmaster discovery pull)
// return poster URLs from a grab-bag of CDNs; anything not on this
// list would render as a broken-image icon, so we drop it at ingest
// time and let the FALLBACK_IMG_URL take over instead.
const ALLOWED_IMG_HOSTS = [
  "images.unsplash.com",
  "places.googleapis.com",
  "lh3.googleusercontent.com",
  "images.universe.com",
];

// Returns the URL only if its host is one the app can actually render;
// otherwise "" so the caller falls back to the venue image / placeholder.
function safeImageUrl(url: string | undefined | null): string {
  if (!url) return "";
  try {
    const host = new URL(url).hostname;
    const ok =
      ALLOWED_IMG_HOSTS.includes(host) || host.endsWith(".ticketm.net");
    return ok ? url : "";
  } catch {
    return "";
  }
}

// How far ahead each provider adapter looks. Two months gives the
// `dateLabelFor` enough runway to flip events into "This Week" /
// "This Weekend" as the cron ticks every 4 hours.
const EVENT_HORIZON_DAYS = 60;

// ── London-wide discovery pull ──────────────────────────────────────────
//
// Maria's call (2026-05-29): the events tab should always feel alive, so
// in addition to the curated per-venue subscriptions we run a broad
// London-wide Ticketmaster search every cron tick and keep at least
// LONDON_DISCOVERY_TARGET upcoming events stocked.
//
// PRODUCT NOTE — this is a deliberate exception to the "curated
// independents only, no chains" thesis. These events are NOT tied to a
// curated venue (venue_id stays null) and CAN include mainstream / chain
// venues. We restrict to our content categories (Music / Art / Comedy)
// and request soonest-first, but no independence vetting is applied here.
// A future filter pass (chain blocklist + venue-size heuristic) could
// tighten this without changing the pipeline shape.
const LONDON_DISCOVERY_TARGET = 10; // how many we keep stocked (the "top 10")
const LONDON_DISCOVERY_SIZE = 60; // how many to request per run (then trim to target)

// Pick a balanced top-N across categories: round-robin through the
// categories present, taking the soonest event from each in turn. Keeps
// the London-wide slice from being all-theatre. `events` is assumed
// already sorted soonest-first, so per-category order is preserved.
function selectBalanced(events: FetchedEvent[], target: number): FetchedEvent[] {
  const byCategory = new Map<string, FetchedEvent[]>();
  for (const e of events) {
    const list = byCategory.get(e.category) ?? [];
    list.push(e);
    byCategory.set(e.category, list);
  }
  const categories = Array.from(byCategory.keys());
  const picked: FetchedEvent[] = [];
  let i = 0;
  while (
    picked.length < target &&
    categories.some((c) => (byCategory.get(c)?.length ?? 0) > 0)
  ) {
    const list = byCategory.get(categories[i % categories.length]);
    const next = list?.shift();
    if (next) picked.push(next);
    i++;
  }
  return picked;
}

// Ticketmaster classification terms we query the London feed for. Note
// these are passed as `classificationName` (the fuzzy matcher that hits
// segment OR genre names) — NOT `segmentName`. Ticketmaster's top-level
// segments are only Music / Sports / Arts & Theatre / Film / Misc, so
// "Comedy" (a genre under Arts & Theatre) must be matched this way or it
// returns nothing. Querying per-term gives category variety in the feed.
const LONDON_DISCOVERY_TERMS = ["Music", "Theatre", "Comedy"];

// ── Provider adapters — STUBS for now ───────────────────────────────────
//
// Each adapter takes a subscription and returns a list of normalised
// event objects matching the public.events row shape (with venue_id
// resolved by the orchestrator before upsert).

type FetchedEvent = {
  source_id: string; // provider's unique id
  source_url: string; // ticket page
  name: string;
  starts_at: string; // ISO timestamptz
  time_label: string; // "8:00 PM" etc.
  price: string; // "From £15" — provider-formatted
  category: string; // EventCategory
  img_url: string;
  description: string | null;
  sold_out: boolean;
  // Only populated by the London-wide discovery pull (events not tied to
  // a curated venue subscription). Subscription-based fetches leave these
  // null and the orchestrator fills venue identity from the local DB row.
  venue_name?: string | null;
  venue_area?: string | null;
};

async function fetchEventbrite(
  _sub: Extract<EventSubscription, { source: "eventbrite" }>,
): Promise<FetchedEvent[]> {
  // TODO(eventbrite-adapter): wire to Eventbrite Search API once
  // EVENTBRITE_PRIVATE_TOKEN is in .env.local + GitHub Actions secrets.
  // Endpoint: GET https://www.eventbriteapi.com/v3/organizations/<id>/events
  // Filter: start_date.range_start=now, range_end=+14d.
  return [];
}

async function fetchTicketmaster(
  sub: Extract<EventSubscription, { source: "ticketmaster" }>,
): Promise<FetchedEvent[]> {
  const apiKey = process.env.TICKETMASTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "TICKETMASTER_API_KEY missing — adapter requires it. Add to .env.local " +
        "(local) and GitHub Actions secrets (cron).",
    );
  }

  // Pull events between now and EVENT_HORIZON_DAYS days out (defaults to
  // 60). The UI filters by "Tonight" / "This Weekend" / "This Week" but
  // we store events further out so the date_label flips them in as time
  // approaches. Ticketmaster's Discovery API caps responses at
  // `size=200`; for any single small venue this is wildly more than
  // enough.
  const now = new Date();
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + EVENT_HORIZON_DAYS);

  const params = new URLSearchParams({
    venueId: sub.ticketmasterVenueId,
    startDateTime: isoNoMillis(now),
    endDateTime: isoNoMillis(horizon),
    sort: "date,asc",
    size: "100",
    apikey: apiKey,
  });

  const url = `https://app.ticketmaster.com/discovery/v2/events.json?${params}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Ticketmaster ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as TicketmasterEventsResponse;
  const events = json._embedded?.events ?? [];

  return events.map(tmToFetched).filter((e): e is FetchedEvent => e !== null);
}

// Ticketmaster requires startDateTime / endDateTime as ISO without
// fractional seconds (their API rejects ".123Z"). Trim those bits.
function isoNoMillis(d: Date): string {
  return d.toISOString().replace(/\.\d+Z$/, "Z");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// London-wide discovery: not venue-scoped. Queries Ticketmaster once per
// content segment (Music / Arts & Theatre / Comedy), soonest-first, then
// merges + de-dupes. Per-segment querying (vs a single broad city query)
// reliably clears the target count AND gives category variety instead of
// the result being dominated by long-running West End theatre runs.
// Each FetchedEvent carries its own venue_name + venue_area (read from
// the TM payload) because there's no curated venue row to attribute it to.
async function fetchLondonDiscovery(): Promise<FetchedEvent[]> {
  const apiKey = process.env.TICKETMASTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "TICKETMASTER_API_KEY missing — London discovery requires it. Add to " +
        ".env.local (local) and GitHub Actions secrets (cron).",
    );
  }

  const now = new Date();
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + EVENT_HORIZON_DAYS);

  // Split the per-run budget across the terms so each contributes.
  const perTerm = Math.ceil(
    LONDON_DISCOVERY_SIZE / LONDON_DISCOVERY_TERMS.length,
  );

  const byId = new Map<string, FetchedEvent>();
  let first = true;
  for (const term of LONDON_DISCOVERY_TERMS) {
    // Ticketmaster enforces a 5-requests/second "spike arrest". We fire
    // several queries per run (subscriptions + one per term), so pause
    // between term queries to stay well under the cap — otherwise a
    // term silently 429s and drops out of the pull.
    if (!first) await sleep(300);
    first = false;

    const params = new URLSearchParams({
      city: "London",
      countryCode: "GB",
      classificationName: term,
      startDateTime: isoNoMillis(now),
      endDateTime: isoNoMillis(horizon),
      sort: "date,asc",
      size: String(perTerm),
      apikey: apiKey,
    });
    const url = `https://app.ticketmaster.com/discovery/v2/events.json?${params}`;
    const res = await fetch(url);
    if (!res.ok) {
      // One term failing shouldn't sink the whole pull. Log + continue.
      console.error(
        `  ! London "${term}" query ${res.status}: ${await res.text()}`,
      );
      continue;
    }
    const json = (await res.json()) as TicketmasterEventsResponse;
    for (const e of json._embedded?.events ?? []) {
      const mapped = tmToFetchedWithVenue(e);
      if (mapped && !byId.has(mapped.source_id)) {
        byId.set(mapped.source_id, mapped);
      }
    }
  }

  // Merge across segments, soonest-first.
  return Array.from(byId.values()).sort(
    (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
  );
}

// ── Ticketmaster response types (subset of what we actually read) ──────

type TicketmasterEvent = {
  id: string;
  name: string;
  url?: string;
  info?: string;
  pleaseNote?: string;
  dates?: {
    start?: {
      localDate?: string;
      localTime?: string;
      dateTime?: string;
    };
    status?: { code?: string };
  };
  classifications?: {
    segment?: { name?: string };
    genre?: { name?: string };
  }[];
  images?: { url: string; width?: number; height?: number; ratio?: string }[];
  priceRanges?: { min?: number; max?: number; currency?: string }[];
  _embedded?: {
    venues?: {
      name?: string;
      city?: { name?: string };
      // Ticketmaster sometimes nests a more specific area under address.
      address?: { line1?: string };
    }[];
  };
};

type TicketmasterEventsResponse = {
  _embedded?: { events?: TicketmasterEvent[] };
};

// Map Ticketmaster's segment + genre → Fun London's EventCategory.
// Our union is "Music" | "Food" | "Art" | "Comedy" | "Club". Comedy is a
// GENRE under the "Arts & Theatre" segment (there's no top-level Comedy
// segment), so we check genre first — otherwise stand-up shows would all
// be mislabelled "Art". Sports / Film / Misc fall back to Music since we
// wouldn't curate those venues anyway.
function tmCategory(
  segment: string | undefined,
  genre: string | undefined,
): string {
  if (genre && genre.toLowerCase().includes("comedy")) return "Comedy";
  switch (segment) {
    case "Music":
      return "Music";
    case "Arts & Theatre":
      return "Art";
    case "Comedy":
      return "Comedy";
    default:
      return "Music";
  }
}

function tmToFetched(e: TicketmasterEvent): FetchedEvent | null {
  // Need a stable start time. Ticketmaster sometimes returns only
  // localDate (no time) for early-announced shows; coerce to 19:00
  // local in that case so the row still validates.
  const localDate = e.dates?.start?.localDate;
  if (!localDate) return null;
  const startsAt = (() => {
    if (e.dates?.start?.dateTime) return e.dates.start.dateTime;
    if (e.dates?.start?.localTime) {
      return `${localDate}T${e.dates.start.localTime}Z`;
    }
    return `${localDate}T19:00:00Z`;
  })();

  const localTime = e.dates?.start?.localTime ?? "";
  const timeLabel = localTime ? formatTimeLabel(localTime) : "Time TBD";

  // Pick the widest 16:9 image we get back, fall back to the first.
  const img =
    (e.images ?? []).find((i) => i.ratio === "16_9" && (i.width ?? 0) > 600) ??
    e.images?.[0];

  const priceRange = e.priceRanges?.[0];
  const price = formatPrice(
    priceRange?.min,
    priceRange?.max,
    priceRange?.currency,
  );

  const segment = e.classifications?.[0]?.segment?.name;
  const genre = e.classifications?.[0]?.genre?.name;
  const soldOut =
    (e.dates?.status?.code ?? "").toLowerCase() === "cancelled" ||
    (e.dates?.status?.code ?? "").toLowerCase() === "offsale";

  return {
    source_id: e.id,
    source_url: e.url ?? "",
    name: e.name,
    starts_at: startsAt,
    time_label: timeLabel,
    price,
    category: tmCategory(segment, genre),
    img_url: safeImageUrl(img?.url),
    description: e.info ?? e.pleaseNote ?? null,
    sold_out: soldOut,
  };
}

// Same mapping as tmToFetched, but also resolves the event's own venue
// identity from the TM payload (for the London-wide discovery pull,
// which isn't attributed to a curated venue row).
function tmToFetchedWithVenue(e: TicketmasterEvent): FetchedEvent | null {
  const base = tmToFetched(e);
  if (!base) return null;
  const v = e._embedded?.venues?.[0];
  return {
    ...base,
    venue_name: v?.name ?? "London venue",
    venue_area: v?.city?.name ?? "London",
  };
}

function formatTimeLabel(localTime: string): string {
  // "20:00:00" → "8:00 PM"
  const [hStr, mStr] = localTime.split(":");
  const h = Number(hStr);
  const m = Number(mStr ?? "0");
  if (isNaN(h)) return localTime;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`;
}

function formatPrice(
  min: number | undefined,
  max: number | undefined,
  currency: string | undefined,
): string {
  const cur =
    currency === "GBP" ? "£" : currency === "USD" ? "$" : (currency ?? "");
  if (min == null && max == null) return "Tickets via Ticketmaster";
  if (min != null && max != null && min !== max) {
    return `${cur}${min.toFixed(0)}–${cur}${max.toFixed(0)}`;
  }
  const val = min ?? max ?? 0;
  return `From ${cur}${val.toFixed(0)}`;
}

async function fetchSkiddle(
  _sub: Extract<EventSubscription, { source: "skiddle" }>,
): Promise<FetchedEvent[]> {
  // TODO(skiddle-adapter): wire to Skiddle API.
  // Endpoint: GET https://www.skiddle.com/api/v1/events?venueid=<id>&api_key=<key>
  return [];
}

async function fetchDice(
  _sub: Extract<EventSubscription, { source: "dice" }>,
): Promise<FetchedEvent[]> {
  // TODO(dice-adapter): DICE has no public API. Options:
  //   1. Scrape the venue page HTML (fragile)
  //   2. Apply for the DICE partner API (requires partnership)
  //   3. Skip DICE in V1 and rely on venue-direct booking deep-links
  return [];
}

async function dispatchFetch(sub: EventSubscription): Promise<FetchedEvent[]> {
  switch (sub.source) {
    case "eventbrite":
      return fetchEventbrite(sub);
    case "ticketmaster":
      return fetchTicketmaster(sub);
    case "skiddle":
      return fetchSkiddle(sub);
    case "dice":
      return fetchDice(sub);
  }
}

// ── Per-subscription processor ──────────────────────────────────────────

async function processSubscription(sub: EventSubscription): Promise<{
  fetched: number;
  upserted: number;
  cancelled: number;
}> {
  console.log(`\n→ ${sub.source} · ${sub.venueSlug}`);

  // Lookup venue identity + display fields once per subscription. We
  // need neighbourhood (→ events.area) and img_url (→ events.img_url
  // fallback when the provider doesn't return an image).
  let venueId: string | null = null;
  let venueName: string | null = null;
  let venueArea: string | null = null;
  let venueImgUrl: string | null = null;
  if (supabase) {
    const { data, error } = await supabase
      .from("venues")
      .select("id, name, neighbourhood, img_url")
      .eq("slug", sub.venueSlug)
      .maybeSingle();
    if (error) {
      console.error(
        `  ! venue lookup failed for ${sub.venueSlug}: ${error.message}`,
      );
      return { fetched: 0, upserted: 0, cancelled: 0 };
    }
    venueId = data?.id ?? null;
    venueName = data?.name ?? null;
    venueArea = data?.neighbourhood ?? null;
    venueImgUrl = data?.img_url ?? null;
    if (!venueId) {
      console.log(`  ! no venue row for slug "${sub.venueSlug}" — skipping`);
      return { fetched: 0, upserted: 0, cancelled: 0 };
    }
  }

  const fetched = await dispatchFetch(sub);
  console.log(`  fetched ${fetched.length} events from ${sub.source}`);

  if (DRY_RUN) {
    console.log(
      `  [dry-run] would upsert ${fetched.length} events to public.events ` +
        `(venue_id=${venueId ?? "?"} / venue_name=${venueName ?? "?"})`,
    );
    return { fetched: fetched.length, upserted: 0, cancelled: 0 };
  }

  if (!supabase) throw new Error("Supabase client not initialised");
  if (!venueId || !venueName || !venueArea) {
    throw new Error(
      `Internal: venue lookup didn't populate required fields for ${sub.venueSlug}`,
    );
  }

  // ── Upsert ──────────────────────────────────────────────────────────
  //
  // Map FetchedEvent[] into public.events row shape. Re-running this
  // every cron tick is safe because of the (source, source_id) unique
  // constraint — ON CONFLICT just updates the existing row, refreshing
  // rating / time / price / etc. as the provider's data drifts.

  const nowIso = new Date().toISOString();
  const eventRows = fetched.map((e) => ({
    name: e.name,
    venue_name: venueName,
    venue_id: venueId,
    area: venueArea,
    date_label: dateLabelFor(new Date(e.starts_at)),
    time_label: e.time_label,
    starts_at: e.starts_at,
    price: e.price,
    category: e.category,
    img_url: e.img_url || venueImgUrl || FALLBACK_IMG_URL,
    source: sub.source,
    source_id: e.source_id,
    source_url: e.source_url,
    description: e.description,
    last_synced_at: nowIso,
    sold_out: e.sold_out,
  }));

  let upserted = 0;
  if (eventRows.length > 0) {
    const { error: upsertErr } = await supabase
      .from("events")
      .upsert(eventRows, { onConflict: "source,source_id" });
    if (upsertErr) {
      throw new Error(`upsert failed: ${upsertErr.message}`);
    }
    upserted = eventRows.length;
    console.log(`  ✓ upserted ${upserted} events`);
  }

  // ── Cancellation pass ──────────────────────────────────────────────
  //
  // Only run when the provider returned at least one event. An empty
  // response is ambiguous — could mean "no listings" OR "API blip" —
  // and we don't want to mass-cancel on a transient failure.
  //
  // When the provider DID return events, an existing future row whose
  // source_id is NOT in the fetched set means the organiser removed
  // or cancelled that listing. We set cancelled_at on those rows
  // (alert flag — UI can show "cancelled" without auto-hiding).

  let cancelled = 0;
  if (fetched.length > 0) {
    const { data: existing, error: existErr } = await supabase
      .from("events")
      .select("id, source_id")
      .eq("source", sub.source)
      .eq("venue_id", venueId)
      .gte("starts_at", nowIso)
      .is("cancelled_at", null);

    if (existErr) {
      throw new Error(`cancellation lookup failed: ${existErr.message}`);
    }

    const fetchedSourceIds = new Set(fetched.map((e) => e.source_id));
    const toCancel = (existing ?? []).filter(
      (e) => !fetchedSourceIds.has(e.source_id),
    );

    if (toCancel.length > 0) {
      const { error: cancelErr } = await supabase
        .from("events")
        .update({ cancelled_at: nowIso })
        .in(
          "id",
          toCancel.map((e) => e.id),
        );
      if (cancelErr) {
        throw new Error(`cancellation update failed: ${cancelErr.message}`);
      }
      cancelled = toCancel.length;
      console.log(`  ★ cancelled ${cancelled} events removed from provider`);
    }
  }

  return { fetched: fetched.length, upserted, cancelled };
}

// ── London-wide discovery processor ─────────────────────────────────────
//
// Upserts the broad London pull. These rows have venue_id = null (not a
// curated venue) and carry the venue identity Ticketmaster returned.
// Idempotent via the same (source, source_id) constraint. Skips any
// source_id already claimed by a curated subscription so we never write
// the same TM event twice with conflicting venue attribution.
async function processLondonDiscovery(excludeSourceIds: Set<string>): Promise<{
  fetched: number;
  upserted: number;
  removed: number;
}> {
  console.log(`\n→ ticketmaster · LONDON-WIDE discovery (top ${LONDON_DISCOVERY_TARGET})`);

  // Never let discovery clobber a curated row sharing the same TM id.
  // Exclude both the ids freshly fetched by subscriptions this run AND
  // any already-stored curated rows (venue_id IS NOT NULL). The upsert
  // keys on (source, source_id), so without this a discovery row would
  // overwrite the curated row and strip its venue attribution.
  const exclude = new Set(excludeSourceIds);
  if (supabase) {
    const { data: curatedRows } = await supabase
      .from("events")
      .select("source_id")
      .eq("source", "ticketmaster")
      .not("venue_id", "is", null);
    for (const r of curatedRows ?? []) exclude.add(r.source_id as string);
  }

  const all = await fetchLondonDiscovery();
  const candidates = all.filter((e) => !exclude.has(e.source_id));
  const selected = selectBalanced(candidates, LONDON_DISCOVERY_TARGET);
  console.log(
    `  fetched ${all.length} London events → ${selected.length} selected ` +
      `(balanced across categories, de-duped vs curated)`,
  );

  if (selected.length < LONDON_DISCOVERY_TARGET) {
    console.log(
      `  ⚠ only ${selected.length} available — below target of ` +
        `${LONDON_DISCOVERY_TARGET}. Keeping all we found.`,
    );
  }

  if (DRY_RUN) {
    console.log(`  [dry-run] would keep ${selected.length} London events:`);
    for (const e of selected) {
      console.log(
        `    · ${e.starts_at.slice(0, 10)} — ${e.name} @ ${e.venue_name} ` +
          `(${e.category})`,
      );
    }
    return { fetched: selected.length, upserted: 0, removed: 0 };
  }

  if (!supabase) throw new Error("Supabase client not initialised");

  const nowIso = new Date().toISOString();
  const eventRows = selected.map((e) => ({
    name: e.name,
    venue_name: e.venue_name ?? "London venue",
    venue_id: null,
    area: e.venue_area ?? "London",
    date_label: dateLabelFor(new Date(e.starts_at)),
    time_label: e.time_label,
    starts_at: e.starts_at,
    price: e.price,
    category: e.category,
    img_url: e.img_url || FALLBACK_IMG_URL,
    source: "ticketmaster",
    source_id: e.source_id,
    source_url: e.source_url,
    description: e.description,
    last_synced_at: nowIso,
    sold_out: e.sold_out,
  }));

  let upserted = 0;
  if (eventRows.length > 0) {
    const { error: upsertErr } = await supabase
      .from("events")
      .upsert(eventRows, { onConflict: "source,source_id" });
    if (upsertErr) {
      throw new Error(`London discovery upsert failed: ${upsertErr.message}`);
    }
    upserted = eventRows.length;
    console.log(`  ✓ kept ${upserted} London events`);
  }

  // Rotation cleanup — DELETE (not cancel) any discovery row that isn't
  // in the new top-N, INCLUDING ones whose date has slipped into the
  // past. These are ephemeral wide-open listings, not events a user
  // picked, so we trim them outright to keep the slice at exactly the
  // kept set. Scoped to venue_id IS NULL so curated rows are never
  // touched. No FK references point at public.events, so delete is safe.
  let removed = 0;
  if (selected.length > 0) {
    const { data: existing, error: existErr } = await supabase
      .from("events")
      .select("id, source_id")
      .eq("source", "ticketmaster")
      .is("venue_id", null);
    if (existErr) {
      throw new Error(
        `London discovery cleanup lookup failed: ${existErr.message}`,
      );
    }
    const keepIds = new Set(selected.map((e) => e.source_id));
    const toRemove = (existing ?? []).filter((e) => !keepIds.has(e.source_id));
    if (toRemove.length > 0) {
      const { error: delErr } = await supabase
        .from("events")
        .delete()
        .in(
          "id",
          toRemove.map((e) => e.id),
        );
      if (delErr) {
        throw new Error(`London discovery cleanup delete failed: ${delErr.message}`);
      }
      removed = toRemove.length;
      console.log(`  ★ removed ${removed} rotated-out London events`);
    }
  }

  return { fetched: selected.length, upserted, removed };
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const runCurated = MODE === "curated" || MODE === "both";
  const runDiscovery = MODE === "discovery" || MODE === "both";

  console.log(
    `Fun London — events ingestion · mode=${MODE} · ` +
      `${DRY_RUN ? "DRY RUN" : "WRITING"}\n`,
  );

  const tally = { fetched: 0, upserted: 0, deactivated: 0 };

  // ── Pass 1: curated per-venue subscriptions ──────────────────────────
  // Collect every source_id we pulled here so the London-wide pass can
  // skip duplicates (avoids two rows for the same TM event with
  // conflicting venue attribution).
  const subscriptionSourceIds = new Set<string>();

  if (runCurated) {
    for (const sub of EVENT_SUBSCRIPTIONS) {
      try {
        const fetched = await dispatchFetch(sub);
        for (const e of fetched) subscriptionSourceIds.add(e.source_id);
      } catch {
        // The per-subscription processor below logs its own failures;
        // this pre-fetch only populates the de-dupe set. Ignore here.
      }
    }

    for (const sub of EVENT_SUBSCRIPTIONS) {
      try {
        const r = await processSubscription(sub);
        tally.fetched += r.fetched;
        tally.upserted += r.upserted;
        tally.deactivated += r.cancelled;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ FAILED ${sub.source}/${sub.venueSlug}: ${msg}`);
      }
    }
  }

  // ── Pass 2: London-wide discovery (keeps a balanced top-N stocked) ───
  if (runDiscovery) {
    try {
      const r = await processLondonDiscovery(subscriptionSourceIds);
      tally.fetched += r.fetched;
      tally.upserted += r.upserted;
      tally.deactivated += r.removed;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ FAILED ticketmaster/London-discovery: ${msg}`);
    }
  }

  console.log("\n─────────── SUMMARY ───────────");
  console.log(`Mode:                    ${MODE}`);
  console.log(`Events fetched/kept:     ${tally.fetched}`);
  console.log(`Upserted:                ${tally.upserted}`);
  console.log(`Cancelled/removed:       ${tally.deactivated}`);
  console.log(`\n${DRY_RUN ? "Dry run complete." : "Ingestion complete."}`);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
