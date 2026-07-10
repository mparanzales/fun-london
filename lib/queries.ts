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
import { haversineKm } from "@/lib/geo";
import { rankRowsByTaste } from "@/lib/taste-feed";
import { createServiceClient } from "@/lib/supabase/admin";
import { scoreVenue, hasPrefs } from "./ranking";
import { FEED_PAGE_SIZE } from "./feed-constants";
import { regionOf, type Region } from "@/lib/regions";
import { isOpenNow } from "@/lib/opening-hours";
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
  PlaceDetails,
  VenueReview,
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
  photo_urls: string[];
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
  map_url: string | null;
  reviews: VenueReview[] | null;
  // Optional so this stays safe if a row predates the plan_note column.
  plan_note?: string | null;
  menu_url: string | null;
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
  place_details: PlaceDetails | null;
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
    photoUrls: r.photo_urls ?? [],
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
    mapUrl: r.map_url ?? null,
    reviews: r.reviews,
    planNote: r.plan_note ?? null,
    menuUrl: r.menu_url ?? null,
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
    placeDetails: r.place_details ?? null,
  };
}

// ── Queries ─────────────────────────────────────────────────────────────

// ── Lean plan/saved catalogue ────────────────────────────────────────────
//
// /plan, /plan/together and /saved each need the WHOLE live catalogue in
// memory (the plan engine ranks/clusters across it; Saved filters it by the
// client-side saved set), but none of them render the heavy "moat" fields
// (reviews, long_description, editorial_sources, creator_coverage,
// critical_flags, map_url, photo_urls, etc.). The full select("*") in
// fetchVenues() serialised all of that into the RSC payload for ~2,100 rows.
//
// fetchPlanVenues() selects only the columns the engine reads + the cards
// render, with the SAME filters/order as fetchVenues, so behaviour is
// identical and only the payload shrinks. It differs from the anon
// VENUE_CARD_COLUMNS set by ALSO selecting the three fields the engine needs
// that mapVenuePreview blanks: vibe_tags (vibe scoring), opening_hours
// (open-at-arrival check) and plan_note (rendered on the result card).

// Columns the plan engine + plan/saved cards actually use. EXCLUDES every
// detail/moat column on purpose (reviews, long_description, editorial_sources,
// creator_coverage, critical_flags, map_url, photo_urls, mood_tags, address,
// booking_links, website_url, phone, instagram_handle, menu_url).
const VENUE_PLAN_COLUMNS =
  "id, slug, name, type, vibe, vibe_tags, neighbourhood, price, time_of_day, rating, review_count, lat, lng, opening_hours, plan_note, img_url, curation_tier, created_at";

type VenuePlanRow = Pick<
  VenueRow,
  | "id"
  | "slug"
  | "name"
  | "type"
  | "vibe"
  | "vibe_tags"
  | "neighbourhood"
  | "price"
  | "time_of_day"
  | "rating"
  | "review_count"
  | "lat"
  | "lng"
  | "opening_hours"
  | "plan_note"
  | "img_url"
  | "curation_tier"
  | "created_at"
>;

// Map a lean plan row to a Venue. Keeps the fields the engine/cards use
// (incl. vibe_tags, opening_hours, plan_note) and blanks the detail/moat
// fields that aren't selected — same discipline as mapVenuePreview, just a
// slightly wider keep-set.
function mapVenuePlan(r: VenuePlanRow): Venue {
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
    photoUrls: [],
    moodTags: [],
    vibeTags: r.vibe_tags ?? [],
    googlePlaceId: null,
    bookingLinks: null,
    websiteUrl: null,
    phone: null,
    instagramHandle: null,
    editorialSources: null,
    creatorCoverage: null,
    criticalFlags: null,
    openingHours: r.opening_hours,
    mapUrl: null,
    reviews: null,
    planNote: r.plan_note ?? null,
    menuUrl: null,
    curationTier: r.curation_tier === "curated" ? "curated" : "discovered",
    createdAt: r.created_at,
  };
}

