// A keyless route diagram for a plan — no map tiles, no Maps API key, no
// third-party requests (so nothing leaks the user's night). It plots the stops
// from their own lat/lng, draws the walk between them, numbers each stop to
// match the list above, and labels the minutes per hop. The real street map +
// turn-by-turn lives one tap away behind "Open in Google Maps".

import type { Venue } from "@/lib/types";

type RouteStep = {
  venue: Pick<Venue, "lat" | "lng" | "name">;
  walkToNextMins: number | null;
};

const W = 320;
const H = 168;
const PAD = 30;

export function PlanRouteMap({ steps }: { steps: RouteStep[] }) {
  const pts = steps.filter(
    (s): s is RouteStep & { venue: { lat: number; lng: number; name: string } } =>
      s.venue.lat != null && s.venue.lng != null,
  );
  // Need at least two located stops to draw a walk.
  if (pts.length < 2) return null;

  const lats = pts.map((p) => p.venue.lat);
  const lngs = pts.map((p) => p.venue.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  // East–west degrees are shorter than north–south at London's latitude; correct
  // for it so the route's shape isn't stretched.
  const lngK = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const dLat = Math.max(maxLat - minLat, 1e-6);
  const dLng = Math.max((maxLng - minLng) * lngK, 1e-6);
  const scale = Math.min((W - 2 * PAD) / dLng, (H - 2 * PAD) / dLat);
  const offX = (W - 2 * PAD - dLng * scale) / 2;
  const offY = (H - 2 * PAD - dLat * scale) / 2;
  const xy = pts.map((p): [number, number] => [
    PAD + offX + (p.venue.lng - minLng) * lngK * scale,
    PAD + offY + (maxLat - p.venue.lat) * scale, // north points up
  ]);
  const path = xy
    .map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-muted/40">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full"
        role="img"
        aria-label="Map of your walk between the stops"
      >
        {/* the walk */}
        <path
          d={path}
          fill="none"
          stroke="var(--fl-accent)"
          strokeWidth={2}
          strokeDasharray="2 5"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.75}
        />
        {/* minutes per hop, at each segment's midpoint */}
        {xy.slice(0, -1).map(([x, y], i) => {
          const mins = pts[i].walkToNextMins;
          if (mins == null) return null;
          const [nx, ny] = xy[i + 1];
          const mx = (x + nx) / 2;
          const my = (y + ny) / 2;
          return (
            <g key={`hop-${i}`}>
              <rect
                x={mx - 15}
                y={my - 8}
                width={30}
                height={16}
                rx={8}
                fill="var(--fl-card)"
                stroke="var(--fl-border)"
              />
              <text
                x={mx}
                y={my + 3}
                textAnchor="middle"
                fontSize="9"
                fontWeight={700}
                fill="var(--fl-muted-fg)"
              >
                {mins}m
              </text>
            </g>
          );
        })}
        {/* numbered stops (match the list above) */}
        {xy.map(([x, y], i) => (
          <g key={`stop-${i}`}>
            <circle cx={x} cy={y} r={11} fill="var(--fl-accent)" />
            <text
              x={x}
              y={y + 3.5}
              textAnchor="middle"
              fontSize="11"
              fontWeight={800}
              fill="#fff"
            >
              {i + 1}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
