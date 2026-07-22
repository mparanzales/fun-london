import { describe, it, expect } from "vitest";
import {
  detectBookingPlatform,
  detectBookingLinks,
  hasMajorBookingPlatform,
  hostnameOf,
} from "../booking-platform";

// These lock down the difference between "the URL contains the string
// opentable.com" and "the URL is on opentable.com". The old substring
// patterns could not tell them apart, so a lookalike domain was attributed
// to a real booking partner.

describe("hostnameOf", () => {
  it("extracts and normalises the host", () => {
    expect(hostnameOf("https://www.OpenTable.com/r/foo")).toBe("opentable.com");
    expect(hostnameOf("https://resy.com/cities/ldn?x=1")).toBe("resy.com");
  });

  it("accepts a scheme-less host", () => {
    expect(hostnameOf("opentable.co.uk/r/foo")).toBe("opentable.co.uk");
  });

  it("returns null for junk", () => {
    expect(hostnameOf("")).toBeNull();
    expect(hostnameOf("   ")).toBeNull();
    expect(hostnameOf(null)).toBeNull();
    expect(hostnameOf(undefined)).toBeNull();
  });
});

describe("detectBookingPlatform matches real platform URLs", () => {
  it.each([
    ["https://www.opentable.com/r/the-place-london", "opentable"],
    ["https://opentable.co.uk/r/the-place", "opentable"],
    ["https://resy.com/cities/ldn/the-place", "resy"],
    ["https://www.sevenrooms.com/reservations/theplace", "sevenrooms"],
    ["https://www.thefork.co.uk/restaurant/the-place", "thefork"],
    ["https://quandoo.co.uk/place/the-place", "quandoo"],
    ["https://tablein.com/book/the-place", "tablein"],
    // subdomains are legitimate booking hosts
    ["https://booking.sevenrooms.com/reservations/x", "sevenrooms"],
  ])("%s -> %s", (url, expected) => {
    expect(detectBookingPlatform(url)).toBe(expected);
  });
});

describe("detectBookingPlatform rejects lookalikes", () => {
  // Every one of these matched the OLD substring patterns.
  it.each([
    "https://notopentable.com/r/foo",
    "https://opentable.com.phishing.example/r/foo",
    "https://myrestaurant.com/?ref=opentable.com",
    "https://myrestaurant.com/opentable.com/menu",
    "https://fake-resy.com/book",
    "https://resy.com.evil.io/book",
  ])("%s is not a booking platform", (url) => {
    expect(detectBookingPlatform(url)).toBeNull();
  });

  it("does not match a venue's own site", () => {
    expect(detectBookingPlatform("https://padella.co")).toBeNull();
  });
});

describe("detectBookingLinks", () => {
  it("returns the platform at priority 1", () => {
    expect(detectBookingLinks("https://www.opentable.com/r/x")).toEqual([
      { platform: "opentable", url: "https://www.opentable.com/r/x", priority: 1 },
    ]);
  });

  it("falls back to the venue's own site at priority 99", () => {
    expect(detectBookingLinks("https://padella.co")).toEqual([
      { platform: "website", url: "https://padella.co", priority: 99 },
    ]);
  });

  it("a lookalike falls back to website, not the platform", () => {
    const links = detectBookingLinks("https://notopentable.com");
    expect(links[0].platform).toBe("website");
    expect(hasMajorBookingPlatform(links)).toBe(false);
  });

  it("returns nothing without a URL", () => {
    expect(detectBookingLinks(undefined)).toEqual([]);
    expect(detectBookingLinks(null)).toEqual([]);
    expect(detectBookingLinks("")).toEqual([]);
  });
});

describe("hasMajorBookingPlatform", () => {
  it("is true for a real platform and false for a plain website", () => {
    expect(hasMajorBookingPlatform(detectBookingLinks("https://resy.com/x"))).toBe(true);
    expect(hasMajorBookingPlatform(detectBookingLinks("https://padella.co"))).toBe(false);
  });
});
