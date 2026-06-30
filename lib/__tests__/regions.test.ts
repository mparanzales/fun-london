import { describe, it, expect } from "vitest";
import {
  REGIONS,
  REGION_OF,
  regionOf,
  neighbourhoodsInRegion,
} from "@/lib/regions";

describe("regions — REGION_OF integrity", () => {
  it("every mapped neighbourhood points at a valid region", () => {
    for (const [hood, region] of Object.entries(REGION_OF)) {
      expect(REGIONS, `${hood} → ${region}`).toContain(region);
    }
  });

  it("regionOf returns null for an unmapped neighbourhood", () => {
    expect(regionOf("Atlantis")).toBeNull();
  });

  it("neighbourhoodsInRegion round-trips through regionOf", () => {
    for (const r of REGIONS) {
      for (const hood of neighbourhoodsInRegion(r)) {
        expect(regionOf(hood)).toBe(r);
      }
    }
  });
});

// Coverage lock: every neighbourhood currently in the live catalogue MUST map to
// a region, or it silently vanishes from the region chips + drill-down. This is
// the catalogue as of the region-led Area work (verified via SQL against prod).
// If you add venues in a NEW neighbourhood, add it to REGION_OF and to this list.
describe("regions — live catalogue coverage", () => {
  const LIVE_NEIGHBOURHOODS = [
    "Soho", "Mayfair", "Spitalfields", "Borough", "Islington", "Covent Garden",
    "London Fields", "Chelsea", "Notting Hill", "Marylebone", "Fitzrovia",
    "Bethnal Green", "Battersea", "Clerkenwell", "Camden", "City", "Knightsbridge",
    "Stoke Newington", "Brixton", "Shoreditch", "Belgravia", "Peckham",
    "Victoria Park", "Clapham", "Westminster", "Bayswater", "Camberwell",
    "Kensington", "Hammersmith", "Hackney", "Fulham", "Bloomsbury", "Canary Wharf",
    "Hampstead", "King's Cross", "Kentish Town", "Queen's Park", "Finsbury Park",
    "Ladbroke Grove", "Shepherd's Bush", "Highbury", "Vauxhall", "South Kensington",
    "Chiswick", "Balham", "Tooting", "Bow", "Farringdon", "Holborn", "Earl's Court",
    "Richmond", "Crouch End", "Herne Hill", "Pimlico", "Kensal Green",
    "St John's Wood", "Putney", "Highgate", "Archway", "Maida Vale", "Wandsworth",
    "Smithfield", "Old Street", "Wapping", "East Dulwich", "Barbican", "Tottenham",
  ];

  it("maps every live catalogue neighbourhood to a region", () => {
    const unmapped = LIVE_NEIGHBOURHOODS.filter((n) => regionOf(n) === null);
    expect(unmapped, `unmapped neighbourhoods: ${unmapped.join(", ")}`).toEqual(
      [],
    );
  });
});
