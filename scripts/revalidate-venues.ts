// Fun London — re-validate venue LOCATION against Google (source of truth).
//
// The catalogue accumulated bad location data from several sources (AI
// discovery hallucinations, the OneZone import, wrong Google matches): venues
// in the wrong city (Chelsea Market = NYC), wrong neighbourhoods (Regent's Park
// labelled "Spitalfields"), and junk matches ("London, UK" with no real
// address). Neighbourhood was copied from the import and never checked against
// the venue's real Google record.
//
// This re-fetches each venue's authoritative Google record by place_id and:
//   • fixes coordinates, address, and neighbourhood from Google,
//   • flags WRONG_CITY (coords outside London), BAD_MATCH (name mismatch),
//     CLOSED (businessStatus), and JUNK (no real address) for review,
//   • never deletes — flagged venues are reported, not removed.
//
// Cheap by default: only re-fetches the geo-SUSPECT venues (coords out of
// bounds, junk address, or far from their neighbourhood's centroid). Pass --all
// to re-validate every venue (the full ~$35 / likely-free Google run).
//
//   pnpm tsx scripts/revalidate-venues.ts            # dry-run, suspects only
//   pnpm tsx scripts/revalidate-venues.ts --all      # dry-run, every venue
//   pnpm tsx scripts/revalidate-venues.ts --apply     # write fixes (suspects)
//   pnpm tsx scripts/revalidate-venues.ts --all --apply
//
// Required env (.env.local): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// GOOGLE_PLACES_API_KEY.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { areaFromPostcode } from "@/lib/postcode-areas";

