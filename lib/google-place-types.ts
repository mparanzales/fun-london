// Fun London — classify a venue from GOOGLE'S OWN category, not from guessing.
//
// WHY THIS EXISTS (2026-08-07). Publishing used to derive `type` from keywords
// in the candidate's NAME, with `mapVenueType` falling through to
// `return "Restaurant"` when nothing matched — and `time_of_day` to "Evening",
// and moods to ["dinner"]. Audited against reality, 45% of one day's published
// venues were wrong: Osterley Bookshop, Burlington Arcade, The London Dungeon
// and a Victorian cabmen's hut all shipped as evening restaurants, which put
// them in the dinner pool of the night planner.
//
// THE RULE: Google already tells us what a business IS (`primaryType`, e.g.
// `book_store`, `art_museum`, `wine_bar`). We classify from that, against an
// explicit ALLOWLIST — and anything not on it is NOT PUBLISHABLE. Uncertainty
// stops (candidate → needs_review for a human) instead of defaulting to a
// guess. That is what makes published types trustworthy: not that the mapper
// is clever, but that it refuses to publish what it does not recognise.
//
// Type identifiers below are Google Places API (New) **Table A**, verified
// against developers.google.com/maps/documentation/places/web-service/
// place-types on 2026-08-07. Do not invent identifiers — a string Google
// never emits is a silently dead branch. Add new ones only from that table.

import type { Mood, TimeOfDay, VenueType } from "./types";

export type Classification = {
  type: VenueType;
  timeOfDay: TimeOfDay;
  moods: Mood[];
  // The Google type that decided it — for the audit trail on the row.
  matchedGoogleType: string;
};

// A Google type we deliberately REFUSE to publish, with the reason shown to
// the reviewer. These are not unknowns — they are known non-venues, and the
// distinction matters in the review queue.
const REFUSED: Record<string, string> = {
  book_store: "a shop, not a going-out venue",
  clothing_store: "a shop, not a going-out venue",
  womens_clothing_store: "a shop, not a going-out venue",
  shoe_store: "a shop, not a going-out venue",
  jewelry_store: "a shop, not a going-out venue",
  gift_shop: "a shop, not a going-out venue",
  furniture_store: "a shop, not a going-out venue",
  home_goods_store: "a shop, not a going-out venue",
  electronics_store: "a shop, not a going-out venue",
  department_store: "a shop, not a going-out venue",
  shopping_mall: "a shopping centre, not a going-out venue",
  store: "a generic shop, not a going-out venue",
  supermarket: "a supermarket",
  grocery_store: "a grocery shop",
  convenience_store: "a convenience shop",
  liquor_store: "an off-licence, not a bar",
  butcher_shop: "a food shop, not a place to eat in",
  health_food_store: "a food shop, not a place to eat in",
  meal_takeaway: "takeaway only, not a night out",
  meal_delivery: "delivery only, not a night out",
  pizza_delivery: "delivery only, not a night out",
  fast_food_restaurant: "fast food, not a night out",
  event_venue: "a hire venue, not a place you can just go to",
  banquet_hall: "a hire venue, not a place you can just go to",
  wedding_venue: "a hire venue, not a place you can just go to",
  convention_center: "a hire venue, not a place you can just go to",
  // Places of worship are deliberately NOT auto-published: St Paul's is a
  // destination, a parish church is not, and Google's type cannot tell them
  // apart. A genuinely visitable one usually ALSO carries
  // historical_landmark / cultural_landmark, which does publish.
  church: "a place of worship (publish only if it is a real visitor landmark)",
  mosque: "a place of worship (publish only if it is a real visitor landmark)",
  synagogue:
    "a place of worship (publish only if it is a real visitor landmark)",
  hindu_temple:
    "a place of worship (publish only if it is a real visitor landmark)",
  buddhist_temple:
    "a place of worship (publish only if it is a real visitor landmark)",
};

// ── The allowlist ───────────────────────────────────────────────────────────
// Ordered map: the FIRST entry whose set contains the Google type wins, so
// specific beats generic (a `gastropub` is a Pub before it is a Restaurant).

const PUB_TYPES = new Set(["pub", "irish_pub", "gastropub", "brewpub"]);

const WINE_TYPES = new Set(["wine_bar", "winery"]);

const BAR_TYPES = new Set([
  "bar",
  "cocktail_bar",
  "lounge_bar",
  "sports_bar",
  "hookah_bar",
  "beer_garden",
  "brewery",
]);

