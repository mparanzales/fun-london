// ─────────────────────────────────────────────────────────────────────────
// MOCK DATA — swap for Supabase queries in v2.
//
// This file is the SINGLE SOURCE OF TRUTH for all UI data in the consumer
// app while the backend is offline. No screen should hard-code its own
// venues, events, or user — import from here.
//
// When migrating to Supabase:
//   • MOCK_VENUES        → SELECT * FROM venues
//   • MOCK_EVENTS        → SELECT * FROM events
//   • MOCK_USER          → auth.getUser() + profiles row
//   • MOCK_SAVED_IDS     → SELECT venue_id FROM saved_venues WHERE user_id = $1
//   • MOCK_BOOKINGS      → SELECT * FROM bookings WHERE user_id = $1
//
// Replace the accessors at the bottom of this file with async Supabase
// calls; the screens should not need to change.
// ─────────────────────────────────────────────────────────────────────────

import type {
  Venue,
  Event,
  User,
  Booking,
  SavedVenue,
  Participant,
} from "./types";

// ── Venues ───────────────────────────────────────────────────────────────

export const MOCK_VENUES: Venue[] = [
  {
    id: "padella",
    slug: "padella",
    name: "Padella",
    type: "Restaurant",
    vibe: "Hand-rolled pasta, no reservations",
    longDescription:
      "Hand-rolled pasta at the window, no reservations, all evening. Queue moves fast, usually 30 to 40 min at peak.",
    neighbourhood: "London Bridge",
    address: "6 Southwark St, London SE1 1TQ",
    lat: 51.5054,
    lng: -0.0905,
    price: "££",
    timeOfDay: "Evening",
    rating: 4.8,
    reviewCount: 880,
    walkingMins: 8,
    tablesFree: 0,
    nextSlotLabel: "8:30 PM",
    imgUrl:
      "https://images.unsplash.com/photo-1551183053-bf91a1d81141?w=900&q=80&auto=format&fit=crop",
    moodTags: ["dinner"],
    vibeTags: ["Hand-rolled", "Lively"],
    createdAt: "2024-01-15T10:00:00Z",
  },
  {
    id: "dishoom",
    slug: "dishoom-shoreditch",
    name: "Dishoom Shoreditch",
    type: "Restaurant",
    vibe: "Bombay café buzzing with spice",
    longDescription:
      "Bombay café buzzing with spice. Hand-rolled flatbreads in a 1920s Bombay-style room. Walk-ins held 15 min. Open till 11pm tonight.",
    neighbourhood: "Shoreditch",
    address: "Boundary Street · Shoreditch",
    lat: 51.5257,
    lng: -0.0764,
    price: "££",
    timeOfDay: "Evening",
    rating: 4.7,
    reviewCount: 1240,
    walkingMins: 12,
    tablesFree: 2,
    nextSlotLabel: "9:00 PM",
    imgUrl:
      "https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=900&q=80&auto=format&fit=crop",
    moodTags: ["dinner"],
    vibeTags: ["Spicy", "Lively"],
    createdAt: "2024-01-15T10:00:00Z",
  },
  {
    id: "sager-wilde",
    slug: "sager-wilde",
    name: "Sager + Wilde",
    type: "Wine Bar",
    vibe: "Moody, low-lit, low-intervention wines",
    longDescription:
      "Moody, low-lit wine bar with low-intervention bottles. Skilled pours and a quiet room for talk.",
    neighbourhood: "Shoreditch",
    address: "193 Hackney Rd, London E2 8JL",
    lat: 51.5316,
    lng: -0.0716,
    price: "££",
    timeOfDay: "Night",
    rating: 4.6,
    reviewCount: 612,
    walkingMins: 15,
    tablesFree: 3,
    nextSlotLabel: "9:15 PM",
    imgUrl:
      "https://images.unsplash.com/photo-1516997121675-4c2d1684aa3e?w=900&q=80&auto=format&fit=crop",
    moodTags: ["drinks"],
    vibeTags: ["Moody", "Chill"],
    createdAt: "2024-01-15T10:00:00Z",
  },
  {
    id: "borough",
    slug: "borough-market",
    name: "Borough Market",
    type: "Market",
    vibe: "A thousand tiny tastings",
    longDescription:
      "Wandering food market under the railway arches. Stalls for everything from oysters to brownies. Bring an appetite.",
    neighbourhood: "London Bridge",
    address: "8 Southwark St, London SE1 1TL",
    lat: 51.5055,
    lng: -0.0909,
    price: "£",
    timeOfDay: "Day",
    rating: 4.7,
    reviewCount: 2100,
    walkingMins: 4,
    tablesFree: 0,
    nextSlotLabel: "Open till 5 PM",
    imgUrl:
      "https://images.unsplash.com/photo-1488459716781-31db52582fe9?w=900&q=80&auto=format&fit=crop",
    moodTags: ["activity"],
    vibeTags: ["Lively", "Daytime"],
    createdAt: "2024-01-15T10:00:00Z",
  },
  {
    id: "tate",
    slug: "tate-modern",
    name: "Tate Modern",
    type: "Culture",
    vibe: "Turbine Hall hush",
    longDescription:
      "Modern and contemporary art across seven floors of a former power station. Free permanent collection.",
    neighbourhood: "Southbank",
    address: "Bankside, London SE1 9TG",
    lat: 51.5076,
    lng: -0.0994,
    price: "Free",
    timeOfDay: "Day",
    rating: 4.6,
    reviewCount: 4321,
    walkingMins: 18,
    tablesFree: 0,
    nextSlotLabel: "Open till 6 PM",
    imgUrl:
      "https://images.unsplash.com/photo-1564399579883-451a5d44ec08?w=900&q=80&auto=format&fit=crop",
    moodTags: ["culture"],
    vibeTags: ["Cultural", "Chill"],
    createdAt: "2024-01-15T10:00:00Z",
  },
  {
    id: "bao",
    slug: "bao-soho",
    name: "Bao Soho",
    type: "Restaurant",
    vibe: "Pillowy buns, queue out the door",
    longDescription:
      "Pillowy steamed buns and Taiwanese small plates. Tiny dining room, so queue early or book on the dot.",
    neighbourhood: "Soho",
    address: "53 Lexington St, London W1F 9AS",
    lat: 51.5132,
    lng: -0.1372,
    price: "££",
    timeOfDay: "Evening",
    rating: 4.7,
    reviewCount: 1024,
    walkingMins: 6,
    tablesFree: 1,
    nextSlotLabel: "8:45 PM",
    imgUrl:
      "https://images.unsplash.com/photo-1496116218417-1a781b1c416c?w=900&q=80&auto=format&fit=crop",
    moodTags: ["dinner"],
    vibeTags: ["Pillowy", "Lively"],
    createdAt: "2024-01-15T10:00:00Z",
  },
  {
    id: "ronnies",
    slug: "ronnie-scotts",
    name: "Ronnie Scott's",
    type: "Live Music",
    vibe: "Jazz legends, red velvet",
    longDescription:
      "Soho's jazz institution since 1959. Red velvet booths, world-class musicians, intimate room.",
    neighbourhood: "Soho",
    address: "47 Frith St, London W1D 4HT",
    lat: 51.5135,
    lng: -0.1316,
    price: "£££",
    timeOfDay: "Night",
    rating: 4.7,
    reviewCount: 980,
    walkingMins: 10,
    tablesFree: 4,
    nextSlotLabel: "10:00 PM",
    imgUrl:
      "https://images.unsplash.com/photo-1501612780327-45045538702b?w=900&q=80&auto=format&fit=crop",
    moodTags: ["drinks", "culture"],
    vibeTags: ["Iconic", "Lively"],
    createdAt: "2024-01-15T10:00:00Z",
  },
  {
    id: "spiritland",
    slug: "spiritland",
    name: "Spiritland",
    type: "Listening Bar",
    vibe: "Audiophile sound, cocktails in amber",
    longDescription:
      "Audiophile listening bar with custom Living Voice speakers. Cocktails in amber light, conversation kept low.",
    neighbourhood: "King's Cross",
    address: "9-10 Stable St, London N1C 4AB",
    lat: 51.5364,
    lng: -0.1265,
    price: "££",
    timeOfDay: "Night",
    rating: 4.6,
    reviewCount: 540,
    walkingMins: 22,
    tablesFree: 2,
    nextSlotLabel: "9:30 PM",
    imgUrl:
      "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=900&q=80&auto=format&fit=crop",
    moodTags: ["drinks"],
    vibeTags: ["Audiophile", "Chill"],
    createdAt: "2024-01-15T10:00:00Z",
  },
  {
    id: "barbican",
    slug: "barbican-conservatory",
    name: "Barbican Conservatory",
    type: "Culture",
    vibe: "Brutalist jungle, Sundays only",
    longDescription:
      "Brutalist concrete jungle hiding a lush conservatory of 1,500 plants and tropical fish. Open Sundays only.",
    neighbourhood: "Barbican",
    address: "Silk St, London EC2Y 8DS",
    lat: 51.52,
    lng: -0.0936,
    price: "Free",
    timeOfDay: "Day",
    rating: 4.8,
    reviewCount: 312,
    walkingMins: 14,
    tablesFree: 0,
    nextSlotLabel: "Open Sun · noon",
    imgUrl:
      "https://images.unsplash.com/photo-1545569310-1bd9be5ca93b?w=900&q=80&auto=format&fit=crop",
    moodTags: ["culture"],
    vibeTags: ["Hidden", "Chill"],
    createdAt: "2024-01-15T10:00:00Z",
  },
  {
    id: "camden",
    slug: "camden-market",
    name: "Camden Market",
    type: "Market",
    vibe: "Canalside, chaotic, delicious",
    longDescription:
      "Canalside maze of food stalls, vintage clothes, and live music. Chaotic in the best way.",
    neighbourhood: "Camden",
    address: "Camden Lock Pl, London NW1 8AF",
    lat: 51.5414,
    lng: -0.1466,
    price: "£",
    timeOfDay: "Day",
    rating: 4.4,
    reviewCount: 2890,
    walkingMins: 28,
    tablesFree: 0,
    nextSlotLabel: "Open till 7 PM",
    imgUrl:
      "https://images.unsplash.com/photo-1578916171728-46686eac8d58?w=900&q=80&auto=format&fit=crop",
    moodTags: ["activity"],
    vibeTags: ["Lively", "Daytime"],
    createdAt: "2024-01-15T10:00:00Z",
  },
  {
    id: "monmouth",
    slug: "monmouth-coffee",
    name: "Monmouth Coffee",
    type: "Cafe",
    vibe: "Roaster's bench, single-origin beans",
    longDescription:
      "Roaster's bench, single-origin beans, no laptops. Order the filter and watch them weigh out the dose.",
    neighbourhood: "London Bridge",
    address: "2 Park St, London SE1 9AB",
    lat: 51.505,
    lng: -0.0903,
    price: "£",
    timeOfDay: "Day",
    rating: 4.6,
    reviewCount: 410,
    walkingMins: 5,
    tablesFree: 1,
    nextSlotLabel: "Open till 6 PM",
    imgUrl:
      "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=900&q=80&auto=format&fit=crop",
    moodTags: ["activity"],
    vibeTags: ["Quiet", "Daytime"],
    createdAt: "2024-01-15T10:00:00Z",
  },
];

