"use client";

// Option B preview: the plan route on a REAL dark street map (Leaflet + CARTO
// dark tiles built on OpenStreetMap data). Keyless — no Maps API key in the
// browser; tiles are public with attribution. Numbered violet markers match the
// stop list; a dashed line is the walk.

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import type { Venue } from "@/lib/types";

type RouteStep = {
  venue: Pick<Venue, "lat" | "lng" | "name">;
  walkToNextMins: number | null;
};

const ACCENT = "hsl(266 78% 58%)";

export function PlanRouteMapLive({ steps }: { steps: RouteStep[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const pts = steps.filter(
    (s): s is RouteStep & { venue: { lat: number; lng: number; name: string } } =>
      s.venue.lat != null && s.venue.lng != null,
  );
  const coordsKey = pts
    .map((p) => `${p.venue.lat},${p.venue.lng}`)
    .join("|");

  useEffect(() => {
    if (!ref.current || pts.length < 2) return;
    let cancelled = false;
    let map: import("leaflet").Map | undefined;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !ref.current) return;
      const m = L.map(ref.current, {
        zoomControl: false,
        scrollWheelZoom: false,
        attributionControl: false, // our own subtle credit lives below the map
      });
      map = m;
      // Light "Positron" tiles + a greyscale filter (see globals.css) to match
      // the venue page's clean grey static map.
      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
        { subdomains: "abcd", maxZoom: 20 },
      ).addTo(m);

      const latlngs = pts.map(
        (p) => [p.venue.lat, p.venue.lng] as [number, number],
      );
      pts.forEach((p, i) => {
        const icon = L.divIcon({
          className: "",
          html:
            `<div style="width:26px;height:26px;border-radius:50%;background:${ACCENT};` +
            `color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;` +
            `font-size:13px;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45)">${i + 1}</div>`,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        });
        L.marker([p.venue.lat, p.venue.lng], { icon }).addTo(m);
      });
      m.fitBounds(L.latLngBounds(latlngs).pad(0.3)); // frame immediately

      // Real walking geometry that follows the streets (keyless OSRM foot
      // service on OSM data). Falls back to straight hops if it's unavailable.
      let line = latlngs;
      let dashed = true;
      try {
        const coords = pts
          .map((p) => `${p.venue.lng},${p.venue.lat}`)
          .join(";");
        // Don't let a slow/unreachable router hang the map — bail to the
        // straight-line fallback after 3s.
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 3000);
        const res = await fetch(
          `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${coords}?overview=full&geometries=geojson`,
          { signal: ctrl.signal },
        );
        clearTimeout(t);
        const data = res.ok ? await res.json() : null;
        const geo = data?.routes?.[0]?.geometry?.coordinates;
        if (Array.isArray(geo) && geo.length > 1) {
          line = geo.map((c: [number, number]) => [c[1], c[0]]);
          dashed = false;
        }
      } catch {
        // unreachable / slow / aborted → keep the straight-line fallback
      }
      if (cancelled) return; // unmounted mid-fetch — cleanup removes the map
      L.polyline(line, {
        color: ACCENT,
        weight: dashed ? 3 : 4,
        opacity: 0.95,
        ...(dashed ? { dashArray: "2 8" } : {}),
        lineCap: "round",
        lineJoin: "round",
      }).addTo(m);
      m.fitBounds(L.latLngBounds(line).pad(0.25));
    })();
    return () => {
      cancelled = true;
      if (map) map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coordsKey]);

  if (pts.length < 2) return null;

  return (
    <div>
      <div
        ref={ref}
        style={{ height: 220 }}
        className="fl-plan-map w-full overflow-hidden rounded-2xl border border-border"
        role="img"
        aria-label="Map of your walk between the stops"
      />
      <div className="mt-1 text-right text-[10px] text-muted-fg">
        Map from OpenStreetMap &amp; CARTO
      </div>
    </div>
  );
}
