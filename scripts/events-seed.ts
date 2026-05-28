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
      venueSlug: string; // matches scripts/venues-seed.ts slug
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
  // {
  //   source: "ticketmaster",
  //   venueSlug: "ronnie-scotts",
  //   ticketmasterVenueId: "KovZpZA17vJA", // PLACEHOLDER — confirm
  //   defaultCategory: "Music",
  //   notes:
  //     "Ronnie's tours through Ticketmaster for headline acts; smaller " +
  //     "weeknight slots are direct via ronniescotts.co.uk so a venue-site " +
  //     "scrape may complement this later.",
  // },
  // {
  //   source: "skiddle",
  //   venueSlug: "cafe-oto",
  //   skiddleVenueId: "TBD",
  //   defaultCategory: "Music",
  //   notes: "Cafe OTO mostly sells direct on cafeoto.co.uk; Skiddle may not cover all shows.",
  // },
  // ── Restaurant + bar venues — Eventbrite for one-off ticketed nights ─
  // {
  //   source: "eventbrite",
  //   venueSlug: "tayer-elementary",
  //   defaultCategory: "Music", // listening sessions / takeovers
  //   notes: "Look up the bar's organizer id once Eventbrite key is in place.",
  // },
];

export function getSubscriptionsBySlug(slug: string): EventSubscription[] {
  return EVENT_SUBSCRIPTIONS.filter((s) => s.venueSlug === slug);
}
