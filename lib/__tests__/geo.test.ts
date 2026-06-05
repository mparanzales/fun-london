import { describe, it, expect } from "vitest";
import { haversineKm, distanceLabel } from "../geo";

describe("haversineKm", () => {
  it("is ~0 for the same point", () => {
    const p = { lat: 51.5074, lng: -0.1278 };
    expect(haversineKm(p, p)).toBeCloseTo(0, 5);
  });

  it("matches a known London distance (Soho to Shoreditch ~3km)", () => {
    const soho = { lat: 51.5137, lng: -0.1337 };
    const shoreditch = { lat: 51.5265, lng: -0.0786 };
    const km = haversineKm(soho, shoreditch);
    expect(km).toBeGreaterThan(3);
    expect(km).toBeLessThan(5);
  });

  it("is symmetric", () => {
    const a = { lat: 51.5, lng: -0.1 };
    const b = { lat: 51.52, lng: -0.08 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 9);
  });
});

describe("distanceLabel", () => {
  it("shows walk minutes when walkable", () => {
    expect(distanceLabel(0.4)).toBe("~5 min walk"); // 400m / 80 = 5
    expect(distanceLabel(0.08)).toBe("~1 min walk");
  });

  it("falls back to km when not walkable", () => {
    expect(distanceLabel(5)).toBe("5.0 km away");
  });
});
