import { describe, it, expect } from "vitest";
import { sizedImageUrl } from "@/lib/img";

describe("sizedImageUrl", () => {
  describe("Google user content (=w suffix)", () => {
    it("appends =w{width} to an lh3.googleusercontent.com URL", () => {
      const url = "https://lh3.googleusercontent.com/places/AbCdEf";
      expect(sizedImageUrl(url, 384)).toBe(
        "https://lh3.googleusercontent.com/places/AbCdEf=w384",
      );
    });

    it("matches any *.googleusercontent.com host", () => {
      const url = "https://something.googleusercontent.com/img/XYZ";
      expect(sizedImageUrl(url, 320)).toBe(
        "https://something.googleusercontent.com/img/XYZ=w320",
      );
    });

    it("strips an existing =w suffix before appending (no double size)", () => {
      const url = "https://lh3.googleusercontent.com/places/AbCdEf=w1600";
      expect(sizedImageUrl(url, 384)).toBe(
        "https://lh3.googleusercontent.com/places/AbCdEf=w384",
      );
    });

    it("strips an existing =s suffix", () => {
      const url = "https://lh3.googleusercontent.com/places/AbCdEf=s2000";
      expect(sizedImageUrl(url, 384)).toBe(
        "https://lh3.googleusercontent.com/places/AbCdEf=w384",
      );
    });

    it("strips a compound size directive (=w400-h300-no)", () => {
      const url =
        "https://lh3.googleusercontent.com/places/AbCdEf=w400-h300-no";
      expect(sizedImageUrl(url, 512)).toBe(
        "https://lh3.googleusercontent.com/places/AbCdEf=w512",
      );
    });

    it("is idempotent: applying twice yields the same URL", () => {
      const url = "https://lh3.googleusercontent.com/places/AbCdEf";
      const once = sizedImageUrl(url, 384);
      const twice = sizedImageUrl(once, 384);
      expect(twice).toBe(once);
    });
  });

  describe("Supabase Storage (render/image rewrite)", () => {
    const publicUrl =
      "https://abc.supabase.co/storage/v1/object/public/venue-photos/a/b.jpg";

    it("rewrites the object endpoint to the render/image endpoint with params", () => {
      expect(sizedImageUrl(publicUrl, 384)).toBe(
        "https://abc.supabase.co/storage/v1/render/image/public/venue-photos/a/b.jpg?width=384&quality=70&resize=cover",
      );
    });

    it("uses & when the URL already has a query string", () => {
      const withQuery = `${publicUrl}?token=xyz`;
      expect(sizedImageUrl(withQuery, 256)).toBe(
        "https://abc.supabase.co/storage/v1/render/image/public/venue-photos/a/b.jpg?token=xyz&width=256&quality=70&resize=cover",
      );
    });
  });

  describe("passthrough (unknown / non-resizable hosts)", () => {
    it("returns Ticketmaster URLs unchanged", () => {
      const url = "https://s1.ticketm.net/dam/a/abc/poster.jpg";
      expect(sizedImageUrl(url, 768)).toBe(url);
    });

    it("returns Universe URLs unchanged", () => {
      const url = "https://images.universe.com/abc/poster.png";
      expect(sizedImageUrl(url, 768)).toBe(url);
    });

    it("returns a non-absolute / empty value unchanged", () => {
      expect(sizedImageUrl("", 384)).toBe("");
      expect(sizedImageUrl("/local/relative.jpg", 384)).toBe(
        "/local/relative.jpg",
      );
    });

    it("returns the URL unchanged for a non-positive width", () => {
      const url = "https://lh3.googleusercontent.com/places/AbCdEf";
      expect(sizedImageUrl(url, 0)).toBe(url);
      expect(sizedImageUrl(url, -10)).toBe(url);
    });

    it("does not match a googleusercontent.com substring smuggled in a path/query", () => {
      const url = "https://s1.ticketm.net/x?ref=googleusercontent.com";
      expect(sizedImageUrl(url, 320)).toBe(url);
    });
  });
});
