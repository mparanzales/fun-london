// Guards the price-tier fix AT THE MAPPER BOUNDARY.
//
// The bug (measured on prod 2026-08-12): `venues.price` read "££" on 1,829 of
// 2,178 live rows (84%), because scripts/ingest-from-pending.ts mapPriceLevel()
// returned "££" in its `default:` branch whenever Google supplied no
// priceLevel — the normal case for museums, parks and churches. withinBudget()
// ranks "££" as 2, so a "£" night excluded the Natural History Museum, Novelty
// Automation, St Bride's and the London Mithraeum, all of which are FREE.
//
// 🧨 WHY THIS FILE EXISTS SEPARATELY FROM THE plan-engine TESTS. Unit-testing
// withinBudget() and computePlan() with null-priced fixtures cannot see the
// default being re-applied UPSTREAM. If a future `?? "££"` lands in one of the
// row mappers below, production breaks again with every other test green —
// the failure class already banked twice in this repo as "a mutation test that
// models the wrong consumer". These assertions sit on the mapper itself, which
// is the boundary where a DB null becomes an app value.

import { describe, it, expect } from "vitest";
import { mapVenuePlan, mapVenuePreview } from "@/lib/queries";

const planRow = {
  id: "v1",
  slug: "v1",
  name: "Free Museum",
  type: "Culture",
  vibe: "",
  neighbourhood: "Soho",
  price: null,
  time_of_day: "Day",
  rating: 4.5,
  review_count: 10,
  img_url: "",
  lat: null,
  lng: null,
  opening_hours: null,
  vibe_tags: [],
  mood_tags: [],
  google_place_id: "place_x",
  curation_tier: "discovered",
  created_at: "2026-01-01T00:00:00Z",
  hidden_at: null,
};

describe("price tier: a DB null must reach the app as null", () => {
  it("mapVenuePlan does not substitute a tier for an unknown price", () => {
    const v = mapVenuePlan(planRow as never);
    expect(v.price).toBeNull();
    // the specific regression: never silently re-defaulted to the mid tier
    expect(v.price).not.toBe("££");
  });

  it("mapVenuePreview does not substitute a tier for an unknown price", () => {
    const v = mapVenuePreview(planRow as never);
    expect(v.price).toBeNull();
    expect(v.price).not.toBe("££");
  });

  it("a real price still passes through both mappers unchanged", () => {
    // Stops the guards above from being satisfied by "always null".
    for (const tier of ["Free", "£", "££", "£££"] as const) {
      expect(mapVenuePlan({ ...planRow, price: tier } as never).price).toBe(
        tier,
      );
      expect(mapVenuePreview({ ...planRow, price: tier } as never).price).toBe(
        tier,
      );
    }
  });
});
