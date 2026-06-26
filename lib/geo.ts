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

// How long a stored fix is trusted before callers should refresh it. Past this
// the user has likely moved, so we re-acquire rather than sort by a stale spot.
const GEO_TTL_MS = 30 * 60 * 1000; // 30 minutes

// Read the stored location ONLY if it's still fresh (within GEO_TTL_MS). A
// stale or timestamp-less fix returns null so the caller re-acquires.
export function readFreshUserGeo(now = Date.now()): LatLng | null {
  try {
    const raw = window.localStorage.getItem(GEO_STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { lat?: unknown; lng?: unknown; at?: unknown };
    if (typeof p.lat !== "number" || typeof p.lng !== "number") return null;
    if (typeof p.at === "number" && now - p.at > GEO_TTL_MS) return null;
    return { lat: p.lat, lng: p.lng };
  } catch {
    return null;
  }
}

// Persist a fix with a capture timestamp (powers the freshness check above).
export function storeUserGeo(g: LatLng): void {
  try {
    window.localStorage.setItem(
      GEO_STORAGE_KEY,
      JSON.stringify({ lat: g.lat, lng: g.lng, at: Date.now() }),
    );
  } catch {
    /* storage unavailable — non-fatal */
  }
}

export type GeoOutcome =
  | { ok: true; geo: LatLng }
  | { ok: false; reason: "denied" | "unavailable" | "timeout" };

// Robust location capture. Browser geolocation is flaky because a COLD fix
// (first call, indoors) regularly exceeds a single short timeout while a WARM
// fix is instant, so one attempt "sometimes works, sometimes doesn't". We make
// one quick attempt, then retry ONCE with a longer timeout (accepting a recent
// cached fix) on timeout / position-unavailable. PERMISSION_DENIED
// short-circuits (a retry can't help). Always resolves; persists on success.
export function requestUserGeo(): Promise<GeoOutcome> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      resolve({ ok: false, reason: "unavailable" });
      return;
    }
    const onSuccess = (pos: GeolocationPosition) => {
      const geo = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      storeUserGeo(geo);
      resolve({ ok: true, geo });
    };
    const attempt = (timeout: number, maximumAge: number, isRetry: boolean) => {
      navigator.geolocation.getCurrentPosition(
        onSuccess,
        (err) => {
          if (err.code === err.PERMISSION_DENIED) {
            resolve({ ok: false, reason: "denied" });
          } else if (!isRetry) {
            // TIMEOUT (3) / POSITION_UNAVAILABLE (2): try once more, longer +
            // accept a recent cached fix to beat a slow cold acquisition.
            attempt(20000, 600000, true);
          } else {
            resolve({
              ok: false,
              reason: err.code === err.TIMEOUT ? "timeout" : "unavailable",
            });
          }
        },
        { enableHighAccuracy: false, timeout, maximumAge },
      );
    };
    attempt(12000, 60000, false);
  });
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