const LIVE_MUSIC_TYPES = new Set([
  "night_club",
  "live_music_venue",
  "concert_hall",
  "comedy_club",
  "karaoke",
  "dance_hall",
  "opera_house",
  "philharmonic_hall",
  "amphitheatre",
]);

const CAFE_TYPES = new Set([
  "cafe",
  "cafeteria",
  "coffee_shop",
  "coffee_stand",
  "coffee_roastery",
  "internet_cafe",
  "cat_cafe",
  "dog_cafe",
  "bakery",
  "cake_shop",
  "pastry_shop",
  "donut_shop",
  "bagel_shop",
  "dessert_shop",
  "dessert_restaurant",
  "ice_cream_shop",
  "acai_shop",
  "juice_shop",
  "salad_shop",
  "sandwich_shop",
  "snack_bar",
  "tea_house",
  "chocolate_shop",
  "confectionery",
  "deli",
]);

// Day-time eating places that are still restaurants by type.
const DAY_RESTAURANT_TYPES = new Set([
  "breakfast_restaurant",
  "brunch_restaurant",
]);

// Non-"*_restaurant" identifiers that are nonetheless proper restaurants.
const RESTAURANT_EXTRA_TYPES = new Set([
  "restaurant",
  "bistro",
  "diner",
  "steak_house",
  "food_court",
  "noodle_shop",
  "kebab_shop",
  "hot_pot_restaurant",
  "bar_and_grill",
]);

const MARKET_TYPES = new Set(["market", "farmers_market", "flea_market"]);

const CULTURE_TYPES = new Set([
  "museum",
  "art_museum",
  "history_museum",
  "art_gallery",
  "art_studio",
  "cultural_landmark",
  "cultural_center",
  "historical_place",
  "historical_landmark",
  "monument",
  "castle",
  "sculpture",
  "performing_arts_theater",
  "movie_theater",
  "planetarium",
  "observation_deck",
  "aquarium",
  "zoo",
  "wildlife_park",
  "visitor_center",
  "tourist_attraction",
  "amusement_park",
  "amusement_center",
  "video_arcade",
]);

const OUTDOORS_TYPES = new Set([
  "park",
  "city_park",
  "state_park",
  "national_park",
  "garden",
  "botanical_garden",
  "hiking_area",
  "plaza",
  "beach",
  "dog_park",
  "picnic_ground",
  "nature_preserve",
  "wildlife_refuge",
  "scenic_spot",
  "woods",
  "marina",
  "island",
  "lake",
  "river",
  "mountain_peak",
  "skateboard_park",
  "cycling_park",
  "vineyard",
]);

const MOODS_FOR: Record<VenueType, Mood[]> = {
  Restaurant: ["dinner"],
  Cafe: ["dinner"],
  Bar: ["drinks"],
  "Wine Bar": ["drinks"],
  Pub: ["drinks"],
  "Listening Bar": ["drinks"],
  "Live Music": ["drinks", "activity"],
  Culture: ["culture"],
  Market: ["activity"],
  Outdoors: ["activity"],
};

const TIME_FOR: Record<VenueType, TimeOfDay> = {
  Restaurant: "Evening",
  Cafe: "Day",
  Bar: "Evening",
  "Wine Bar": "Evening",
  Pub: "Evening",
  "Listening Bar": "Evening",
  "Live Music": "Night",
  Culture: "Day",
  Market: "Day",
  Outdoors: "Day",
};

// Map ONE Google type to a Fun London type, or null when it is not one we
// publish. Order encodes specificity.
function venueTypeFor(g: string): VenueType | null {
  if (PUB_TYPES.has(g)) return "Pub";
  if (WINE_TYPES.has(g)) return "Wine Bar";
  if (LIVE_MUSIC_TYPES.has(g)) return "Live Music";
  if (BAR_TYPES.has(g)) return "Bar";
  if (CAFE_TYPES.has(g)) return "Cafe";
  if (MARKET_TYPES.has(g)) return "Market";
  if (CULTURE_TYPES.has(g)) return "Culture";
  if (OUTDOORS_TYPES.has(g)) return "Outdoors";
  if (DAY_RESTAURANT_TYPES.has(g)) return "Restaurant";
  if (RESTAURANT_EXTRA_TYPES.has(g)) return "Restaurant";
  // The long tail of cuisines: every `*_restaurant` Google emits. Checked LAST
  // so `dessert_restaurant` lands in Cafe and `fast_food_restaurant` has
  // already been refused.
  if (g.endsWith("_restaurant") && !REFUSED[g]) return "Restaurant";
  return null;
}

export type ClassifyResult =
  { ok: true; classification: Classification } | { ok: false; reason: string };