// ── Events ───────────────────────────────────────────────────────────────

export const MOCK_EVENTS: Event[] = [
  {
    id: "jazz",
    name: "Jazz & Soul Night",
    venueName: "Ronnie Scott's",
    venueId: "ronnies",
    area: "Soho",
    dateLabel: "Tonight",
    timeLabel: "8:00 PM",
    startsAt: "2026-05-12T20:00:00Z",
    price: "£25",
    category: "Music",
    imgUrl:
      "https://images.unsplash.com/photo-1501612780327-45045538702b?w=900&q=80&auto=format&fit=crop",
  },
  {
    id: "comedy",
    name: "Stand-Up Showcase",
    venueName: "The Comedy Store",
    venueId: null,
    area: "Soho",
    dateLabel: "Tonight",
    timeLabel: "9:00 PM",
    startsAt: "2026-05-12T21:00:00Z",
    price: "£15",
    category: "Comedy",
    imgUrl:
      "https://images.unsplash.com/photo-1585699324551-f6c309eedeca?w=900&q=80&auto=format&fit=crop",
  },
  {
    id: "street-food",
    name: "Street Food Festival",
    venueName: "Camden Market",
    venueId: "camden",
    area: "Camden",
    dateLabel: "This Weekend",
    timeLabel: "12:00 PM",
    startsAt: "2026-05-16T12:00:00Z",
    price: "Free",
    category: "Food",
    imgUrl:
      "https://images.unsplash.com/photo-1578916171728-46686eac8d58?w=900&q=80&auto=format&fit=crop",
  },
  {
    id: "fabric",
    name: "Warehouse Techno",
    venueName: "Fabric",
    venueId: null,
    area: "Farringdon",
    dateLabel: "This Weekend",
    timeLabel: "11:00 PM",
    startsAt: "2026-05-16T23:00:00Z",
    price: "£20",
    category: "Club",
    imgUrl:
      "https://images.unsplash.com/photo-1571266028243-e4733b0f0bb0?w=900&q=80&auto=format&fit=crop",
  },
  {
    id: "art",
    name: "Immersive Art: Dreams",
    venueName: "180 The Strand",
    venueId: null,
    area: "Aldwych",
    dateLabel: "This Week",
    timeLabel: "10:00 AM",
    startsAt: "2026-05-14T10:00:00Z",
    price: "£18",
    category: "Art",
    imgUrl:
      "https://images.unsplash.com/photo-1561214115-f2f134cc4912?w=900&q=80&auto=format&fit=crop",
  },
];

