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

export type BookingStatus = "pending" | "confirmed" | "cancelled" | "completed";

// ── Core entities ────────────────────────────────────────────────────────

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
  moodTags: Mood[];
  // vibeTags is free-form display strings (e.g. "Spicy", "Hand-rolled").
  // Not constrained to the Vibe enum, which is for filtering/preferences.
  vibeTags: string[];
  createdAt: string;
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

// ── Plan Together (mock multiplayer) ─────────────────────────────────────

export type Participant = {
  id: string;
  name: string; // "You" | "Maya" | "Tom" | "Alex"
  color: string; // HSL string used as avatar background
  emoji: string; // heart emoji used as avatar glyph (🧡 💖 💙 💜)
};
