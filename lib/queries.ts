// ─────────────────────────────────────────────────────────────────────────
// Server-side data queries — Supabase replacements for the catalog
// accessors in lib/mock-data.ts.
//
// Pattern:
//   • All queries are async (Promise-returning).
//   • They use the SERVER Supabase client (lib/supabase/server.ts) so
//     they can only be called from Server Components, route handlers,
//     and server actions. Calling from a Client Component will throw.
//   • Snake_case DB columns are mapped to the camelCase `Venue` and
//     `Event` types the UI already uses.
//
// Scope: catalog only (venues + events). User-scoped data (saved,
// bookings, profile) lives elsewhere — those move to Supabase in
// Phase 3 after auth lands.
// ─────────────────────────────────────────────────────────────────────────

import { createClient } from "@/lib/supabase/server";
import { scoreVenue, hasPrefs } from "./ranking";
import type {
  Venue,
  Event,
  VenueType,
  PriceTier,
  TimeOfDay,
  Mood,
  DateLabel,
  EventCategory,
  Profile,
  UserPreferences,
  BookingLink,
  EditorialSource,
  CreatorCoverage,
  CriticalFlag,
  OpeningHours,
} from "./types";

// ── Row shapes (raw DB) ─────────────────────────────────────────────────

type VenueRow = {
  id: string;
  slug: string;
  name: string;
  type: string;
  vibe: string;
  long_description: string;
  neighbourhood: string;
  address: string;
  lat: number | null;
  lng: number | null;
  price: string;
  time_of_day: string;
  rating: number;
  review_count: number;
  walking_mins: number;
  tables_free: number;
  next_slot_label: string;
  img_url: string;
  mood_tags: string[];
  vibe_tags: string[];
  // Phase 4 — nullable on existing demo rows.
  google_place_id: string | null;
  booking_links: BookingLink[] | null;
  website_url: string | null;
  phone: string | null;
  instagram_handle: string | null;
  editorial_sources: EditorialSource[] | null;
  // Phase 4.5 — creator coverage + Real Talk flags.
  creator_coverage: CreatorCoverage[] | null;
  critical_flags: CriticalFlag[] | null;
  opening_hours: OpeningHours | null;
  // Optional so this stays safe if a row predates the curation_tier column.
  curation_tier?: string | null;
  created_at: string;
};

type EventRow = {
  id: string;
  name: string;
  venue_name: string;
  venue_id: string | null;
  area: string;
  date_label: string;
  time_label: string;
  starts_at: string;
  price: string;
  category: string;
  img_url: string;
  source_url: string | null;
  source: string | null;
  ends_at: string | null;
  description: string | null;
};

// ── Mappers ─────────────────────────────────────────────────────────────

// Tidy typographic dashes (— –) and spaced double hyphens out of copy that
// comes from the DATABASE (venue/event editorial written by curators or the
// discovery robot). The source-code dash guard can't see DB content, so this
// keeps the brand's "no dashes" rule consistent on cards and detail pages,
// for every existing row and every future one, with no re-import.
// Built via RegExp from an escaped string so the literal em/en dash characters
// never appear in this source file (the dash guard scans lib/ and would
// otherwise flag its own helper).
const DASH_RE = new RegExp("\\s*[\\u2014\\u2013]\\s*", "g"); // em / en dash
const DBL_HYPHEN_RE = / -{2} /g;

function tidyDashes<T extends string | null | undefined>(s: T): T {
  if (s == null) return s;
  return s.replace(DASH_RE, ", ").replace(DBL_HYPHEN_RE, ", ") as T;
}

