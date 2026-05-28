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

// How far ahead each provider adapter looks. Two months gives the
// `dateLabelFor` enough runway to flip events into "This Week" /
// "This Weekend" as the cron ticks every 4 hours.
const EVENT_HORIZON_DAYS = 60;

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
};

type TicketmasterEventsResponse = {
  _embedded?: { events?: TicketmasterEvent[] };
};

// Map Ticketmaster's segment → Fun London's EventCategory.
// Our union is "Music" | "Food" | "Art" | "Comedy" | "Club". We mostly
// see Music + Arts & Theatre + Sports at the venues in our catalog;
// Sports gets remapped to Music as a safe fallback because we wouldn't
// curate a sports venue anyway.
function tmCategory(segment: string | undefined): string {
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
    category: tmCategory(segment),
    img_url: img?.url ?? "",
    description: e.info ?? e.pleaseNote ?? null,
    sold_out: soldOut,
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

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log(
    `Fun London — events ingestion · ${EVENT_SUBSCRIPTIONS.length} subscription(s) · ${DRY_RUN ? "DRY RUN" : "WRITING"}\n`,
  );

  if (EVENT_SUBSCRIPTIONS.length === 0) {
    console.log(
      "No subscriptions registered yet. Add entries to scripts/events-seed.ts " +
        "as you get API keys for each provider.",
    );
    return;
  }

  const tally = { fetched: 0, upserted: 0, cancelled: 0 };

  for (const sub of EVENT_SUBSCRIPTIONS) {
    try {
      const r = await processSubscription(sub);
      tally.fetched += r.fetched;
      tally.upserted += r.upserted;
      tally.cancelled += r.cancelled;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ FAILED ${sub.source}/${sub.venueSlug}: ${msg}`);
    }
  }

  console.log("\n─────────── SUMMARY ───────────");
  console.log(`Subscriptions processed: ${EVENT_SUBSCRIPTIONS.length}`);
  console.log(`Events fetched:          ${tally.fetched}`);
  console.log(`Upserted:                ${tally.upserted}`);
  console.log(`Marked cancelled:        ${tally.cancelled}`);
  console.log(`\n${DRY_RUN ? "Dry run complete." : "Ingestion complete."}`);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