// Whole live catalogue, LEAN columns only, for /plan + /plan/together + /saved.
// Same filters/order as fetchVenues (google_place_id present, not hidden, real
// non-Unsplash image, curated-first then created_at). Paginated past the
// 1000-row cap. The plan engine and the saved-list run entirely on this.
export async function fetchPlanVenues(): Promise<Venue[]> {
  const supabase = await createClient();
  const PAGE = 1000;
  const rows: VenuePlanRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("venues")
      .select(VENUE_PLAN_COLUMNS)
      .not("google_place_id", "is", null)
      .is("hidden_at", null)
      .not("img_url", "ilike", "%unsplash%")
      .neq("img_url", "")
      .order("curation_tier", { ascending: true })
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`fetchPlanVenues: ${error.message}`);
    const page = (data as VenuePlanRow[]) ?? [];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows.map(mapVenuePlan);
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
// Exported for the moat leak-guard test: this is the single enforcement point
// that keeps detail/moat fields out of every anon-facing path (feed + search).
export function mapVenuePreview(r: VenueCardRow): Venue {
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
    // Gallery is detail-only (the full select("*") fetch). The card/anon
    // preview keeps the single hero, so photo_urls stays OUT of the explicit
    // VENUE_CARD_COLUMNS — a deploy before the migration can't 400 the feed.
    photoUrls: [],
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
    mapUrl: null,
    reviews: null,
    planNote: null,
    menuUrl: null,
    curationTier: r.curation_tier === "curated" ? "curated" : "discovered",
    createdAt: r.created_at,
  };
}

// Card-level preview of the catalogue's first `limit` venues (same default
// order as fetchVenues: curated first, then by created_at). Sliced in the DB.
export async function fetchVenuePreview(limit: number): Promise<Venue[]> {
  // Fail-loud anon-preview guard — same rationale as fetchVenueCategoryPreview.
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error(
      `fetchVenuePreview: limit must be a positive number, got ${String(limit)}`,
    );
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("venues")
    .select(VENUE_CARD_COLUMNS)
    .not("google_place_id", "is", null)
    .is("hidden_at", null)
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
  const supabase = await createClient();
  const PAGE = 1000;
  const rows: VenueCardRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("venues")
      .select(VENUE_CARD_COLUMNS)
      .not("google_place_id", "is", null)
      .is("hidden_at", null)
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

// Server-only RICH search index for the signed-out catalogue search. The anon
// DB role is grant-blocked on the detail columns (vibe/mood tags,
// long_description, address, reviews — see the column-grant moat), so we read
// them here via the SERVICE-ROLE client SOLELY to build a match haystack.
//
// INVARIANT: only CARD-LEVEL venues are returned — `venue` is mapped through
// mapVenuePreview, which hard-blanks every detail/moat field, so the rich text
// is used for matching and NEVER leaves the server. (This is a deliberate,
// reviewed exception to the "service client = admin-gated only" rule: the caller
// is public, but no protected field is ever returned.) Returns null when no
// service-role key is configured, so the caller falls back to card-only search.
export type VenueSearchRow = { venue: Venue; haystack: string };
export async function fetchAllVenueSearchRows(): Promise<
  VenueSearchRow[] | null
> {
  const supabase = createServiceClient();
  if (!supabase) return null;
  const PAGE = 1000;
  const rows: VenueRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("venues")
      .select(
        `${VENUE_CARD_COLUMNS}, long_description, address, vibe_tags, mood_tags, reviews`,
      )
      .not("google_place_id", "is", null)
      .is("hidden_at", null)
      .not("img_url", "ilike", "%unsplash%")
      .neq("img_url", "")
      .order("curation_tier", { ascending: true })
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`fetchAllVenueSearchRows: ${error.message}`);
    const page = (data as VenueRow[]) ?? [];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows.map((r) => ({
    venue: mapVenuePreview(r),
    haystack: [
      ...(r.vibe_tags ?? []),
      ...(r.mood_tags ?? []),
      r.long_description ?? "",
      r.address ?? "",
      ...(r.reviews ?? []).map((rev) => rev.text),
    ].join(" "),
  }));
}