/**
 * Classify from Google's own categories. FAILS CLOSED: when nothing in
 * `primaryType`/`types` is on the allowlist, returns ok:false and the caller
 * must route the candidate to human review rather than publish a guess.
 *
 * `primaryType` is preferred (Google's single best category); `types` is the
 * fallback, scanned in Google's own order, which is roughly most- to
 * least-specific.
 */
export function classifyFromGoogle(
  primaryType: string | null | undefined,
  types: readonly string[] | null | undefined,
): ClassifyResult {
  const all = [primaryType, ...(types ?? [])].filter(
    (t): t is string => typeof t === "string" && t.length > 0,
  );
  if (all.length === 0) {
    return { ok: false, reason: "Google returned no category for this place" };
  }

  for (const g of all) {
    const vt = venueTypeFor(g);
    if (vt) {
      return {
        ok: true,
        classification: {
          type: vt,
          timeOfDay: DAY_RESTAURANT_TYPES.has(g) ? "Day" : TIME_FOR[vt],
          moods: MOODS_FOR[vt],
          matchedGoogleType: g,
        },
      };
    }
  }

  // Nothing publishable. Prefer a NAMED refusal over "unrecognised" so the
  // reviewer sees why, e.g. "book_store — a shop, not a going-out venue".
  const refused = all.find((g) => REFUSED[g]);
  if (refused) {
    return { ok: false, reason: `${refused} · ${REFUSED[refused]}` };
  }
  return {
    ok: false,
    reason: `no publishable Google category (${all.slice(0, 3).join(", ")})`,
  };
}

// ── Opening-hours override ──────────────────────────────────────────────────

// Matches Google's own shape EXACTLY (lib/opening-hours.ts GooglePeriod):
// every field is optional, right down to day/hour/minute. Modelled that way
// rather than cast at the call site — a cast would have hidden that a period
// can arrive without an `open` at all, and every rule below dereferences it.
type Point = { day?: number; hour?: number; minute?: number };
type Period = { open?: Point | null; close?: Point | null };

// A period we can actually reason about: both ends present, with real numbers.
type SolidPeriod = {
  open: { day: number; hour: number; minute: number };
  close: { day: number; hour: number; minute: number };
};

function solidify(p: Period): SolidPeriod | null {
  const { open: o, close: c } = p;
  if (!o || !c) return null;
  if (typeof o.day !== "number" || typeof o.hour !== "number") return null;
  if (typeof c.day !== "number" || typeof c.hour !== "number") return null;
  return {
    open: { day: o.day, hour: o.hour, minute: o.minute ?? 0 },
    close: { day: c.day, hour: c.hour, minute: c.minute ?? 0 },
  };
}

/**
 * Correct `timeOfDay` using the venue's real hours, so a salt-beef counter
 * trading 07:00-16:00 is a Day spot even though its Google type says
 * Restaurant. Returns the input unchanged when hours are missing or when the
 * type is one whose daypart hours cannot sensibly override.
 *
 * Rules, deliberately conservative:
 *  - closes at or before 18:00 on every day it opens  → "Day"
 *  - opens at or after 21:00 on every day it opens    → "Night"
 *
 * 21:00 rather than 20:00 for the late threshold: plenty of ordinary
 * restaurants open at 20:00 for late dinner and are Evening, not Night.
 */
export function refineTimeOfDay(
  timeOfDay: TimeOfDay,
  periods: readonly Period[] | null | undefined,
): TimeOfDay {
  if (!periods || periods.length === 0) return timeOfDay;
  // Both ends must be present, with real numbers, to reason about a period.
  const usable = periods
    .map(solidify)
    .filter((p): p is SolidPeriod => p !== null);
  if (usable.length === 0) return timeOfDay; // 24h or malformed → leave it

  // Does this period run past midnight? Google normally signals that with a
  // close on the NEXT day, but a same-day close earlier than the open means
  // the same thing. Both must count as wrapping, or a bar open 21:00-03:00
  // reads as "closes at 3am, therefore a Day spot".
  const wraps = (p: SolidPeriod): boolean => {
    if (p.close.day !== p.open.day) return true;
    return (
      p.close.hour * 60 + p.close.minute <= p.open.hour * 60 + p.open.minute
    );
  };

  const closesEarly = usable.every((p) => {
    if (wraps(p)) return false;
    return p.close.hour * 60 + p.close.minute <= 18 * 60;
  });
  if (closesEarly) return "Day";

  const opensLate = usable.every((p) => p.open.hour >= 21);
  if (opensLate) return "Night";

  return timeOfDay;
}
