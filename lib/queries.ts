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
};

// ── Mappers ─────────────────────────────────────────────────────────────

function mapVenue(r: VenueRow): Venue {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    type: r.type as VenueType,
    vibe: r.vibe,
    longDescription: r.long_description,
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
    createdAt: r.created_at,
  };
}

function mapEvent(r: EventRow): Event {
  return {
    id: r.id,
    name: r.name,
    venueName: r.venue_name,
    venueId: r.venue_id,
    area: r.area,
    dateLabel: r.date_label as DateLabel,
    timeLabel: r.time_label,
    startsAt: r.starts_at,
    price: r.price,
    category: r.category as EventCategory,
    imgUrl: r.img_url,
  };
}

// ── Queries ─────────────────────────────────────────────────────────────

export async function fetchVenues(): Promise<Venue[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("venues")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`fetchVenues: ${error.message}`);
  return (data as VenueRow[]).map(mapVenue);
}

export async function fetchVenueBySlug(slug: string): Promise<Venue | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("venues")
    .select("*")
    .eq("slug", slug)
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
    .maybeSingle();
  if (error) throw new Error(`fetchVenueById(${id}): ${error.message}`);
  return data ? mapVenue(data as VenueRow) : null;
}

export async function fetchEvents(): Promise<Event[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .order("starts_at", { ascending: true });
  if (error) throw new Error(`fetchEvents: ${error.message}`);
  return (data as EventRow[]).map(mapEvent);
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
};

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, preferences, onboarded")
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
  };
}