// ── User ─────────────────────────────────────────────────────────────────

export const MOCK_USER: User = {
  id: "user-demo",
  email: "demo@funlondon.app",
  displayName: "the maintainer",
  avatarUrl: null,
  preferences: {
    moods: ["dinner", "drinks"],
    vibes: ["chill"],
    budget: "££",
    areas: ["Shoreditch", "Soho"],
  },
  onboarded: true,
  createdAt: "2024-01-15T10:00:00Z",
};

// Saved venues for the demo user.
export const MOCK_SAVED_IDS: string[] = ["dishoom", "borough"];

/**
 * Forward-looking: matches the `saved_venues` Supabase table shape.
 * Currently the consumer app reads from `MOCK_SAVED_IDS` directly; this
 * full-shape array is kept so the Partner Dashboard (or future analytics)
 * can read joined rows without a schema change.
 *
 * @unused Kept for forward-compatibility; remove when Supabase ships.
 */
export const MOCK_SAVED_VENUES: SavedVenue[] = MOCK_SAVED_IDS.map(
  (venueId) => ({
    userId: MOCK_USER.id,
    venueId,
    createdAt: "2024-02-01T10:00:00Z",
  }),
);

/**
 * Empty for MVP — the consumer app doesn't render bookings yet. Shape is
 * defined so Partner Dashboard / future booking flows can read it without
 * a schema change.
 *
 * @unused Kept for forward-compatibility.
 */
