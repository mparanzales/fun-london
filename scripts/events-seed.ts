// Fun London — event source subscriptions.
//
// Tier 3 (events pipeline) is built around per-venue subscriptions to
// upstream event providers. Each entry tells the ingestion script:
//   "for the venue with this slug, poll this provider's feed for
//    upcoming events and pull anything in the next ~14 days."
//
// The shape differs from scripts/venues-seed.ts because:
// - Venues are a closed editorial set (you curate them once).
// - Events are a dynamic stream that changes weekly. We don't list
//   individual events here; we list the FEEDS that produce them.
//
// To add coverage for a venue:
//   1. Find the venue's page on the upstream provider (Eventbrite,
//      Skiddle, Ticketmaster, DICE).
//   2. Grab the provider-side venue id from the URL.
//   3. Append an entry below with the matching `venueSlug` from
//      scripts/venues-seed.ts.
// The ingest cron will pick it up on its next 4-hour run.

import type { EventCategory } from "@/lib/types";

export type EventSource =
  | "eventbrite"
  | "ticketmaster"
  | "skiddle"
  | "dice"
  | "manual";

// Per-provider config. Each provider exposes its own concept of "venue
// id" + sometimes other filters. Modelled as a discriminated union so
// the ingestion script can branch on `source` cleanly.
export type EventSubscription =
  | {
      source: "eventbrite";
      // Catalogue-venue subscription: identity (name/area/photo fallback)
      // resolves from our venues row by slug.
      venueSlug?: string; // matches scripts/venues-seed.ts slug
      // Organizer-first (pop-up) subscription: no catalogue venue. The
      // curator supplies the display identity when adding the organizer —
      // both fields required when venueSlug is absent. This replaced the
      // Gemini pop-up radar: real organizers' real events, hand-picked.
      venueName?: string;
      area?: string;
      eventbriteOrganizerId?: string; // Eventbrite's "organizer" id (preferred)
      eventbriteVenueId?: string; // Eventbrite venue id (fallback)
      defaultCategory: EventCategory; // mapped onto rows we ingest
      notes?: string;
    }
  | {
      source: "ticketmaster";
      venueSlug: string;
      ticketmasterVenueId: string; // K-prefixed id from Discovery API
      defaultCategory: EventCategory;
      notes?: string;
    }
  | {
      source: "skiddle";
      venueSlug: string;
      skiddleVenueId: string; // numeric id from Skiddle API
      defaultCategory: EventCategory;
      notes?: string;
    }
  | {
      source: "dice";
      venueSlug: string;
      diceVenueSlug: string; // dice.fm/venue/<slug>
      defaultCategory: EventCategory;
      notes?: string;
    };

// Starter coverage. Tightly scoped to venues already in the catalog so
// the first cron run can't accidentally ingest events at non-curated
// places. Expand once the first source is wired end-to-end.
//
// ── How to find the provider-side ids ──
// Eventbrite: https://www.eventbriteapi.com/v3/users/<organizer>/events/
//   — easiest way to find the organizer id is to view-source on the
//   venue's Eventbrite page and grep for `organizer_id`.
// Ticketmaster: Discovery API venue search:
//   GET /discovery/v2/venues.json?keyword=<venue name>&apikey=...
//   — returns id starting with `K`.
// Skiddle: https://www.skiddle.com/whats-on/<venue>.html — id is in URL.
// DICE: dice.fm/venue/<slug-from-url>.
export const EVENT_SUBSCRIPTIONS: EventSubscription[] = [
  // ── Live Music venues — ticketed event flows ─────────────────────
  {
    source: "ticketmaster",
    venueSlug: "ronnie-scotts",
    // Confirmed via Ticketmaster Discovery API venue search on 2026-05-28
    // — venue keyword "Ronnie Scotts" returns exactly one match at
    // 47 Frith Street, London. Real but sparse: at last check 2 events
    // in the next 90 days (mostly direct via ronniescotts.co.uk).
    ticketmasterVenueId: "KovZ9177Jn0",
    defaultCategory: "Music",
    notes:
      "Ronnie's tours through Ticketmaster for headline acts; weeknight " +
      "slots are direct via ronniescotts.co.uk. A venue-site scrape may " +
      "complement this later.",
  },
  // ── Pop-up organizers via Eventbrite (replaced the Gemini radar) ──
  // Rule: only organizers a curator has actually vetted. Every field
  // below is real data — the organizer id was resolved against the live
  // API and the event verified on eventbrite.co.uk before adding.
  {
    source: "eventbrite",
    // Organizer-first: the supper club runs at 64 Brick Ln, not a
    // catalogue venue.
    venueName: "Vegan Yes, 64 Brick Lane",
    area: "Brick Lane",
    // Chef Mauro — Italian x Korean fusion vegan supper club. Verified
    // live 2026-07-11: GET /v3/organizers/15216598761/events → 1 live
    // event ("Supper Club By Vegan Yes", 30 Jul).
    eventbriteOrganizerId: "15216598761",
    defaultCategory: "Food",
    notes: "First Eventbrite subscription — proof the adapter works end " +
      "to end. Maria reviews/expands the organizer list.",
  },
  // ── Future subscriptions to consider once each provider is wired ──
  //
  // Cafe OTO — has Ticketmaster venue id KovZpZAlv6tA but Ticketmaster
  // returned 0 events in our probe (they sell direct via cafeoto.co.uk).
  // Skiddle adapter is the more likely fit.
  //
  // Restaurants + bars + pubs (Brat, St. JOHN, Quo Vadis, Tayer +
  // Elementary, etc.) generally don't use Ticketmaster at all. The
  // Eventbrite venue-events endpoint can be used IF a specific venue
  // has a discoverable Eventbrite venue page — manual hunt per venue.
];

export function getSubscriptionsBySlug(slug: string): EventSubscription[] {
  return EVENT_SUBSCRIPTIONS.filter((s) => s.venueSlug === slug);
}