function mapVenue(r: VenueRow): Venue {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    type: r.type as VenueType,
    vibe: tidyDashes(r.vibe),
    longDescription: tidyDashes(r.long_description),
    neighbourhood: r.neighbourhood,
    address: r.address,
    lat: r.lat,
    lng: r.lng,
    price: r.price as PriceTier,
    timeOfDay: r.time_of_day as TimeOfDay,
    rating: Number(r.rating),
    reviewCount: r.review_count,
    walkingMins: r.walking_mins,
    tablesFree: r.tables_free,
    nextSlotLabel: r.next_slot_label,
    imgUrl: r.img_url,
    moodTags: r.mood_tags as Mood[],
    vibeTags: r.vibe_tags,
    googlePlaceId: r.google_place_id,
    bookingLinks: r.booking_links,
    websiteUrl: r.website_url,
    phone: r.phone,
    instagramHandle: r.instagram_handle,
    editorialSources: r.editorial_sources,
    creatorCoverage: r.creator_coverage,
    criticalFlags:
      r.critical_flags?.map((f) => ({
        label: tidyDashes(f.label),
        body: tidyDashes(f.body),
      })) ?? null,
    openingHours: r.opening_hours,
    curationTier: r.curation_tier === "curated" ? "curated" : "discovered",
    createdAt: r.created_at,
  };
}

function mapEvent(r: EventRow): Event {
  return {
    id: r.id,
    name: tidyDashes(r.name),
    venueName: r.venue_name,
    venueId: r.venue_id,
    area: r.area,
    dateLabel: r.date_label as DateLabel,
    timeLabel: r.time_label,
    startsAt: r.starts_at,
    price: r.price,
    category: r.category as EventCategory,
    imgUrl: r.img_url,
    sourceUrl: r.source_url,
    isPopup: r.source === "popup",
    endsAt: r.ends_at,
    description: r.description,
  };
}

// ── Queries ─────────────────────────────────────────────────────────────

// Catalog read-side: only return venues that have been ingested from
// Google Places (google_place_id IS NOT NULL). The original demo seed
// rows remain in the DB so existing saved_venues / bookings rows stay
// FK-valid, but they're hidden from the user-facing catalog feed. To
// surface a former demo venue, ingest it via scripts/ingest-venues.ts.
export async function fetchVenues(): Promise<Venue[]> {
  const supabase = createClient();
  // Paginate past PostgREST's 1000-row cap. With >1000 live venues an
  // unpaginated select silently dropped everything after row 1000 (the entire
  // onezone import sorts last by created_at), so signed-in users were missing
  // ~half the catalogue in BOTH the feed and the in-memory search.
  const PAGE = 1000;
  const rows: VenueRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("venues")
      .select("*")
      .not("google_place_id", "is", null)
      // Never surface a venue on a stock (Unsplash) fallback or with no real
      // photo. Show a real Google Places photo (mirrored to our storage), or
      // nothing.
      .not("img_url", "ilike", "%unsplash%")
      .neq("img_url", "")
      // Curated (hand-picked) venues first — "curated" sorts before "discovered"
      // ascending — then stable by created_at.
      .order("curation_tier", { ascending: true })
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`fetchVenues: ${error.message}`);
    const page = (data as VenueRow[]) ?? [];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows.map(mapVenue);
}

// ── Anonymous metered preview ───────────────────────────────────────────
//
// The signed-out feed is a metered TEASER, not the catalogue. These two
// helpers exist so a Server Component can ship anonymous visitors ONLY a
// short, card-level slice — never the full catalogue and never the
// detail/"moat" fields (long_description, editorial_sources, creator_coverage,
// critical_flags, booking_links, phone, website_url, instagram_handle,
// address, google_place_id, opening_hours). That closes the hole where the
// whole catalogue shipped in the anonymous RSC payload.

// The safe subset the feed cards actually render. Excludes every sensitive /
// detail-only column on purpose. (google_place_id is filtered on below but not
// selected — PostgREST allows filtering an unselected column.)
const VENUE_CARD_COLUMNS =
  "id, slug, name, type, vibe, neighbourhood, price, time_of_day, rating, review_count, img_url, lat, lng, curation_tier, created_at";