export const MOCK_BOOKINGS: Booking[] = [];

// ── Accessor helpers ─────────────────────────────────────────────────────
// Replace bodies with Supabase queries when migrating.

export function getVenues(): Venue[] {
  return MOCK_VENUES;
}

/**
 * Forward-looking accessor. Currently unused — most callers know slug,
 * not id. Kept so internal-services / partner code can look up by id.
 *
 * @unused Kept symmetric with getVenueBySlug.
 */
export function getVenueById(id: string): Venue | undefined {
  return MOCK_VENUES.find((v) => v.id === id);
}

export function getVenueBySlug(slug: string): Venue | undefined {
  return MOCK_VENUES.find((v) => v.slug === slug);
}

export function getEvents(): Event[] {
  return MOCK_EVENTS;
}

/**
 * Forward-looking. The consumer app reads saved IDs through the
 * SavedProvider context (which seeds from MOCK_SAVED_IDS directly). This
 * accessor exists so server-side rendering or migration scripts can read
 * the same data without touching React state.
 *
 * @unused Kept for forward-compatibility.
 */
export function getSavedVenueIds(): string[] {
  return MOCK_SAVED_IDS;
}

export function getSavedVenues(savedIds: Iterable<string>): Venue[] {
  const set = new Set(savedIds);
  return MOCK_VENUES.filter((v) => set.has(v.id));
}

export function getCurrentUser(): User {
  return MOCK_USER;
}

/**
 * Returns the unique sorted list of neighbourhoods present in MOCK_VENUES.
 * Currently unused — `/plan` hardcodes the area chips. Kept for the
 * future "Areas you love" preferences UI.
 *
 * @unused Kept for forward-compatibility.
 */
export function getNeighbourhoods(): string[] {
  return Array.from(new Set(MOCK_VENUES.map((v) => v.neighbourhood))).sort();
}

// ── Plan Together — mock multiplayer participants ────────────────────────
// Colors and emoji mirror the prototype's plan-together.jsx voter palette.

export const MOCK_PARTICIPANTS: Participant[] = [
  { id: "you", name: "You", color: "hsl(20 90% 55%)", emoji: "🧡" },
  { id: "maya", name: "Maya", color: "hsl(330 80% 60%)", emoji: "💖" },
  { id: "tom", name: "Tom", color: "hsl(220 80% 60%)", emoji: "💙" },
  { id: "alex", name: "Alex", color: "hsl(280 70% 65%)", emoji: "💜" },
];

export function getParticipants(): Participant[] {
  return MOCK_PARTICIPANTS;
}
