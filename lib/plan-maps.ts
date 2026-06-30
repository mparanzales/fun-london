// Plan → Google Maps. Builds a walking-directions URL through every stop in a
// plan, so "Open in Google Maps" hands the user real turn-by-turn navigation
// (and the exact street distances) for the night we routed.
//
// Keyless by construction: this is just a maps.google.com deep link — no Maps
// API key ever touches the browser (same approach as the venue page's
// single-destination directions link).

export type RouteStop = {
  lat: number | null;
  lng: number | null;
  name?: string;
};

// https://developers.google.com/maps/documentation/urls/get-started#directions-action
// Walking mode, first stop = origin, last = destination, the rest = waypoints in
// order. Returns null when no stop has coordinates (nothing to route).
export function googleMapsWalkingUrl(stops: RouteStop[]): string | null {
  const pts = stops.filter(
    (s): s is RouteStop & { lat: number; lng: number } =>
      s.lat != null && s.lng != null,
  );
  if (pts.length === 0) return null;

  const base = "https://www.google.com/maps/dir/?api=1&travelmode=walking";
  const coord = (s: { lat: number; lng: number }) => `${s.lat},${s.lng}`;

  // A single stop has no "between" — just route to it.
  if (pts.length === 1) return `${base}&destination=${coord(pts[0])}`;

  const origin = coord(pts[0]);
  const destination = coord(pts[pts.length - 1]);
  const waypoints = pts.slice(1, -1).map(coord).join("|"); // ordered, may be ""
  return (
    `${base}&origin=${origin}&destination=${destination}` +
    (waypoints ? `&waypoints=${waypoints}` : "")
  );
}