type VenueCardRow = Pick<
  VenueRow,
  | "id"
  | "slug"
  | "name"
  | "type"
  | "vibe"
  | "neighbourhood"
  | "price"
  | "time_of_day"
  | "rating"
  | "review_count"
  | "img_url"
  | "lat"
  | "lng"
  | "curation_tier"
  | "created_at"
>;

// Map a card-only row to a Venue with every omitted field set to a safe
// empty/null default, so the Venue type holds without ever inventing data.
function mapVenuePreview(r: VenueCardRow): Venue {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    type: r.type as VenueType,
    vibe: tidyDashes(r.vibe),
    longDescription: "",
    neighbourhood: r.neighbourhood,
    address: "",
    lat: r.lat,
    lng: r.lng,
    price: r.price as PriceTier,
    timeOfDay: r.time_of_day as TimeOfDay,
    rating: Number(r.rating),
    reviewCount: r.review_count,
    walkingMins: 0,
    tablesFree: 0,
    nextSlotLabel: "",
    imgUrl: r.img_url,
    moodTags: [],
    vibeTags: [],
    googlePlaceId: null,
    bookingLinks: null,
    websiteUrl: null,
    phone: null,
    instagramHandle: null,
    editorialSources: null,
    creatorCoverage: null,
    criticalFlags: null,
    openingHours: null,
    curationTier: r.curation_tier === "curated" ? "curated" : "discovered",
    createdAt: r.created_at,
  };
}

// Card-level preview of the catalogue's first `limit` venues (same default
// order as fetchVenues: curated first, then by created_at). Sliced in the DB.
export async function fetchVenuePreview(limit: number): Promise<Venue[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("venues")
    .select(VENUE_CARD_COLUMNS)
    .not("google_place_id", "is", null)
    // Never surface a venue on a stock (Unsplash) fallback or with no real
    // photo. Show a real Google Places photo (mirrored to our storage), or
    // nothing.
    .not("img_url", "ilike", "%unsplash%")
    .neq("img_url", "")
    .order("curation_tier", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`fetchVenuePreview: ${error.message}`);
  return (data as VenueCardRow[]).map(mapVenuePreview);
}

// Full card-level catalogue (every live venue, card columns only) for the
// signed-out search action. Paginated past PostgREST's 1000-row cap. Mapped via
// mapVenuePreview, so the moat/detail fields are blanked and never leave the
// server, only matched cards are returned to the client.
export async function fetchAllVenueCards(): Promise<Venue[]> {
  const supabase = createClient();
  const PAGE = 1000;
  const rows: VenueCardRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("venues")
      .select(VENUE_CARD_COLUMNS)
      .not("google_place_id", "is", null)
      .not("img_url", "ilike", "%unsplash%")
      .neq("img_url", "")
      .order("curation_tier", { ascending: true })
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`fetchAllVenueCards: ${error.message}`);
    const page = (data as VenueCardRow[]) ?? [];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows.map(mapVenuePreview);
}

// Signed-in "For You" feed: card-level, RANKED ON THE SERVER. We fetch the card
// columns plus the two tag arrays the ranker needs (mood_tags / vibe_tags),
// score by the user's prefs here, then map to LIGHT cards. So the heavy tag
// arrays (some venues carry 60+ tags) never ship to the browser, and the client
// does no ranking and holds no tags. Paginated past PostgREST's 1000-row cap.
type FeedRankRow = VenueCardRow & {
  mood_tags: Mood[] | null;
  vibe_tags: string[] | null;
};

function scoreFeedRow(r: FeedRankRow, prefs: UserPreferences): number {
  // scoreVenue only reads moodTags / vibe / vibeTags / price / rating /
  // curationTier, so a minimal shape is enough.
  return scoreVenue(
    {
      moodTags: (r.mood_tags ?? []) as Mood[],
      vibe: r.vibe,
      vibeTags: r.vibe_tags ?? [],
      price: r.price as PriceTier,
      rating: Number(r.rating),
      curationTier: r.curation_tier === "curated" ? "curated" : "discovered",
    } as Venue,
    prefs,
  );
}