// Signed-in "For You" feed: card-level, RANKED ON THE SERVER. We fetch the card
// columns plus the two tag arrays the ranker needs (mood_tags / vibe_tags),
// score by the user's prefs here, then map to LIGHT cards. So the heavy tag
// arrays (some venues carry 60+ tags) never ship to the browser, and the client
// does no ranking and holds no tags. Paginated past PostgREST's 1000-row cap.
type FeedRankRow = VenueCardRow & {
  mood_tags: Mood[] | null;
  vibe_tags: string[] | null;
  // opening_hours is a moat column but the `authenticated` role reads it fine.
  // It stays on the server (feedPage filters "open now" here and never ships it
  // to the client — mapVenuePreview blanks openingHours), so the moat holds.
  opening_hours: OpeningHours | null;
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

// Cached card+tags index of the whole live catalogue, shared across requests
// (10-min TTL). Each feed-page request then ranks + slices THIS in memory
// instead of re-hitting the DB, so cursor pagination is cheap. Only card-level
// fields + the two ranking tag arrays are held; the tags never leave the server.
let venueIndexCache: { at: number; rows: FeedRankRow[] } | null = null;
const VENUE_INDEX_TTL_MS = 10 * 60 * 1000;

async function getVenueIndex(): Promise<FeedRankRow[]> {
  if (venueIndexCache && Date.now() - venueIndexCache.at < VENUE_INDEX_TTL_MS) {
    return venueIndexCache.rows;
  }
  const supabase = await createClient();
  const PAGE = 1000;
  const rows: FeedRankRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("venues")
      .select(`${VENUE_CARD_COLUMNS}, mood_tags, vibe_tags, opening_hours`)
      .not("google_place_id", "is", null)
      .is("hidden_at", null)
      .not("img_url", "ilike", "%unsplash%")
      .neq("img_url", "")
      .order("curation_tier", { ascending: true })
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`getVenueIndex: ${error.message}`);
    const page = (data as FeedRankRow[]) ?? [];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  venueIndexCache = { at: Date.now(), rows };
  return rows;
}

export type FeedFilter = "for-you" | "restaurants" | "bars" | "cafes" | "music";
export type FeedSort = "taste" | "nearest" | "rating";

const FEED_BAR_TYPES = ["Bar", "Wine Bar", "Pub", "Listening Bar"];
const FEED_MUSIC_TYPES = ["Live Music"];

function matchesFeedFilter(type: string, filter: FeedFilter): boolean {
  switch (filter) {
    case "restaurants":
      return type === "Restaurant";
    case "bars":
      return FEED_BAR_TYPES.includes(type);
    case "cafes":
      return type === "Cafe";
    case "music":
      return FEED_MUSIC_TYPES.includes(type);
    case "for-you":
      return true;
  }
}

