// Domain types for Fun London — shared between consumer app and Partner Dashboard.
//
// These are app-layer types (camelCase). When Supabase is wired up, a thin mapper
// at the data layer translates snake_case rows into these shapes.

// ── Enums ────────────────────────────────────────────────────────────────

export type VenueType =
  | "Restaurant"
  | "Cafe"
  | "Bar"
  | "Wine Bar"
  | "Pub"
  | "Listening Bar"
  | "Live Music"
  | "Culture"
  | "Market"
  | "Outdoors";

export type PriceTier = "Free" | "£" | "££" | "£££";
export type TimeOfDay = "Day" | "Evening" | "Night";
export type Mood = "dinner" | "drinks" | "culture" | "activity";
export type Vibe = "chill" | "lively" | "fancy" | "unique";

export type DateLabel = "Tonight" | "This Weekend" | "This Week";
export type EventCategory = "Music" | "Food" | "Art" | "Comedy" | "Club";

// "self_added" = the user told us (via the post-handoff "Did you book?" prompt)
// that they reserved at the venue's own platform. Fun London did NOT make or
// verify this booking, so it must never be presented as "confirmed".
export type BookingStatus =
  | "pending"
  | "confirmed"
  | "cancelled"
  | "completed"
  | "self_added";

// Lifecycle states for an ingest candidate in public.pending_candidates.
// Mirrors the status CHECK in supabase/schema.sql — keep the two in sync.
// Shared so the admin actions + ingest script can type their status writes
// against it: a wrong value becomes a compile error, not a silent DB reject.
export const PENDING_CANDIDATE_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "snoozed",
  "ingested",
  "needs_review",
  "ingest_failed",
  "skipped",
] as const;
export type PendingCandidateStatus =
  (typeof PENDING_CANDIDATE_STATUSES)[number];

// ── Core entities ────────────────────────────────────────────────────────

// A bookable platform's link for a venue. Phase 4 supports multiple
// links per venue (Fun London = agent / aggregator, not locked to one).
// `priority` is 1 = best (e.g. official OpenTable for an OpenTable venue),
// higher numbers = fallback (e.g. the venue's own website).
export type BookingPlatform =
  | "opentable"
  | "resy"
  | "sevenrooms"
  | "thefork"
  | "quandoo"
  | "tablein"
  | "website";

export type BookingLink = {
  platform: BookingPlatform;
  url: string;
  priority: number;
};

// Provenance trail — every real venue must be cross-referenced in 2+
// independent publications before it lands in the catalog. Stored as a
// JSONB array on `venues.editorial_sources`.
export type EditorialSource = {
  publication: string; // "Time Out", "Eater London", "The Infatuation", etc.
  url: string;
  title?: string;
  date?: string; // ISO date when the source was published / last verified
  // Gate: only sources we have FETCHED and confirmed are (a) live and (b)
  // actually about this venue count toward the "Cross-checked" claim and
  // render in the UI. The original AI-discovered set was substantially
  // dead/recycled/mis-attributed, so absent-or-false = unverified → hidden
  // (the row is preserved in the DB; we re-enable per source as it passes).
  verified?: boolean;
};

// Third-party creator coverage (Phase 4.5). Surfaced in the "Why this is
// here" expandable on the venue detail page. Stored as JSONB array on
// `venues.creator_coverage`.
export type CreatorVerdict = "positive" | "mixed" | "critical";
export type CreatorCoverage = {
  creator: string; // "Topjaw", "Eating With Tod", "Bon Appétit"
  handle: string; // "@topjaw"
  platform: "tiktok" | "youtube" | "instagram" | "blog";
  url: string;
  verdict: CreatorVerdict;
  note?: string; // optional 1-line summary of what they said
  followerCount?: number; // optional
  verified?: boolean; // same gate as EditorialSource.verified — unverified is hidden
};

// "Real Talk" flags — honest concerns surfaced boldly in the UI, not
// buried. Stored as JSONB array on `venues.critical_flags`. Surfaced as
// labelled cards on the venue detail page.
export type CriticalFlag = {
  label: string; // "Expect a queue", "Chef change Jan 2024"
  body: string; // "Borough Market location, weekend mornings 20+ min standard"
};

// Phase 2 — a single Google review, stored VERBATIM. Never synthesize,
// translate, summarize, or reorder the text (Google display policy + the
// project's provenance-honesty rule — same lesson as the fabricated editorial
// sources). Stored as a JSONB array on `venues.reviews`; the UI must show a
// "Reviews from Google" attribution and the author per Google's policy.
export type VenueReview = {
  author: string; // authorAttribution.displayName
  rating: number; // 1–5
  text: string; // review.text.text, exactly as written
  relativeTime: string; // "2 weeks ago" (relativePublishTimeDescription)
  publishTime?: string; // ISO timestamp, optional
  authorPhotoUrl?: string; // keyless lh3.googleusercontent.com URL, optional
};

// Opening hours — normalized from Google Places `regularOpeningHours`.
// day = 0 (Sunday) … 6 (Saturday), matching JS Date.getDay(). A null
// `close` means the venue is open 24h that day. Periods can wrap past
// midnight (close.day may be the next day).
export type OpeningPoint = { day: number; hour: number; minute: number };
export type OpeningPeriod = { open: OpeningPoint; close: OpeningPoint | null };
export type OpeningHours = {
  periods: OpeningPeriod[];
  weekdayDescriptions?: string[]; // optional, for display
};