export async function fetchVenueFeed(
  prefs: UserPreferences | null,
): Promise<Venue[]> {
  const supabase = createClient();
  const PAGE = 1000;
  const rows: FeedRankRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("venues")
      .select(`${VENUE_CARD_COLUMNS}, mood_tags, vibe_tags`)
      .not("google_place_id", "is", null)
      .not("img_url", "ilike", "%unsplash%")
      .neq("img_url", "")
      .order("curation_tier", { ascending: true })
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`fetchVenueFeed: ${error.message}`);
    const page = (data as FeedRankRow[]) ?? [];
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  if (prefs && hasPrefs(prefs)) {
    const scored = rows.map((r) => ({ r, s: scoreFeedRow(r, prefs) }));
    scored.sort((a, b) => b.s - a.s); // V8 sort is stable: ties keep DB order
    return scored.map((x) => mapVenuePreview(x.r));
  }
  return rows.map(mapVenuePreview);
}

// Per-CATEGORY anonymous preview. So a signed-out visitor can switch the
// Explore chips (Eats / Bars / Cafés / Music) and each shows its own first few
// cards + the sign-up wall — like the For You preview — WITHOUT shipping the
// whole catalogue. We fetch only `perCategory` rows per category-group (plus a
// general curated head for For You), card-level fields only.
export async function fetchVenueCategoryPreview(
  perCategory: number,
): Promise<Venue[]> {
  const supabase = createClient();
  const base = () =>
    supabase
      .from("venues")
      .select(VENUE_CARD_COLUMNS)
      .not("google_place_id", "is", null)
      .not("img_url", "ilike", "%unsplash%")
      .neq("img_url", "")
      .order("curation_tier", { ascending: true })
      .order("created_at", { ascending: true });
  const [general, restaurants, bars, cafes, music] = await Promise.all([
    base().limit(perCategory), // For You head (curated first)
    base().eq("type", "Restaurant").limit(perCategory),
    base()
      .in("type", ["Bar", "Wine Bar", "Pub", "Listening Bar"])
      .limit(perCategory),
    base().eq("type", "Cafe").limit(perCategory),
    base().eq("type", "Live Music").limit(perCategory),
  ]);
  const groups = [general, restaurants, bars, cafes, music];
  for (const g of groups) {
    if (g.error)
      throw new Error(`fetchVenueCategoryPreview: ${g.error.message}`);
  }
  // Dedupe by id, keeping the general (curated) head first so For You is
  // unchanged, then the category buckets.
  const seen = new Set<string>();
  const out: VenueCardRow[] = [];
  for (const g of groups) {
    for (const row of (g.data as VenueCardRow[]) ?? []) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        out.push(row);
      }
    }
  }
  return out.map(mapVenuePreview);
}

// Total catalogue size — for the hero trust strip ("N independent venues"),
// so the anonymous teaser can show the real count without fetching the rows.
export async function fetchVenueCount(): Promise<number> {
  const supabase = createClient();
  const { count, error } = await supabase
    .from("venues")
    .select("id", { count: "exact", head: true })
    .not("google_place_id", "is", null)
    // Never surface a venue on a stock (Unsplash) fallback or with no real
    // photo. Show a real Google Places photo (mirrored to our storage), or
    // nothing.
    .not("img_url", "ilike", "%unsplash%")
    .neq("img_url", "");
  if (error) throw new Error(`fetchVenueCount: ${error.message}`);
  return count ?? 0;
}

export async function fetchVenueBySlug(slug: string): Promise<Venue | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("venues")
    .select("*")
    .eq("slug", slug)
    .not("google_place_id", "is", null)
    // Never surface a venue on a stock (Unsplash) fallback or with no real
    // photo. Show a real Google Places photo (mirrored to our storage), or
    // nothing.
    .not("img_url", "ilike", "%unsplash%")
    .neq("img_url", "")
    .maybeSingle();
  if (error) throw new Error(`fetchVenueBySlug(${slug}): ${error.message}`);
  return data ? mapVenue(data as VenueRow) : null;
}

