// Shared test fixtures. NOT a test file (no *.test.ts suffix) so the runner
// won't try to execute it — it just provides factories.

import type { Venue } from "@/lib/types";

// Build a Venue with sensible defaults; override only the fields a test cares
// about. Cast through the full shape so callers stay terse.
export function makeVenue(partial: Partial<Venue> = {}): Venue {
  return {
    id: "v1",
    slug: "v1",
    name: "Test Venue",
    type: "Restaurant" as Venue["type"],
    vibe: "",
    longDescription: "",
    neighbourhood: "Soho",
    address: "",
    lat: null,
    lng: null,
    price: "££" as Venue["price"],
    timeOfDay: "Evening" as Venue["timeOfDay"],
    rating: 4.5,
    reviewCount: 0,
    walkingMins: 0,
    tablesFree: 0,
    nextSlotLabel: "",
    imgUrl: "",
    moodTags: [],
    vibeTags: [],
    googlePlaceId: "place_x",
    bookingLinks: null,
    websiteUrl: null,
    phone: null,
    instagramHandle: null,
    editorialSources: null,
    creatorCoverage: null,
    criticalFlags: null,
    openingHours: null,
    createdAt: "",
    ...partial,
  } as Venue;
}
