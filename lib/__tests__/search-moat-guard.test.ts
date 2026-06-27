import { describe, it, expect } from "vitest";
import { mapVenuePreview } from "@/lib/queries";

// Leak-guard for the signed-out feed + the service-role-backed search index.
// Because rich search reads protected columns via the service-role client (which
// bypasses the DB column-grant moat), `mapVenuePreview` is the SOLE thing that
// keeps detail/moat fields off the anon-facing card. If a future edit lets any
// of these through, anon search/feed would leak the catalogue — fail loudly.
describe("mapVenuePreview is the moat enforcement point", () => {
  // A row carrying every detail/moat field populated, as the service-role read
  // would return. mapVenuePreview must blank all of them on the way out.
  const richRow = {
    id: "v1",
    slug: "test-venue",
    name: "Test Venue",
    type: "restaurant",
    vibe: "cosy",
    neighbourhood: "Soho",
    price: "££",
    time_of_day: "evening",
    rating: 4.5,
    review_count: 100,
    img_url: "https://example.com/photo.jpg",
    lat: 51.5,
    lng: -0.1,
    curation_tier: "curated",
    created_at: "2026-01-01T00:00:00Z",
    // Protected / detail fields — must NOT survive the mapping:
    long_description: "SECRET editorial blurb the moat protects",
    address: "1 Secret Street, EC1",
    phone: "+44 20 0000 0000",
    website_url: "https://secret.example.com",
    instagram_handle: "@secret",
    vibe_tags: ["cosy", "romantic"],
    mood_tags: ["dinner"],
    reviews: [{ author: "A", rating: 5, text: "amazing", relativeTime: "1d" }],
    booking_links: [{ label: "Book", url: "https://book" }],
    editorial_sources: [{ name: "Mag", url: "https://mag" }],
    creator_coverage: [{ handle: "@c", url: "https://c" }],
    critical_flags: ["x"],
    opening_hours: { periods: [] },
    map_url: "https://maps.example.com",
    menu_url: "https://menu.example.com",
    google_place_id: "place_123",
    photo_urls: ["https://example.com/gallery1.jpg"],
  } as unknown as Parameters<typeof mapVenuePreview>[0];

  const v = mapVenuePreview(richRow);

  it("blanks every detail/moat field", () => {
    expect(v.longDescription).toBe("");
    expect(v.address).toBe("");
    expect(v.phone).toBeNull();
    expect(v.websiteUrl).toBeNull();
    expect(v.instagramHandle).toBeNull();
    expect(v.vibeTags).toEqual([]);
    expect(v.moodTags).toEqual([]);
    expect(v.reviews).toBeNull();
    expect(v.bookingLinks).toBeNull();
    expect(v.editorialSources).toBeNull();
    expect(v.creatorCoverage).toBeNull();
    expect(v.criticalFlags).toBeNull();
    expect(v.openingHours).toBeNull();
    expect(v.mapUrl).toBeNull();
    expect(v.menuUrl).toBeNull();
    expect(v.googlePlaceId).toBeNull();
    expect(v.photoUrls).toEqual([]);
  });

  it("keeps the safe card fields", () => {
    expect(v.slug).toBe("test-venue");
    expect(v.name).toBe("Test Venue");
    expect(v.neighbourhood).toBe("Soho");
    expect(v.rating).toBe(4.5);
    expect(v.curationTier).toBe("curated");
  });

  it("never serialises a protected value anywhere in the card", () => {
    // Belt-and-braces: no secret string leaks via any field/shape change.
    const blob = JSON.stringify(v);
    for (const secret of [
      "SECRET editorial",
      "Secret Street",
      "+44 20 0000 0000",
      "secret.example.com",
      "amazing",
      "place_123",
      "gallery1",
    ]) {
      expect(blob).not.toContain(secret);
    }
  });
});