export async function fetchVenueById(id: string): Promise<Venue | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("venues")
    .select("*")
    .eq("id", id)
    .not("google_place_id", "is", null)
    // Never surface a venue on a stock (Unsplash) fallback or with no real
    // photo. Show a real Google Places photo (mirrored to our storage), or
    // nothing.
    .not("img_url", "ilike", "%unsplash%")
    .neq("img_url", "")
    .maybeSingle();
  if (error) throw new Error(`fetchVenueById(${id}): ${error.message}`);
  return data ? mapVenue(data as VenueRow) : null;
}

// Card-level preview of a SINGLE venue for the signed-out detail page. Mirrors
// fetchVenueBySlug's gates but selects only VENUE_CARD_COLUMNS, so the moat
// fields (long_description, editorial_sources, creator_coverage, critical_flags,
// booking_links, phone, website_url, instagram_handle, address, google_place_id,
// opening_hours) never reach the anonymous client. The AuthWall covers the rest.
export async function fetchVenuePreviewBySlug(
  slug: string,
): Promise<Venue | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("venues")
    .select(VENUE_CARD_COLUMNS)
    .eq("slug", slug)
    .not("google_place_id", "is", null)
    .not("img_url", "ilike", "%unsplash%")
    .neq("img_url", "")
    .maybeSingle();
  if (error)
    throw new Error(`fetchVenuePreviewBySlug(${slug}): ${error.message}`);
  return data ? mapVenuePreview(data as VenueCardRow) : null;
}

// By-id variant — used for the linked venue card on the event detail page so a
// signed-out visitor never receives that venue's moat fields either.
export async function fetchVenuePreviewById(id: string): Promise<Venue | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("venues")
    .select(VENUE_CARD_COLUMNS)
    .eq("id", id)
    .not("google_place_id", "is", null)
    .not("img_url", "ilike", "%unsplash%")
    .neq("img_url", "")
    .maybeSingle();
  if (error) throw new Error(`fetchVenuePreviewById(${id}): ${error.message}`);
  return data ? mapVenuePreview(data as VenueCardRow) : null;
}

// Start of "today" in Europe/London, returned as a UTC Date. Uses Intl to read
// London's wall-clock for `now` (handles GMT/BST automatically) and derives the
// UTC instant of London midnight — no timezone library needed.
function startOfLondonDayUtc(now = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const p: Record<string, string> = {};
  for (const part of parts) p[part.type] = part.value;
  // London wall-clock of `now` read as if it were UTC, minus the real instant,
  // gives London's offset (e.g. +1h during BST).
  const asUtc = Date.UTC(
    +p.year,
    +p.month - 1,
    +p.day,
    +p.hour,
    +p.minute,
    +p.second,
  );
  const offsetMs = asUtc - now.getTime();
  // Midnight on London's calendar date, expressed as a real UTC instant.
  const londonMidnightAsUtc = Date.UTC(+p.year, +p.month - 1, +p.day, 0, 0, 0);
  return new Date(londonMidnightAsUtc - offsetMs);
}