const APPLY = process.argv.includes("--apply");
const ALL = process.argv.includes("--all");

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!GOOGLE_PLACES_API_KEY) {
  console.error("Missing GOOGLE_PLACES_API_KEY in .env.local");
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing Supabase env in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Greater London bounding box (generous).
const LON = { latMin: 51.25, latMax: 51.72, lngMin: -0.55, lngMax: 0.34 };
const inLondon = (lat: number, lng: number) =>
  lat >= LON.latMin && lat <= LON.latMax && lng >= LON.lngMin && lng <= LON.lngMax;

type AddressComponent = {
  longText?: string;
  shortText?: string;
  types?: string[];
};
type PlaceDetails = {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  businessStatus?: string;
  addressComponents?: AddressComponent[];
};

const PLACES_BASE = "https://places.googleapis.com/v1/places";

async function placeDetails(placeId: string): Promise<PlaceDetails | null> {
  const fieldMask = [
    "id",
    "displayName",
    "formattedAddress",
    "location",
    "businessStatus",
    "addressComponents",
  ].join(",");
  const res = await fetch(`${PLACES_BASE}/${placeId}`, {
    headers: {
      "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY!,
      "X-Goog-FieldMask": fieldMask,
    },
  });
  if (res.status === 404) return null; // place no longer exists
  if (!res.ok) {
    throw new Error(`Place details ${placeId}: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as PlaceDetails;
}

// Pull the most specific area name Google knows for this place.
function neighbourhoodFrom(d: PlaceDetails): string | null {
  const comps = d.addressComponents ?? [];
  const byType = (t: string) =>
    comps.find((c) => (c.types ?? []).includes(t))?.longText ?? null;
  return (
    byType("neighborhood") ??
    byType("sublocality_level_1") ??
    byType("sublocality") ??
    null // postal_town is just "London" — not useful as a neighbourhood
  );
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Loose name match: share a meaningful token, or one contains the other.
function namesMatch(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na.includes(nb) || nb.includes(na)) return true;
  const stop = new Set(["the", "and", "cafe", "bar", "london", "restaurant", "co"]);
  const ta = new Set(na.split(" ").filter((w) => w.length > 2 && !stop.has(w)));
  const tb = nb.split(" ").filter((w) => w.length > 2 && !stop.has(w));
  return tb.some((w) => ta.has(w));
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
function km(aLat: number, aLng: number, bLat: number, bLng: number): number {
  return (
    111 *
    Math.sqrt(
      (aLat - bLat) ** 2 + ((aLng - bLng) * Math.cos((aLat * Math.PI) / 180)) ** 2,
    )
  );
}

type Row = {
  id: string;
  slug: string;
  name: string;
  neighbourhood: string;
  address: string;
  lat: number | null;
  lng: number | null;
  google_place_id: string | null;
  closed_at: string | null;
};

async function main() {
  console.log(
    `Re-validate venue location · ${APPLY ? "APPLY (writing)" : "DRY RUN"} · ${ALL ? "ALL venues" : "suspects only"}\n`,
  );

  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("venues")
      .select(
        "id, slug, name, neighbourhood, address, lat, lng, google_place_id, closed_at",
      )
      .order("created_at", { ascending: true })
      .range(from, from + 999);
    if (error) {
      console.error("Fetch failed:", error.message);
      process.exit(1);
    }
    const page = (data ?? []) as Row[];
    rows.push(...page);
    if (page.length < 1000) break;
  }

  // Per-neighbourhood centroid (median) for the outlier check.
  const byArea = new Map<string, { lat: number[]; lng: number[] }>();
  for (const r of rows) {
    if (r.lat == null || r.lng == null) continue;
    const a = byArea.get(r.neighbourhood) ?? { lat: [], lng: [] };
    a.lat.push(r.lat);
    a.lng.push(r.lng);
    byArea.set(r.neighbourhood, a);
  }
  const centroid = new Map<string, { lat: number; lng: number; n: number }>();
  for (const [area, a] of byArea)
    centroid.set(area, { lat: median(a.lat), lng: median(a.lng), n: a.lat.length });

  function isSuspect(r: Row): boolean {
    if (!r.google_place_id) return false; // can't re-fetch without an id
    const addr = (r.address ?? "").trim().toLowerCase();
    if (["london, uk", "london", "uk", ""].includes(addr)) return true;
    if (r.lat == null || r.lng == null) return true;
    if (!inLondon(r.lat, r.lng)) return true;
    const c = centroid.get(r.neighbourhood);
    if (c && c.n >= 8 && km(r.lat, r.lng, c.lat, c.lng) > 4) return true;
    return false;
  }

  const targets = ALL
    ? rows.filter((r) => r.google_place_id)
    : rows.filter(isSuspect);
  console.log(
    `${rows.length} venues total · re-fetching ${targets.length} from Google\n`,
  );

  const flags = { WRONG_CITY: 0, BAD_MATCH: 0, CLOSED: 0, JUNK: 0, NEIGHBOURHOOD_FIX: 0, GONE: 0 };
  let updated = 0;

  for (const r of targets) {
    let d: PlaceDetails | null;
    try {
      d = await placeDetails(r.google_place_id!);
    } catch (e) {
      console.log(`  ! ${r.slug}: fetch error ${e instanceof Error ? e.message : e}`);
      continue;
    }
    if (!d) {
      flags.GONE++;
      console.log(`  ⚰ ${r.slug}: place_id no longer exists on Google (GONE)`);
      continue;
    }

    const lat = d.location?.latitude ?? null;
    const lng = d.location?.longitude ?? null;
    const gName = d.displayName?.text ?? "";
    // Postcode is the reliable signal; fall back to Google's area component.
    const gArea = areaFromPostcode(d.formattedAddress) ?? neighbourhoodFrom(d);
    const labels: string[] = [];

    if (lat == null || lng == null) labels.push("JUNK(no-coords)");
    else if (!inLondon(lat, lng)) labels.push("WRONG_CITY");
    if (gName && !namesMatch(r.name, gName)) labels.push(`BAD_MATCH(google="${gName}")`);
    if (d.businessStatus && d.businessStatus !== "OPERATIONAL")
      labels.push(`CLOSED(${d.businessStatus})`);
    if (gArea && norm(gArea) !== norm(r.neighbourhood)) labels.push("NEIGHBOURHOOD_FIX");

    for (const l of labels) {
      if (l.startsWith("WRONG_CITY")) flags.WRONG_CITY++;
      else if (l.startsWith("BAD_MATCH")) flags.BAD_MATCH++;
      else if (l.startsWith("CLOSED")) flags.CLOSED++;
      else if (l.startsWith("JUNK")) flags.JUNK++;
      else if (l.startsWith("NEIGHBOURHOOD_FIX")) flags.NEIGHBOURHOOD_FIX++;
    }

    console.log(
      `  ${r.slug}\n    was: "${r.neighbourhood}" · ${r.address}\n    now: ${gArea ? `"${gArea}"` : "(area?)"} · ${d.formattedAddress ?? "?"}${labels.length ? `\n    ⚑ ${labels.join(", ")}` : "  ✓ ok"}`,
    );

    // Safe auto-fixes only: correct coords/address/neighbourhood when the place
    // is confidently the right one (in London, name matches). Wrong-city /
    // bad-match / junk are FLAGGED for review, never auto-changed.
    const safe =
      lat != null && lng != null && inLondon(lat, lng) && namesMatch(r.name, gName);
    if (APPLY && safe) {
      const update: Record<string, unknown> = { lat, lng };
      if (d.formattedAddress) update.address = d.formattedAddress;
      if (gArea && norm(gArea) !== norm(r.neighbourhood)) update.neighbourhood = gArea;
      const { error } = await supabase.from("venues").update(update).eq("id", r.id);
      if (error) console.log(`    ✗ update failed: ${error.message}`);
      else updated++;
    }

    // Persist closure independently of the location safe-gate: a closed venue
    // should be marked even if we leave its area alone.
    if (
      APPLY &&
      !r.closed_at &&
      d.businessStatus &&
      d.businessStatus !== "OPERATIONAL"
    ) {
      await supabase
        .from("venues")
        .update({ closed_at: new Date().toISOString() })
        .eq("id", r.id);
      console.log(`    ⚰ marked closed_at (${d.businessStatus})`);
    }
  }

  console.log("\n─────────── SUMMARY ───────────");
  console.log(`Re-fetched:         ${targets.length}`);
  console.log(`Neighbourhood fix:  ${flags.NEIGHBOURHOOD_FIX}`);
  console.log(`Wrong city:         ${flags.WRONG_CITY}`);
  console.log(`Bad match (name):   ${flags.BAD_MATCH}`);
  console.log(`Closed:             ${flags.CLOSED}`);
  console.log(`Junk / no coords:   ${flags.JUNK}`);
  console.log(`Gone from Google:   ${flags.GONE}`);
  if (APPLY) console.log(`Rows updated (safe): ${updated}`);
  console.log(`\n${APPLY ? "Done." : "Dry run — no writes. Re-run with --apply to fix the safe ones."}`);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
