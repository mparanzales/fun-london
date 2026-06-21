// London postcode (outward code) → neighbourhood.
//
// The authoritative signal for a venue's area is its Google address, which
// always carries a postcode. This maps the outward code (e.g. "NW5", "W1J") to
// the catalogue's neighbourhood name. Used by scripts/revalidate-venues.ts to
// correct areas from the source of truth, and reusable by ingest + search.
//
// Granularity: outward-code level. A few large codes span several areas
// (SE1 = Borough/Bermondsey/Waterloo; E1 = Spitalfields/Whitechapel) and are
// mapped to the most representative one — always the correct REGION, usually
// the correct neighbourhood. Every value here is also a key in REGION_OF
// (lib/regions.ts), so region filtering keeps working.

export const POSTCODE_AREA: Record<string, string> = {
  // ── Central ──
  W1F: "Soho",
  W1D: "Soho",
  W1B: "Soho",
  W1K: "Mayfair",
  W1J: "Mayfair",
  W1S: "Mayfair",
  SW1Y: "Mayfair",
  W1U: "Marylebone",
  W1H: "Marylebone",
  W1G: "Marylebone",
  W1C: "Marylebone",
  W1T: "Fitzrovia",
  W1W: "Fitzrovia",
  WC1E: "Fitzrovia",
  W1A: "Fitzrovia",
  WC1N: "Bloomsbury",
  WC1B: "Bloomsbury",
  WC1H: "Bloomsbury",
  WC1A: "Bloomsbury",
  WC2H: "Covent Garden",
  WC2E: "Covent Garden",
  WC2N: "Covent Garden",
  WC2B: "Covent Garden",
  WC2R: "Covent Garden",
  WC1V: "Holborn",
  WC2A: "Holborn",
  EC4A: "Holborn",
  EC1R: "Clerkenwell",
  EC1V: "Clerkenwell",
  WC1X: "Clerkenwell",
  EC1N: "Clerkenwell",
  EC1M: "Farringdon",
  EC1A: "Smithfield",
  EC1Y: "Old Street",
  SW1A: "Westminster",
  SW1E: "Westminster",
  SW1H: "Westminster",
  SW1P: "Westminster",
  N1C: "King's Cross",
  // City of London (office-land; few going-out venues)
  EC2N: "City",
  EC2R: "City",
  EC2V: "City",
  EC2Y: "City",
  EC3M: "City",
  EC3N: "City",
  EC3V: "City",
  EC4M: "City",
  EC4N: "City",
  EC4R: "City",
  EC4V: "City",
  EC4Y: "City",

  // ── West ──
  W11: "Notting Hill",
  W10: "Ladbroke Grove",
  SW3: "Chelsea",
  SW10: "Chelsea",
  W2: "Bayswater",
  W8: "Kensington",
  SW7: "South Kensington",
  SW5: "Earl's Court",
  SW6: "Fulham",
  W6: "Hammersmith",
  W14: "Hammersmith",
  W12: "Shepherd's Bush",
  W4: "Chiswick",
  SW1X: "Knightsbridge",
  SW1W: "Belgravia",
  SW1V: "Pimlico",
  W9: "Maida Vale",
  NW8: "St John's Wood",
  NW6: "Queen's Park",
  NW10: "Kensal Green",
  TW10: "Richmond",
  TW9: "Richmond",
  SW14: "Richmond",
  SW15: "Putney",

  // ── East ──
  E1: "Spitalfields",
  EC2M: "Spitalfields",
  E8: "London Fields",
  E5: "Hackney",
  E9: "Victoria Park",
  E2: "Bethnal Green",
  EC2A: "Shoreditch",
  E14: "Canary Wharf",
  E3: "Bow",
  E1W: "Wapping",

  // ── South ──
  SE1: "Borough",
  SE15: "Peckham",
  SE5: "Camberwell",
  SE17: "Camberwell",
  SE24: "Herne Hill",
  SE22: "East Dulwich",
  SE11: "Vauxhall",
  SW8: "Vauxhall",
  SW9: "Brixton",
  SW2: "Brixton",
  SW4: "Clapham",
  SW11: "Battersea",
  SW12: "Balham",
  SW17: "Tooting",
  SW18: "Wandsworth",

  // ── North ──
  N1: "Islington",
  N7: "Islington",
  N5: "Highbury",
  N4: "Finsbury Park",
  N8: "Crouch End",
  N6: "Highgate",
  N19: "Archway",
  N16: "Stoke Newington",
  N17: "Tottenham",
  NW1: "Camden",
  NW5: "Kentish Town",
  NW3: "Hampstead",
};

// Extract the outward postcode from a formatted address and look up its area.
// Returns null when there's no UK postcode (e.g. a junk "London, UK" address)
// or the code isn't mapped.
export function areaFromPostcode(
  address: string | null | undefined,
): string | null {
  if (!address) return null;
  const a = address.toUpperCase();
  // Full postcode (outward [+ optional space] + inward), e.g. "W1K 5AB", "SW1X9SG".
  let m = a.match(/\b([A-Z]{1,2}\d[A-Z\d]?)\s*\d[A-Z]{2}\b/);
  // Bare outward code with no inward, e.g. "…, London W1K, UK" / "…, London EC1R".
  if (!m) m = a.match(/\bLONDON[ ,]+([A-Z]{1,2}\d[A-Z\d]?)\b/);
  if (!m) return null;
  return POSTCODE_AREA[m[1]] ?? null;
}