export async function fetchEvents(): Promise<Event[]> {
  const supabase = createClient();
  // Only surface events from the start of today onward — a "what's on"
  // feed shouldn't list events that already happened. Using start-of-day
  // (rather than the exact current time) keeps events earlier today
  // visible all day rather than dropping them the moment they begin.
  // Computed in Europe/London (not UTC) so the boundary follows London
  // wall-clock — during BST a UTC midnight is an hour off and drops
  // late-night events.
  const startOfToday = startOfLondonDayUtc();
  // Paginate past the 1000-row cap (same reason as fetchVenues).
  const PAGE = 1000;
  const rows: EventRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("events")
      .select("*")
      .is("cancelled_at", null) // hide cancelled events / hidden pop-ups
      // Real images only. An event without its OWN image must never surface: we
      // never show a generic stock photo that isn't the event (a wrong photo is
      // a wrong "fact", against the cross-checked promise). Stock fallbacks were
      // Unsplash URLs; exclude those and any empty value. Ingestion now skips
      // image-less events at the source, so this is defence-in-depth.
      .not("img_url", "ilike", "%unsplash%")
      .neq("img_url", "")
      // Normal events: keep from the start of today onward. Pop-ups: ALSO keep
      // while their run is still on (they may have started in the past but
      // ends_at is today or later). cancelled_at doubles as the pop-up "hide".
      .or(
        `starts_at.gte.${startOfToday.toISOString()},ends_at.gte.${startOfToday.toISOString()}`,
      )
      .order("starts_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`fetchEvents: ${error.message}`);
    const page = (data as EventRow[]) ?? [];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows.map(mapEvent);
}

// ── Anonymous event preview (mirror of the venue preview) ───────────────
// Card-level columns only — never the sourceUrl/description detail. Same
// real-image + cancelled + date-window gates as fetchEvents.
const EVENT_CARD_COLUMNS =
  "id, name, venue_name, venue_id, area, date_label, time_label, starts_at, price, category, img_url, source, ends_at";

type EventCardRow = Pick<
  EventRow,
  | "id"
  | "name"
  | "venue_name"
  | "venue_id"
  | "area"
  | "date_label"
  | "time_label"
  | "starts_at"
  | "price"
  | "category"
  | "img_url"
  | "source"
  | "ends_at"
>;

function mapEventPreview(r: EventCardRow): Event {
  return {
    id: r.id,
    name: tidyDashes(r.name),
    venueName: r.venue_name,
    venueId: r.venue_id,
    area: r.area,
    dateLabel: r.date_label as DateLabel,
    timeLabel: r.time_label,
    startsAt: r.starts_at,
    price: r.price,
    category: r.category as EventCategory,
    imgUrl: r.img_url,
    sourceUrl: null,
    isPopup: r.source === "popup",
    endsAt: r.ends_at,
    description: null,
  };
}

export async function fetchEventPreview(limit: number): Promise<Event[]> {
  const supabase = createClient();
  const startOfToday = startOfLondonDayUtc();
  const { data, error } = await supabase
    .from("events")
    .select(EVENT_CARD_COLUMNS)
    .is("cancelled_at", null)
    .not("img_url", "ilike", "%unsplash%")
    .neq("img_url", "")
    .or(
      `starts_at.gte.${startOfToday.toISOString()},ends_at.gte.${startOfToday.toISOString()}`,
    )
    .order("starts_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`fetchEventPreview: ${error.message}`);
  return (data as EventCardRow[]).map(mapEventPreview);
}

// Full card-level upcoming events for the signed-out search action (paginated).
export async function fetchAllEventCards(): Promise<Event[]> {
  const supabase = createClient();
  const startOfToday = startOfLondonDayUtc();
  const PAGE = 1000;
  const rows: EventCardRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("events")
      .select(EVENT_CARD_COLUMNS)
      .is("cancelled_at", null)
      .not("img_url", "ilike", "%unsplash%")
      .neq("img_url", "")
      .or(
        `starts_at.gte.${startOfToday.toISOString()},ends_at.gte.${startOfToday.toISOString()}`,
      )
      .order("starts_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`fetchAllEventCards: ${error.message}`);
    const page = (data as EventCardRow[]) ?? [];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows.map(mapEventPreview);
}

// Per-CATEGORY anonymous event preview — same idea as the venue version, so the
// What's On category chips (Music / Food / Art / Comedy / Club / Pop-ups) each
// show their own first few cards + the wall, like the "All" view, without
// shipping the whole events catalogue.
export async function fetchEventCategoryPreview(
  perCategory: number,
): Promise<Event[]> {
  const supabase = createClient();
  const startOfToday = startOfLondonDayUtc();
  const base = () =>
    supabase
      .from("events")
      .select(EVENT_CARD_COLUMNS)
      .is("cancelled_at", null)
      .not("img_url", "ilike", "%unsplash%")
      .neq("img_url", "")
      .or(
        `starts_at.gte.${startOfToday.toISOString()},ends_at.gte.${startOfToday.toISOString()}`,
      )
      .order("starts_at", { ascending: true });
  const cats: EventCategory[] = ["Music", "Food", "Art", "Comedy", "Club"];
  const groups = await Promise.all([
    base().limit(perCategory), // "All" head
    ...cats.map((c) => base().eq("category", c).limit(perCategory)),
    base().eq("source", "popup").limit(perCategory), // Pop-ups
  ]);
  for (const g of groups) {
    if (g.error)
      throw new Error(`fetchEventCategoryPreview: ${g.error.message}`);
  }
  const seen = new Set<string>();
  const out: EventCardRow[] = [];
  for (const g of groups) {
    for (const row of (g.data as EventCardRow[]) ?? []) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        out.push(row);
      }
    }
  }
  return out.map(mapEventPreview);
}

export async function fetchEventById(id: string): Promise<Event | null> {
  const supabase = createClient();
  // Same gates as the feed: a hidden (cancelled) or stock-image (Unsplash /
  // empty) event must not be reachable by a direct /event/[id] link or bake
  // its stock photo into an OG image. maybeSingle() then returns null →
  // the detail page calls notFound().
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("id", id)
    .is("cancelled_at", null)
    .not("img_url", "ilike", "%unsplash%")
    .neq("img_url", "")
    .maybeSingle();
  if (error) throw new Error(`fetchEventById(${id}): ${error.message}`);
  return data ? mapEvent(data as EventRow) : null;
}

// Card-level preview of a SINGLE event for the signed-out detail page. Same
// gates as fetchEventById but selects only EVENT_CARD_COLUMNS — no source_url
// or description reaches the anonymous client.
export async function fetchEventPreviewById(id: string): Promise<Event | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("events")
    .select(EVENT_CARD_COLUMNS)
    .eq("id", id)
    .is("cancelled_at", null)
    .not("img_url", "ilike", "%unsplash%")
    .neq("img_url", "")
    .maybeSingle();
  if (error) throw new Error(`fetchEventPreviewById(${id}): ${error.message}`);
  return data ? mapEventPreview(data as EventCardRow) : null;
}

