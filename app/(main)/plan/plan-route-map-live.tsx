"use client";

// The plan route on a REAL street map: Leaflet + CARTO "light_all" (Positron)
// tiles built on OpenStreetMap data, desaturated to greyscale in CSS (see the
// .fl-plan-map tile filter in globals.css) so the violet markers carry the colour.
// Keyless — no Maps API key in the browser; tiles are public with attribution.
// Numbered violet markers match the stop list. The walking line is SOLID when
// OSRM returns real street geometry, DASHED when it timed out and we fell back
// to straight-line hops.

import { useEffect, useRef, useState } from "react";
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
    (
      s,
    ): s is RouteStep & { venue: { lat: number; lng: number; name: string } } =>
      s.venue.lat != null && s.venue.lng != null,
  );
  const coordsKey = pts.map((p) => `${p.venue.lat},${p.venue.lng}`).join("|");

  // Held across renders so the instance survives every replacement.
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const stopLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const routeLayerRef = useRef<import("leaflet").Polyline | null>(null);
  const runRef = useRef(0);
  // Bumped once the instance exists, so the layer effect below re-runs against
  // it rather than bailing on the first pass.
  const [ready, setReady] = useState(0);

  // 🧨 THE MAP IS BUILT ONCE AND UPDATED IN PLACE. Keying the whole effect on
  // the coordinates destroyed the Leaflet instance on every Change and every
  // Undo: tiles reloaded, the frame jumped, and the route dropped to the
  // dashed straight-line fallback for up to three seconds while OSRM was
  // re-asked — so the same night's map looked different between two identical
  // states, and a run of taps left it flickering. The instance and its tiles
  // now outlive every replacement; only the markers and the line change.
  useEffect(() => {
    if (!mapRef.current || pts.length < 2) return;
    let cancelled = false;
    const run = ++runRef.current;
    (async () => {
      const L = (await import("leaflet")).default;
      const m = mapRef.current;
      if (cancelled || !m) return;

      const latlngs = pts.map(
        (p) => [p.venue.lat, p.venue.lng] as [number, number],
      );

      // Markers are cheap and exact, so they swap immediately.
      stopLayerRef.current?.remove();
      const group = L.layerGroup().addTo(m);
      stopLayerRef.current = group;
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
        L.marker([p.venue.lat, p.venue.lng], { icon }).addTo(group);
      });
      m.fitBounds(L.latLngBounds(latlngs).pad(0.3));

      // 🧨 The OLD line stays drawn while the new one is fetched. Clearing it
      // first is what produced the flash: a blank map, then a dashed
      // straight-line guess, then the real route — three states for one tap.
      // Real walking geometry from the keyless OSRM foot service on OSM data.
      let line = latlngs;
      let dashed = true;
      try {
        const coords = pts
          .map((p) => `${p.venue.lng},${p.venue.lat}`)
          .join(";");
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 3000);
        let data: unknown = null;
        try {
          const res = await fetch(
            `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${coords}?overview=full&geometries=geojson`,
            { signal: ctrl.signal },
          );
          data = res.ok ? await res.json() : null;
        } finally {
          // Cleared on the throw path too, or every superseded fetch leaves a
          // live abort timer behind.
          clearTimeout(t);
        }
        const geo = (
          data as { routes?: { geometry?: { coordinates?: unknown } }[] } | null
        )?.routes?.[0]?.geometry?.coordinates;
        if (Array.isArray(geo) && geo.length > 1) {
          line = geo.map((c: [number, number]) => [c[1], c[0]]);
          dashed = false;
        }
      } catch {
        // unreachable / slow / aborted → straight-line fallback
      }
      // A later tap has already started its own fetch; that one owns the line.
      if (cancelled || runRef.current !== run || !mapRef.current) return;
      routeLayerRef.current?.remove();
      routeLayerRef.current = L.polyline(line, {
        color: ACCENT,
        weight: dashed ? 3 : 4,
        opacity: 0.95,
        ...(dashed ? { dashArray: "2 8" } : {}),
        lineCap: "round",
        lineJoin: "round",
      }).addTo(m);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coordsKey, ready]);

  // Create the map and its tiles exactly once.
  // 🧨 Keyed on whether there is a container to draw in, not on mount alone.
  // `pts.length < 2` unmounts the div, so a stop losing its coordinates left
  // Leaflet bound to a detached node — and when the container came back as a
  // fresh node the instance was still the old one, so the layer effect drew
  // into nothing and the user got an empty bordered box for the rest of the
  // session. It tears down when the container goes and re-creates when it
  // returns.
  const hasContainer = pts.length >= 2;
  useEffect(() => {
    if (!hasContainer) {
      mapRef.current?.remove();
      mapRef.current = null;
      stopLayerRef.current = null;
      routeLayerRef.current = null;
      return;
    }
    if (!ref.current || mapRef.current) return;
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !ref.current || mapRef.current) return;
      const m = L.map(ref.current, {
        zoomControl: false,
        scrollWheelZoom: false,
        attributionControl: false, // our own subtle credit lives below the map
      });
      // Light "Positron" tiles + a greyscale filter (see globals.css) to match
      // the venue page's clean grey static map.
      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
        { subdomains: "abcd", maxZoom: 20 },
      ).addTo(m);
      mapRef.current = m;
      // Nudge the layer effect now that there is something to draw on.
      setReady((n) => n + 1);
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      stopLayerRef.current = null;
      routeLayerRef.current = null;
    };
  }, [hasContainer]);

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
