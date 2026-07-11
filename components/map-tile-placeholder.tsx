// Blurred keyless map tile behind the venue/event map plate when we hold
// no static map image. Before this, the plate was a flat bg-muted box with
// a pin — it read as "failed to load" rather than "map preview" (Maria,
// 2026-07-10). A real CARTO/OSM greyscale tile of the venue's area,
// blurred and dimmed, fixes that at £0 — same public keyless tiles and
// credit line as the plan route map (plan-route-map-live.tsx). Decorative
// only: the tile layers are aria-hidden and the pin + label stay the
// accessible content.

import { MapPin } from "lucide-react";

// Web-Mercator lat/lng → slippy tile coordinates.
function tileXY(lat: number, lng: number, z: number) {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  );
  return { x, y };
}

const ZOOM = 15;

export function MapTilePlaceholder({
  lat,
  lng,
  label,
}: {
  lat?: number | null;
  lng?: number | null;
  label: string;
}) {
  const tile = lat != null && lng != null ? tileXY(lat, lng, ZOOM) : null;
  return (
    <span className="relative flex h-full items-center justify-center gap-2 overflow-hidden bg-muted text-muted-fg">
      {tile && (
        <>
          {/* One tile per theme (light_all / dark_all), toggled by the
              resolved data-theme attribute the ThemeProvider stamps. Blur +
              scale hides the single-tile pixelation; the bg tint pulls it
              toward the page surface. */}
          <span
            aria-hidden
            className="absolute inset-0 hidden scale-110 bg-cover bg-center blur-[3px] [[data-theme=day]_&]:block"
            style={{
              backgroundImage: `url(https://a.basemaps.cartocdn.com/light_all/${ZOOM}/${tile.x}/${tile.y}@2x.png)`,
            }}
          />
          <span
            aria-hidden
            className="absolute inset-0 hidden scale-110 bg-cover bg-center blur-[3px] [[data-theme=night]_&]:block"
            style={{
              backgroundImage: `url(https://a.basemaps.cartocdn.com/dark_all/${ZOOM}/${tile.x}/${tile.y}@2x.png)`,
            }}
          />
          <span aria-hidden className="absolute inset-0 bg-bg/30" />
        </>
      )}
      <span className="relative flex items-center gap-2 drop-shadow-sm">
        <MapPin className="h-5 w-5" strokeWidth={2} />
        <span className="text-sm font-medium lg:text-base">{label}</span>
      </span>
      {tile && (
        <span className="absolute bottom-1 right-2 text-[9px] text-muted-fg/80">
          Map from OpenStreetMap &amp; CARTO
        </span>
      )}
    </span>
  );
}
