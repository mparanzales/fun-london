import { describe, it, expect } from "vitest";
import {
  FALLBACK_IMG_URL,
  isKeyedPhotoUrl,
  resolveVenuePhoto,
  photoStorageEnabled,
} from "../photo-storage";
import type { SupabaseClient } from "@supabase/supabase-js";

// The core invariant of the photo pipeline: a keyed `places.googleapis.com`
// URL (which embeds the Places API key) must NEVER reach venues.img_url. These
// tests lock that down so the regression that kept re-keying the catalogue
// can't silently come back.

const KEYED =
  "https://places.googleapis.com/v1/places/ABC/photos/XYZ/media?key=AIzaSECRET&maxWidthPx=1600";

describe("isKeyedPhotoUrl", () => {
  it("flags Google Places media URLs", () => {
    expect(isKeyedPhotoUrl(KEYED)).toBe(true);
  });

  it("treats keyless URLs as safe", () => {
    expect(isKeyedPhotoUrl(FALLBACK_IMG_URL)).toBe(false);
    expect(
      isKeyedPhotoUrl("https://fxfuzabrivuianfwdopc.supabase.co/x/padella.jpg"),
    ).toBe(false);
  });

  it("handles null/undefined/empty", () => {
    expect(isKeyedPhotoUrl(null)).toBe(false);
    expect(isKeyedPhotoUrl(undefined)).toBe(false);
    expect(isKeyedPhotoUrl("")).toBe(false);
  });
});

describe("FALLBACK_IMG_URL", () => {
  it("is itself keyless", () => {
    expect(isKeyedPhotoUrl(FALLBACK_IMG_URL)).toBe(false);
  });
});

describe("resolveVenuePhoto", () => {
  // A supabase double that throws if touched — these cases must resolve
  // without any Storage I/O.
  const noopSupabase = {} as unknown as SupabaseClient;

  it("returns the keyless fallback when there is no photo", async () => {
    const url = await resolveVenuePhoto(null, "some-venue", noopSupabase);
    expect(url).toBe(FALLBACK_IMG_URL);
    expect(isKeyedPhotoUrl(url)).toBe(false);
  });

  it("never returns a keyed URL when mirroring is disabled", async () => {
    // No FL_PHOTO_BUCKET in the test env, so mirroring is off and the keyed
    // media URL is never persisted — the fallback is returned instead.
    expect(photoStorageEnabled()).toBe(false);
    const url = await resolveVenuePhoto(
      "places/ABC/photos/XYZ",
      "some-venue",
      noopSupabase,
    );
    expect(url).toBe(FALLBACK_IMG_URL);
    expect(isKeyedPhotoUrl(url)).toBe(false);
  });
});