// One page of the signed-in feed: filter by category, rank by taste (or sort by
// distance), slice [offset, offset+limit), and return LIGHT cards. The whole
// catalogue stays on the server; only one page of cards crosses the wire.
export async function feedPage(args: {
  prefs: UserPreferences | null;
  filter: FeedFilter;
  offset: number;
  limit: number;
  sort: FeedSort;
  lat?: number | null;
  lng?: number | null;
  userId?: string | null;
  // Refine filters (applied server-side over the whole in-memory index, so a
  // narrow filter still pages correctly instead of thinning out one page).
  price?: PriceTier[] | null;
  regions?: Region[] | null;
  openNow?: boolean;
}): Promise<{ venues: Venue[]; hasMore: boolean }> {
  const idx = await getVenueIndex();
  let rows = idx.filter((r) =>
    matchesFeedFilter(r.type as string, args.filter),
  );

  // Price: keep rows whose tier is in the chosen set (empty/absent = all).
  if (args.price && args.price.length > 0) {
    const want = new Set(args.price);
    rows = rows.filter((r) => want.has(r.price as PriceTier));
  }

  // Region: map each row's neighbourhood to its region and keep the chosen set.
  if (args.regions && args.regions.length > 0) {
    const want = new Set(args.regions);
    rows = rows.filter((r) => {
      const reg = r.neighbourhood ? regionOf(r.neighbourhood) : null;
      return reg != null && want.has(reg);
    });
  }

  // Open now: computed from opening_hours in Europe/London wall-clock. Rows with
  // unknown hours are dropped (we can't claim they're open).
  if (args.openNow) {
    const now = new Date();
    rows = rows.filter((r) => isOpenNow(r.opening_hours, now));
  }

  const quizSort = (prefs: UserPreferences) => {
    rows = rows
      .map((r) => ({ r, s: scoreFeedRow(r, prefs) }))
      .sort((a, b) => b.s - a.s)
      .map((x) => x.r);
  };

  if (args.sort === "rating") {
    // Top rated: highest star rating first, ties broken by review volume so a
    // 4.8 with 900 reviews outranks a 4.8 with 12.
    rows = [...rows].sort(
      (a, b) =>
        Number(b.rating) - Number(a.rating) ||
        Number(b.review_count) - Number(a.review_count),
    );
  } else if (args.sort === "nearest" && args.lat != null && args.lng != null) {
    const g = { lat: args.lat, lng: args.lng };
    rows = [...rows].sort((a, b) => {
      const da =
        a.lat != null && a.lng != null
          ? haversineKm(g, { lat: a.lat, lng: a.lng })
          : Infinity;
      const db =
        b.lat != null && b.lng != null
          ? haversineKm(g, { lat: b.lat, lng: b.lng })
          : Infinity;
      return da - db;
    });
  } else if (args.sort === "taste" && args.userId) {
    // Behavioural taste vector (Stage 2/3): centred-cosine + MMR. Falls back to
    // the onboarding-quiz sort when there's no signal/embeddings (rankRowsByTaste
    // returns null), which itself no-ops to the curated order when there are no
    // prefs — so the feed always has a sensible order.
    const ranked = await rankRowsByTaste(args.userId, rows);
    if (ranked) rows = ranked;
    else if (args.prefs && hasPrefs(args.prefs)) quizSort(args.prefs);
  } else if (args.prefs && hasPrefs(args.prefs)) {
    quizSort(args.prefs);
  }

  // Clamp offset/limit so a bad value (e.g. an undefined limit) can never
  // silently empty the feed via slice(0, NaN). Signed-in surface: degrade to
  // a normal page. The anon preview fetchers below deliberately THROW instead
  // — an un-capped anon read ships the whole catalogue, so they fail loud.
  const offset =
    Number.isFinite(args.offset) && args.offset > 0
      ? Math.floor(args.offset)
      : 0;
  const limit =
    Number.isFinite(args.limit) && args.limit > 0
      ? Math.floor(args.limit)
      : FEED_PAGE_SIZE;

  const page = rows.slice(offset, offset + limit);
  return {
    venues: page.map(mapVenuePreview),
    hasMore: offset + limit < rows.length,
  };
}