/**
 * Returns the list of unique neighbourhoods present in `venues`.
 * Useful for an "Areas you love" preference UI; currently used by no
 * page (the /plan area chips are hard-coded). Kept symmetric with the
 * mock-data accessor so future preference UI doesn't need a schema change.
 */
export async function fetchNeighbourhoods(): Promise<string[]> {
  const venues = await fetchVenues();
  return Array.from(new Set(venues.map((v) => v.neighbourhood))).sort();
}

// ── Profile ─────────────────────────────────────────────────────────────

type ProfileRow = {
  id: string;
  display_name: string | null;
  preferences: UserPreferences | null;
  onboarded: boolean;
  // Optional so this stays safe to deploy before the email-digest migration
  // runs — selecting "*" simply omits the column when it doesn't exist yet.
  email_weekly_opt_in?: boolean | null;
};

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const supabase = createClient();
  // select("*") rather than a column list so a not-yet-migrated DB (missing
  // email_weekly_opt_in) doesn't error — the field just reads as undefined.
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`fetchProfile(${userId}): ${error.message}`);
  if (!data) return null;
  const r = data as ProfileRow;
  return {
    id: r.id,
    displayName: r.display_name,
    preferences: r.preferences,
    onboarded: r.onboarded,
    emailWeeklyOptIn: r.email_weekly_opt_in ?? false,
  };
}
