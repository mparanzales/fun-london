import { describe, it, expect } from "vitest";
import { sizedImageUrl, isGooglePlacesUrl } from "@/lib/img";

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

  describe("Cloudflare R2 (img.funldn.com, pre-sized WebP variants)", () => {
    const detail = "https://img.funldn.com/padella.webp";

    it("swaps to the -sm card variant for card-width slots (<=512)", () => {
      expect(sizedImageUrl(detail, 384)).toBe(
        "https://img.funldn.com/padella-sm.webp",
      );
      expect(sizedImageUrl(detail, 512)).toBe(
        "https://img.funldn.com/padella-sm.webp",
      );
    });

    it("keeps the detail variant for larger slots (>512)", () => {
      expect(sizedImageUrl(detail, 1080)).toBe(detail);
    });

    it("handles the -N gallery suffix", () => {
      expect(sizedImageUrl("https://img.funldn.com/padella-1.webp", 384)).toBe(
        "https://img.funldn.com/padella-1-sm.webp",
      );
    });

    it("never swaps a single-variant map URL (would 404; maps have no -sm)", () => {
      const map = "https://img.funldn.com/padella-map.webp";
      expect(sizedImageUrl(map, 384)).toBe(map);
      expect(sizedImageUrl(map, 1080)).toBe(map);
    });

    it("never double-suffixes an already-small URL", () => {
      const small = "https://img.funldn.com/padella-sm.webp";
      expect(sizedImageUrl(small, 384)).toBe(small);
      // and applying to a detail url twice is stable
      const once = sizedImageUrl(detail, 384);
      expect(sizedImageUrl(once, 384)).toBe(once);
    });

    it("does not match an img.funldn.com substring smuggled in a path/query", () => {
      const url = "https://s1.ticketm.net/x?ref=img.funldn.com/a.webp";
      expect(sizedImageUrl(url, 320)).toBe(url);
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

describe("isGooglePlacesUrl", () => {
  it("matches a real Places media URL", () => {
    expect(
      isGooglePlacesUrl(
        "https://places.googleapis.com/v1/places/ABC/photos/XYZ/media?key=AIza",
      ),
    ).toBe(true);
  });

  it("rejects decoys that a substring check would accept", () => {
    expect(
      isGooglePlacesUrl("https://places.googleapis.com.evil.example/x"),
    ).toBe(false);
    expect(
      isGooglePlacesUrl("https://evil.example/places.googleapis.com/x"),
    ).toBe(false);
    expect(
      isGooglePlacesUrl("https://evil.example/?u=places.googleapis.com"),
    ).toBe(false);
  });

  it("rejects other hosts and non-URLs", () => {
    expect(isGooglePlacesUrl("https://img.funldn.com/a.webp")).toBe(false);
    expect(isGooglePlacesUrl("https://lh3.googleusercontent.com/x")).toBe(
      false,
    );
    expect(isGooglePlacesUrl("not a url")).toBe(false);
    expect(isGooglePlacesUrl(null)).toBe(false);
    expect(isGooglePlacesUrl(undefined)).toBe(false);
  });
});
