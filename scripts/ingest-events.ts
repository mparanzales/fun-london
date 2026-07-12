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
import { tmCategory } from "./event-category";

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

// Image hosts the Next.js <Image> optimizer is allowed to load — must
// stay in sync with the remotePatterns allowlist in next.config.js.
// Providers (especially the London-wide Ticketmaster discovery pull)
// return poster URLs from a grab-bag of CDNs; anything not on this
// list would render as a broken-image icon, so we drop it at ingest
// time. An event left with no real image is then NOT published — no stock
// fallback (a generic photo that isn't the event breaks the cross-checked
// promise, and made unrelated events share one image).
const ALLOWED_IMG_HOSTS = [
  "places.googleapis.com",
  "lh3.googleusercontent.com",
  "images.universe.com",
  // Eventbrite's event-artwork CDN — the organizer's own poster for the
  // specific event (real, not stock; the no-logos rule was about generic
  // brand marks standing in for events they don't depict).
  "img.evbuc.com",
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

// ── "Best of London" pull ───────────────────────────────────────────────
//
// the maintainer's call (2026-05-29, refined): the events tab should always feel
// alive AND feel like "things people who LIVE in London actually go to" —
// not tourist West End musicals. So rather than a generic city-wide
// Ticketmaster search (which surfaced Mamma Mia / Matilda / The Lion
// King), we pull from a hand-picked allowlist of independent London
// venues — Camden gig rooms, Hackney clubs, indie concert halls. Every
// venue below was confirmed (2026-05-29) to have a real Ticketmaster
// venue id AND upcoming events.
//
// These events are NOT tied to a curated catalogue venue (venue_id stays
// null — they don't get their own venue page), but they carry the real
// venue name + area so the card reads correctly. They're refreshed and
// trimmed to LONDON_DISCOVERY_TARGET each run. To add coverage, drop a
// new {name, area, tmVenueId} entry below — find the id via the
// Discovery API venue search (see scripts/events-seed.ts notes).
const LONDON_VENUES: { name: string; area: string; tmVenueId: string }[] = [
  { name: "Jazz Cafe", area: "Camden", tmVenueId: "KovZpZAnaJaA" },
  { name: "Electric Ballroom", area: "Camden", tmVenueId: "KovZ9177ARf" },
  { name: "KOKO", area: "Camden", tmVenueId: "KovZ91777W7" },
  { name: "Roundhouse", area: "Chalk Farm", tmVenueId: "KovZpZAn6k6A" },
  { name: "Union Chapel", area: "Islington", tmVenueId: "KovZ9177ko0" },
  {
    name: "Islington Assembly Hall",
    area: "Islington",
    tmVenueId: "KovZ9177akf",
  },
  { name: "The Lexington", area: "Islington", tmVenueId: "KovZ9177xRf" },
  { name: "Scala", area: "King's Cross", tmVenueId: "KovZ91776r0" },
  { name: "Troxy", area: "Limehouse", tmVenueId: "KovZ917AV2_" },
  { name: "100 Club", area: "Soho", tmVenueId: "KovZpZAnkn1A" },
  { name: "Bush Hall", area: "Shepherd's Bush", tmVenueId: "KovZpZAn1AAA" },
  { name: "Moth Club", area: "Hackney", tmVenueId: "KovZ91776m0" },
  { name: "Village Underground", area: "Shoreditch", tmVenueId: "KovZ9177OP0" },
  { name: "Hackney Empire", area: "Hackney", tmVenueId: "KovZ91770d7" },
  { name: "Cadogan Hall", area: "Chelsea", tmVenueId: "KovZpZAnan6A" },
];

const LONDON_DISCOVERY_TARGET = 15; // how many we keep stocked in the feed

// Pick a balanced top-N across categories: round-robin through the
// categories present, taking the soonest event from each in turn. Keeps
// the London-wide slice from being all-theatre. `events` is assumed
// already sorted soonest-first, so per-category order is preserved.
function selectBalanced(
  events: FetchedEvent[],
  target: number,
): FetchedEvent[] {
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
  // ISO timestamptz of the run's end, or null when the provider doesn't say.
  // Matters downstream: prune-expired-events keeps a row alive until ends_at
  // has passed, so multi-day runs must carry their real end.
  ends_at: string | null;
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

// Eventbrite killed platform-wide event search in Feb 2020 — the v3 API
// only lists events per ORGANIZER or per VENUE. So this adapter is
// subscription-shaped by necessity (and by taste: a curator picks whose
// events we trust, replacing the old AI pop-up radar with real data).
// Both endpoints verified live 2026-07-11 with the account's private
// token: /v3/organizers/{id}/events/?status=live works for arbitrary
// PUBLIC organizers, not just our own.
async function fetchEventbrite(
  sub: Extract<EventSubscription, { source: "eventbrite" }>,
): Promise<FetchedEvent[]> {
  const token = process.env.EVENTBRITE_PRIVATE_TOKEN;
  if (!token) {
    throw new Error(
      "EVENTBRITE_PRIVATE_TOKEN missing — adapter requires it. Add to " +
        ".env.local (local) and GitHub Actions secrets (cron).",
    );
  }

  const path = sub.eventbriteOrganizerId
    ? `organizers/${sub.eventbriteOrganizerId}/events/`
    : sub.eventbriteVenueId
      ? `venues/${sub.eventbriteVenueId}/events/`
      : null;
  if (!path) {
    console.error(
      `  ! eventbrite sub for "${sub.venueSlug ?? sub.venueName}" has ` +
        "neither eventbriteOrganizerId nor eventbriteVenueId — skipping",
    );
    return [];
  }

  const horizon = new Date();
  horizon.setDate(horizon.getDate() + EVENT_HORIZON_DAYS);

  // Live (public, upcoming) events only, soonest first. The endpoint
  // rejects page_size ("Unknown parameter" — learned from a live 400);
  // its default page (50) is far more than any single organizer/venue
  // runs inside the horizon. If that ever changes, follow
  // pagination.continuation.
  const params = new URLSearchParams({
    status: "live",
    order_by: "start_asc",
    expand: "ticket_availability",
  });
  const url = `https://www.eventbriteapi.com/v3/${path}?${params}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Eventbrite ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as EventbriteEventsResponse;

  // A truncated fetch would make the cancellation pass read absent-but-live
  // events as "removed by the organizer". Fail loud instead of guessing —
  // implement pagination.continuation if an organizer ever exceeds a page.
  if (json.pagination?.has_more_items) {
    throw new Error(
      "Eventbrite returned more than one page — pagination.continuation " +
        "not implemented; refusing to run against a truncated event set",
    );
  }

  return (json.events ?? [])
    .filter((e) => {
      const start = e.start?.utc ? new Date(e.start.utc) : null;
      return start !== null && start <= horizon;
    })
    .map((e) => ebToFetched(e, sub.defaultCategory))
    .filter((e): e is FetchedEvent => e !== null);
}

// ── Eventbrite response types (subset of what we actually read) ────────

type EventbriteEvent = {
  id: string;
  url?: string;
  name?: { text?: string };
  description?: { text?: string };
  start?: { utc?: string; local?: string };
  end?: { utc?: string; local?: string };
  logo?: { original?: { url?: string }; url?: string };
  ticket_availability?: {
    is_sold_out?: boolean;
    is_free?: boolean;
    minimum_ticket_price?: { major_value?: string; currency?: string };
  };
};

type EventbriteEventsResponse = {
  events?: EventbriteEvent[];
  pagination?: { has_more_items?: boolean; continuation?: string };
};

// Direct status check for one Eventbrite event. Used to CONFIRM a
// cancellation before stamping it: set-difference against one
// subscription's fetch can misread rows as "removed" when two
// subscriptions share a venueName or a fetch was somehow partial, and a
// wrong cancelled_at is permanent (upserts never clear it). Fail-SAFE:
// any doubt (missing token, rate limit, network) → treat as still live
// and skip the cancel this run; only a definitive gone (404) or a
// non-live status confirms.
async function eventbriteStillLive(sourceId: string): Promise<boolean> {
  const token = process.env.EVENTBRITE_PRIVATE_TOKEN;
  if (!token) return true;
  try {
    const res = await fetch(
      `https://www.eventbriteapi.com/v3/events/${sourceId}/`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (res.status === 404) return false; // definitively gone
    if (!res.ok) return true; // 429/5xx — can't confirm, don't cancel
    const json = (await res.json()) as { status?: string };
    return json.status === "live";
  } catch {
    return true; // network doubt — don't cancel
  }
}

function ebToFetched(
  e: EventbriteEvent,
  category: string,
): FetchedEvent | null {
  const name = e.name?.text?.trim();
  const startUtc = e.start?.utc;
  if (!name || !startUtc) return null;

  // start.local is "2026-07-30T19:00:00" — reuse the shared HH:mm → "7:00 PM"
  // formatter on its time part.
  const localTime = e.start?.local?.split("T")[1] ?? "";
  const timeLabel = localTime ? formatTimeLabel(localTime) : "Time TBD";

  const ta = e.ticket_availability;
  const minPrice = ta?.minimum_ticket_price;
  const minVal = Number(minPrice?.major_value);
  const cur =
    minPrice?.currency === "GBP"
      ? "£"
      : minPrice?.currency === "USD"
        ? "$"
        : (minPrice?.currency ?? "");
  const price =
    ta?.is_free || (minPrice && minVal === 0)
      ? "Free"
      : minPrice?.major_value && isFinite(minVal)
        ? `From ${cur}${minVal % 1 === 0 ? minVal.toFixed(0) : minPrice.major_value}`
        : "Tickets via Eventbrite";

  return {
    source_id: e.id,
    source_url: e.url ?? "",
    name,
    starts_at: startUtc,
    // Eventbrite always carries the run's end; without it a multi-day
    // residency looks "over" one day after it STARTS to the expiry prune.
    ends_at: e.end?.utc ?? null,
    time_label: timeLabel,
    price,
    // Eventbrite's format taxonomy is unreliable; the subscription's
    // curated defaultCategory is the honest label.
    category,
    // The organizer's own event artwork — real, not stock. Both variants
    // were live-verified on img.evbuc.com (the cdn.evbuc.com origin is
    // URL-encoded INSIDE the path); try each so a host change in one
    // variant can't silently zero the adapter's output.
    img_url: safeImageUrl(e.logo?.original?.url) || safeImageUrl(e.logo?.url),
    // Organizer-written copy — real words from the person running it.
    description: e.description?.text?.trim() || null,
    sold_out: ta?.is_sold_out ?? false,
  };
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

// "Best of London": walks the curated LONDON_VENUES allowlist, pulling
// each independent venue's upcoming Ticketmaster events, then merges +
// de-dupes soonest-first. Sourcing from a hand-picked set of local
// venues (vs a generic city search) is what keeps the feed full of
// things Londoners actually go to instead of tourist West End runs.
// Each event is stamped with its venue's real name + area from the
// allowlist (there's no curated catalogue row to attribute it to).
// Events without a usable poster are dropped here — the maintainer's call: skip
// them rather than show a generic placeholder.
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

  const byId = new Map<string, FetchedEvent>();
  // Ticketmaster returns the ATTRACTION/SERIES image, not a per-event poster —
  // so an artist's Early/Late shows, a venue's "+ Restaurant" package listings,
  // and a comedy/club SERIES all carry the SAME picture. Keep one event per
  // image so the feed never shows the same photo (and effectively the same
  // event) twice.
  const seenImages = new Set<string>();
  let first = true;
  for (const venue of LONDON_VENUES) {
    // Ticketmaster enforces a 5-requests/second "spike arrest". We fire
    // one query per venue, so pause between them to stay under the cap —
    // otherwise a venue silently 429s and drops out of the pull.
    if (!first) await sleep(250);
    first = false;

    const params = new URLSearchParams({
      venueId: venue.tmVenueId,
      startDateTime: isoNoMillis(now),
      endDateTime: isoNoMillis(horizon),
      sort: "date,asc",
      size: "20",
      apikey: apiKey,
    });
    const url = `https://app.ticketmaster.com/discovery/v2/events.json?${params}`;
    const res = await fetch(url);
    if (!res.ok) {
      // One venue failing shouldn't sink the whole pull. Log + continue.
      console.error(
        `  ! "${venue.name}" query ${res.status}: ${await res.text()}`,
      );
      continue;
    }
    const json = (await res.json()) as TicketmasterEventsResponse;
    for (const e of json._embedded?.events ?? []) {
      const base = tmToFetched(e);
      if (!base) continue;
      if (!base.img_url) continue; // drop poster-less events
      if (byId.has(base.source_id)) continue;
      if (seenImages.has(base.img_url)) continue; // one event per image
      seenImages.add(base.img_url);
      byId.set(base.source_id, {
        ...base,
        venue_name: venue.name,
        venue_area: venue.area,
      });
    }
  }

  // Merge across venues, soonest-first.
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
    // Rarely populated by Ticketmaster (mostly multi-day runs); map it
    // when present so the expiry prune sees the real end.
    end?: {
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
  // Drop events that don't map to one of our categories (Sports/Film/etc.)
  // rather than mislabelling them — keeps the feed honest and on-brand.
  const category = tmCategory(segment, genre);
  if (!category) return null;
  const soldOut =
    (e.dates?.status?.code ?? "").toLowerCase() === "cancelled" ||
    (e.dates?.status?.code ?? "").toLowerCase() === "offsale";

  const endsAt =
    e.dates?.end?.dateTime ??
    (e.dates?.end?.localDate
      ? `${e.dates.end.localDate}T${e.dates.end.localTime ?? "23:00:00"}Z`
      : null);

  return {
    source_id: e.id,
    source_url: e.url ?? "",
    name: e.name,
    starts_at: startsAt,
    ends_at: endsAt,
    time_label: timeLabel,
    price,
    category,
    img_url: safeImageUrl(img?.url),
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
    return `${cur}${min.toFixed(0)} to ${cur}${max.toFixed(0)}`;
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
  // Organizer-first subscriptions (pop-ups at non-catalogue addresses)
  // have no venueSlug: identity comes from the curated venueName/area on
  // the subscription, venue_id stays null (the schema allows it for
  // exactly this), and there's no venue-photo fallback — the event needs
  // its own real poster or it's skipped.
  const organizerFirst = sub.source === "eventbrite" && !sub.venueSlug;
  console.log(
    `\n→ ${sub.source} · ${sub.venueSlug ?? `organizer-first: ${sub.source === "eventbrite" ? sub.venueName : ""}`}`,
  );

  // Lookup venue identity + display fields once per subscription. We
  // need neighbourhood (→ events.area) and img_url (→ events.img_url
  // fallback when the provider doesn't return an image).
  let venueId: string | null = null;
  let venueName: string | null = null;
  let venueArea: string | null = null;
  let venueImgUrl: string | null = null;
  if (organizerFirst && sub.source === "eventbrite") {
    venueName = sub.venueName ?? null;
    venueArea = sub.area ?? null;
    if (!venueName || !venueArea) {
      console.error(
        "  ! organizer-first eventbrite sub needs BOTH venueName and area — skipping",
      );
      return { fetched: 0, upserted: 0, cancelled: 0 };
    }
  } else if (supabase) {
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
  // venueId is legitimately null for organizer-first subs; name + area
  // are required either way.
  if ((!organizerFirst && !venueId) || !venueName || !venueArea) {
    throw new Error(
      `Internal: venue lookup didn't populate required fields for ${sub.venueSlug ?? venueName}`,
    );
  }

  // ── Upsert ──────────────────────────────────────────────────────────
  //
  // Map FetchedEvent[] into public.events row shape. Re-running this
  // every cron tick is safe because of the (source, source_id) unique
  // constraint — ON CONFLICT just updates the existing row, refreshing
  // rating / time / price / etc. as the provider's data drifts.

  const nowIso = new Date().toISOString();
  // Real image only: the event's own provider poster, else the curated venue's
  // own (real) photo. No real image → the event is skipped, never a stock photo.
  const eventRows = fetched
    .map((e) => ({ e, img: e.img_url || venueImgUrl || "" }))
    .filter(({ e, img }) => {
      if (!img) console.log(`  ✗ ${e.name}: no real image, skipping`);
      return !!img;
    })
    .map(({ e, img }) => ({
      name: e.name,
      venue_name: venueName,
      venue_id: venueId,
      area: venueArea,
      date_label: dateLabelFor(new Date(e.starts_at)),
      time_label: e.time_label,
      starts_at: e.starts_at,
      ends_at: e.ends_at,
      price: e.price,
      category: e.category,
      img_url: img,
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
    // Scope to THIS subscription's rows. Catalogue subs own a venue_id;
    // organizer-first rows have venue_id null (`.eq(null)` would silently
    // match nothing) so they're scoped by their curated venue_name.
    let existingQuery = supabase
      .from("events")
      .select("id, source_id")
      .eq("source", sub.source)
      .gte("starts_at", nowIso)
      .is("cancelled_at", null);
    existingQuery = organizerFirst
      ? existingQuery.is("venue_id", null).eq("venue_name", venueName)
      : existingQuery.eq("venue_id", venueId);
    const { data: existing, error: existErr } = await existingQuery;

    if (existErr) {
      throw new Error(`cancellation lookup failed: ${existErr.message}`);
    }

    const fetchedSourceIds = new Set(fetched.map((e) => e.source_id));
    let toCancel = (existing ?? []).filter(
      (e) => !fetchedSourceIds.has(e.source_id),
    );

    // Eventbrite rows: absence from one sub's fetch is only a HINT (a
    // second sub at the same venueName, or a partial fetch, would look
    // identical) — and cancelled_at is permanent. Confirm each candidate
    // directly against the API; doubt means keep it live this run.
    if (sub.source === "eventbrite" && toCancel.length > 0) {
      const confirmed: typeof toCancel = [];
      for (const row of toCancel) {
        if (!(await eventbriteStillLive(row.source_id))) confirmed.push(row);
        else console.log(`  · ${row.source_id} still live upstream — kept`);
      }
      toCancel = confirmed;
    }

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
  console.log(
    `\n→ ticketmaster · BEST OF LONDON — independent venues ` +
      `(top ${LONDON_DISCOVERY_TARGET})`,
  );

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
    ends_at: e.ends_at,
    price: e.price,
    category: e.category,
    // Poster guaranteed non-empty — fetchLondonDiscovery drops events
    // without a usable image, so no generic placeholder is ever stored.
    img_url: e.img_url,
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
        throw new Error(
          `London discovery cleanup delete failed: ${delErr.message}`,
        );
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
  // Green-but-empty guard input: provider passes that THREW (outage/429/bad
  // key). Swallowing these kept the job green while ingesting nothing.
  let passFailures = 0;

  // ── Pass 1: curated per-venue subscriptions ──────────────────────────
  // Collect every source_id we pulled here so the London-wide pass can
  // skip duplicates (avoids two rows for the same TM event with
  // conflicting venue attribution).
  const subscriptionSourceIds = new Set<string>();

  if (runCurated) {
    for (const sub of EVENT_SUBSCRIPTIONS) {
      // The de-dupe set only protects against the TICKETMASTER London
      // discovery pull re-ingesting a subscription's event — other
      // providers' ids can't collide with it, so skipping them here
      // avoids a pointless duplicate API call per sub per run.
      if (sub.source !== "ticketmaster") continue;
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
        passFailures += 1;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `  ✗ FAILED ${sub.source}/${
            sub.venueSlug ?? (sub.source === "eventbrite" ? sub.venueName : "?")
          }: ${msg}`,
        );
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
      passFailures += 1;
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

  // Green-but-empty guard: at least one provider pass threw AND the whole run
  // ingested nothing -> fail loud so the alert fires. (A healthy run with some
  // provider keys simply absent still passes: its working providers fetch.)
  if (!DRY_RUN && tally.fetched === 0 && passFailures > 0) {
    console.error(
      `GREEN-BUT-EMPTY GUARD: ${passFailures} provider pass(es) failed and ` +
        `0 events were fetched. Exiting 1 so the alert fires.`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