export type Venue = {
  id: string;
  slug: string;
  name: string;
  type: VenueType;
  vibe: string; // short tagline shown on cards
  longDescription: string; // 1–2 sentences shown on the detail screen
  neighbourhood: string;
  address: string;
  lat: number | null;
  lng: number | null;
  price: PriceTier;
  timeOfDay: TimeOfDay;
  rating: number;
  reviewCount: number;
  walkingMins: number; // walking time from a notional user location
  tablesFree: number; // small int — display as "N tables free"
  nextSlotLabel: string; // e.g. "9:00 PM" or "Open today"
  imgUrl: string;
  // Phase 2 — ordered keyless Storage URLs for the hero gallery; [0] === imgUrl.
  photoUrls: string[];
  moodTags: Mood[];
  // vibeTags is free-form display strings (e.g. "Spicy", "Hand-rolled").
  // Not constrained to the Vibe enum, which is for filtering/preferences.
  vibeTags: string[];
  // Phase 4 — real-venue ingestion. All nullable; demo venues leave blank.
  googlePlaceId: string | null;
  bookingLinks: BookingLink[] | null;
  websiteUrl: string | null;
  phone: string | null;
  instagramHandle: string | null;
  editorialSources: EditorialSource[] | null;
  // Phase 4.5 — third-party creator coverage + Real Talk flags.
  creatorCoverage: CreatorCoverage[] | null;
  criticalFlags: CriticalFlag[] | null;
  // Phase: real opening hours (Google Places), for "open when we meet".
  openingHours: OpeningHours | null;
  // Phase 2 — keyless Storage URL of a static map thumbnail (null = placeholder).
  mapUrl: string | null;
  // Phase 2 — verbatim Google reviews (signed-in only); null until synced.
  reviews: VenueReview[] | null;
  // Real menu URL discovered from the venue's own website (detail-only). Null
  // when none found; the "See the menu" button falls back to "Visit website".
  menuUrl: string | null;
  // "curated" = hand-picked seed venue; "discovered" = added by the autonomous
  // robot. Curated venues rank first. Defaults to "discovered".
  curationTier: "curated" | "discovered";
  createdAt: string;
};

// Partner BD prospect (Phase 4.5). Venues that pass editorial curation but
// have no major-platform booking. Stored in `public.partner_prospects`,
// locked to service-role only via RLS.
export type PartnerProspectStatus =
  | "prospect"
  | "contacted"
  | "in_conversation"
  | "partnered"
  | "declined"
  | "passed";

export type PartnerProspect = {
  id: string;
  name: string;
  googlePlaceId: string | null;
  type: VenueType | null;
  neighbourhood: string | null;
  address: string | null;
  websiteUrl: string | null;
  phone: string | null;
  instagramHandle: string | null;
  whyQualified: string | null;
  currentBookingMethod: string | null;
  editorialSources: EditorialSource[] | null;
  creatorCoverage: CreatorCoverage[] | null;
  criticalFlags: CriticalFlag[] | null;
  bdStatus: PartnerProspectStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Event = {
  id: string;
  name: string;
  venueName: string;
  venueId: string | null;
  area: string;
  dateLabel: DateLabel;
  timeLabel: string;
  startsAt: string;
  price: string;
  category: EventCategory;
  imgUrl: string;
  // Outbound ticket / event-detail URL (Ticketmaster, Eventbrite, the
  // venue's own site, etc.). Null for legacy manual demo rows.
  // Used as the click target on the event card.
  sourceUrl: string | null;
  // Pop-up radar: true when this row is a temporary pop-up (source='popup').
  // The card swaps the category pill for a "POP-UP" pill + "Ends <date>".
  isPopup: boolean;
  // The last day a pop-up runs (ISO). Null for normal one-off events.
  endsAt: string | null;
  // Short editorial blurb shown on the detail page. Null for legacy rows.
  description: string | null;
};

export type Booking = {
  id: string;
  userId: string;
  venueId: string;
  partySize: number;
  startsAt: string;
  status: BookingStatus;
  notes: string | null;
  createdAt: string;
};

export type User = {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  preferences: UserPreferences | null;
  onboarded: boolean;
  createdAt: string;
};

export type UserPreferences = {
  moods: Mood[];
  vibes: Vibe[];
  budget: PriceTier | null;
  areas: string[];
};

export type SavedVenue = {
  userId: string;
  venueId: string;
  createdAt: string;
};

// Subset of `User` that the consumer app actually reads from
// `public.profiles`. Phase 3.5 reads these three fields per auth user.
export type Profile = {
  id: string;
  displayName: string | null;
  preferences: UserPreferences | null;
  onboarded: boolean;
  emailWeeklyOptIn: boolean;
};

// ── Plan Together (mock multiplayer) ─────────────────────────────────────

export type Participant = {
  id: string;
  name: string; // "You" | "Maya" | "Tom" | "Alex"
  color: string; // HSL string used as avatar background
  emoji: string; // heart emoji used as avatar glyph (🧡 💖 💙 💜)
};
