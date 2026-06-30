import { describe, it, expect } from "vitest";
import { googleMapsWalkingUrl } from "@/lib/plan-maps";

describe("googleMapsWalkingUrl", () => {
  it("returns null when no stop has coordinates", () => {
    expect(
      googleMapsWalkingUrl([{ lat: null, lng: null, name: "Nowhere" }]),
    ).toBeNull();
    expect(googleMapsWalkingUrl([])).toBeNull();
  });

  it("routes a single stop as a destination (no origin/waypoints)", () => {
    const url = googleMapsWalkingUrl([{ lat: 51.51, lng: -0.13 }]);
    expect(url).toBe(
      "https://www.google.com/maps/dir/?api=1&travelmode=walking&destination=51.51,-0.13",
    );
  });

  it("routes two stops as origin → destination (no waypoints)", () => {
    const url = googleMapsWalkingUrl([
      { lat: 51.51, lng: -0.13 },
      { lat: 51.52, lng: -0.14 },
    ]);
    expect(url).toContain("origin=51.51,-0.13");
    expect(url).toContain("destination=51.52,-0.14");
    expect(url).not.toContain("waypoints");
    expect(url).toContain("travelmode=walking");
  });

  it("routes three stops with the middle one as an ordered waypoint", () => {
    const url = googleMapsWalkingUrl([
      { lat: 51.51, lng: -0.13, name: "Start" },
      { lat: 51.515, lng: -0.135, name: "Then" },
      { lat: 51.52, lng: -0.14, name: "Finish" },
    ]);
    expect(url).toContain("origin=51.51,-0.13");
    expect(url).toContain("destination=51.52,-0.14");
    expect(url).toContain("waypoints=51.515,-0.135");
  });

  it("skips coordinate-less stops but keeps the route order", () => {
    const url = googleMapsWalkingUrl([
      { lat: 51.51, lng: -0.13 },
      { lat: null, lng: null }, // dropped
      { lat: 51.52, lng: -0.14 },
    ]);
    expect(url).toContain("origin=51.51,-0.13");
    expect(url).toContain("destination=51.52,-0.14");
    expect(url).not.toContain("waypoints");
  });
});