// Per-CATEGORY anonymous preview. So a signed-out visitor can switch the
// Explore chips (Eats / Bars / Cafés / Music) and each shows its own first few
// cards + the sign-up wall — like the For You preview — WITHOUT shipping the
// whole catalogue. We fetch only `perCategory` rows per category-group (plus a
// general curated head for For You), card-level fields only.
export async function fetchVenueCategoryPreview(
  perCategory: number,
): Promise<Venue[]> {
  // Fail loudly, never open: a non-numeric cap here once shipped the ENTIRE
  // catalogue to anonymous visitors (PREVIEW_COUNT imported across the
  // "use client" boundary arrived as undefined and .limit() silently dropped).
  if (!Number.isFinite(perCategory) || perCategory <= 0) {
    throw new Error(
      `fetchVenueCategoryPreview: perCategory must be a positive number, got ${String(perCategory)}`,
    );
  }
  const supabase = await createClient();
  const base = () =>
    supabase
      .from("venues")
      .select(VENUE_CARD_COLUMNS)
      .not("google_place_id", "is", null)
      .is("hidden_at", null)
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

// Tag-filter results for the venue page's vibe chips (/explore?tag=<tag>).
// Card-level fields only — same moat discipline as the previews — filtering
// the `vibe_tags` array with a containment match, best-rated first.
export async function fetchVenuesByTag(
  tag: string,
  limit: number,
): Promise<Venue[]> {
  // Catalogue pager: a broken limit must fail loud, not page the whole table.
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error(
      `fetchVenuesByTag: limit must be a positive number, got ${String(limit)}`,
    );
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("venues")
    .select(VENUE_CARD_COLUMNS)
    .contains("vibe_tags", [tag])
    .not("google_place_id", "is", null)
    .is("hidden_at", null)
    .not("img_url", "ilike", "%unsplash%")
    .neq("img_url", "")
    .order("curation_tier", { ascending: true })
    .order("rating", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`fetchVenuesByTag(${tag}): ${error.message}`);
  return (data as VenueCardRow[]).map(mapVenuePreview);
}

// Total catalogue size — for the hero trust strip ("N independent venues"),
// so the anonymous teaser can show the real count without fetching the rows.
export async function fetchVenueCount(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("venues")
    .select("id", { count: "exact", head: true })
    .not("google_place_id", "is", null)
    .is("hidden_at", null)
    // Never surface a venue on a stock (Unsplash) fallback or with no real
    // photo. Show a real Google Places photo (mirrored to our storage), or
    // nothing.
    .not("img_url", "ilike", "%unsplash%")
    .neq("img_url", "");
  if (error) throw new Error(`fetchVenueCount: ${error.message}`);
  return count ?? 0;
}

export async function fetchVenueBySlug(slug: string): Promise<Venue | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("venues")
    .select("*")
    .eq("slug", slug)
    .not("google_place_id", "is", null)
    .is("hidden_at", null)
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
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("venues")
    .select("*")
    .eq("id", id)
    .not("google_place_id", "is", null)
    .is("hidden_at", null)
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
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("venues")
    .select(VENUE_CARD_COLUMNS)
    .eq("slug", slug)
    .not("google_place_id", "is", null)
    .is("hidden_at", null)
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
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("venues")
    .select(VENUE_CARD_COLUMNS)
    .eq("id", id)
    .not("google_place_id", "is", null)
    .is("hidden_at", null)
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
  const supabase = await createClient();
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
    placeDetails: null, // moat: anon never gets the rich Place data
  };
}

export async function fetchEventPreview(limit: number): Promise<Event[]> {
  // Fail-loud anon-preview guard — same rationale as fetchEventCategoryPreview.
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error(
      `fetchEventPreview: limit must be a positive number, got ${String(limit)}`,
    );
  }

  const supabase = await createClient();
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
  const supabase = await createClient();
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
  // Same fail-loud guard as fetchVenueCategoryPreview: an undefined cap must
  // throw, not silently return the whole events catalogue to anon visitors.
  if (!Number.isFinite(perCategory) || perCategory <= 0) {
    throw new Error(
      `fetchEventCategoryPreview: perCategory must be a positive number, got ${String(perCategory)}`,
    );
  }
  const supabase = await createClient();
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
  const supabase = await createClient();
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
  const supabase = await createClient();
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
  // One column, paginated past the 1000-row cap. This used to call the old
  // fetchVenues() (a select("*") of the whole catalogue incl. every moat
  // field) just to read one string per row; that was fetchVenues' last
  // caller, so the select("*") catalogue read is now gone entirely.
  const supabase = await createClient();
  const PAGE = 1000;
  const names = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("venues")
      .select("neighbourhood")
      .not("google_place_id", "is", null)
      .is("hidden_at", null)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`fetchNeighbourhoods: ${error.message}`);
    const page = (data as { neighbourhood: string }[]) ?? [];
    for (const r of page) if (r.neighbourhood) names.add(r.neighbourhood);
    if (page.length < PAGE) break;
  }
  return Array.from(names).sort();
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
  const supabase = await createClient();
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
