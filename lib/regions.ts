// London region grouping for Plan Together's "Where" setting.
//
// Neighbourhoods are flat strings in the catalog; this groups them into a
// handful of regions so the host can say "anywhere", a region, or a single
// neighbourhood. Keep REGION_OF updated as the catalog grows — an unmapped
// neighbourhood falls through `regionOf` as null (only matches "anywhere").

import type { Venue } from "@/lib/types";

export type Region = "Central" | "North" | "East" | "South" | "West";

export const REGIONS: Region[] = ["Central", "North", "East", "South", "West"];

export type PlanArea =
  | { kind: "anywhere" }
  | { kind: "region"; region: Region }
  | { kind: "neighbourhood"; name: string };

// Catalog neighbourhoods → region. Mirrors the venues currently ingested.
export const REGION_OF: Record<string, Region> = {
  // Central
  Soho: "Central",
  Mayfair: "Central",
  Clerkenwell: "Central",
  Farringdon: "Central",
  Smithfield: "Central",
  "Old Street": "Central",
  Fitzrovia: "Central",
  // West
  Marylebone: "West",
  Chelsea: "West",
  "Notting Hill": "West",
  // East
  Shoreditch: "East",
  Hackney: "East",
  Dalston: "East",
  "Columbia Road": "East",
  "London Fields": "East",
  Spitalfields: "East",
  // South
  Bermondsey: "South",
  Borough: "South",
  "Borough Market": "South",
  Peckham: "South",
  Brixton: "South",
  Camberwell: "South",
  // North
  Islington: "North",
  "Stoke Newington": "North",
};

export function regionOf(neighbourhood: string): Region | null {
  return REGION_OF[neighbourhood] ?? null;
}

export function neighbourhoodsInRegion(region: Region): string[] {
  return Object.keys(REGION_OF)
    .filter((n) => REGION_OF[n] === region)
    .sort();
}

// Which regions actually have venues in this catalog (for the host's chips).
export function regionsWithVenues(venues: Venue[]): Region[] {
  const present = new Set<Region>();
  for (const v of venues) {
    const r = regionOf(v.neighbourhood);
    if (r) present.add(r);
  }
  return REGIONS.filter((r) => present.has(r));
}

export function venueInArea(v: Venue, area: PlanArea): boolean {
  switch (area.kind) {
    case "anywhere":
      return true;
    case "region":
      return regionOf(v.neighbourhood) === area.region;
    case "neighbourhood":
      return v.neighbourhood === area.name;
  }
}
