// Lightweight client-side geo helpers for "near you" sorting. The user's
// coordinates are captured (with permission) by the welcome sheet and stored
// in localStorage under fl.geo.v1; venue coordinates come from Google Places.

export type LatLng = { lat: number; lng: number };

export const GEO_STORAGE_KEY = "fl.geo.v1";

// Read the stored user location, or null if absent/unparseable.
export function readUserGeo(): LatLng | null {
  try {
    const raw = window.localStorage.getItem(GEO_STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { lat?: unknown; lng?: unknown };
    if (typeof p.lat === "number" && typeof p.lng === "number") {
      return { lat: p.lat, lng: p.lng };
    }
  } catch {
    // unavailable / malformed
  }
  return null;
}

// Great-circle distance in kilometres between two points (haversine).
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Human label for a distance, on-brand (the app thinks in walkable nights out).
// ~80 m/min walking pace; falls back to km once it's clearly not walkable.
export function distanceLabel(km: number): string {
  const mins = Math.max(1, Math.round((km * 1000) / 80));
  if (mins <= 45) return `~${mins} min walk`;
  return `${km.toFixed(1)} km away`;
}
