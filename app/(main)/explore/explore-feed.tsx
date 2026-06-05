"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Flame,
  UtensilsCrossed,
  Wine,
  Coffee,
  Music,
  Ticket,
  Search,
  MapPin,
  type LucideIcon,
} from "lucide-react";
import { VenueCard } from "@/components/venue-card";
import { EventCard } from "@/components/event-card";
import { SearchOverlay } from "@/components/search-overlay";
import { CITY, LEAD_TAGLINE } from "@/lib/config";
import { hasPrefs, scoreVenue, scoreEvent } from "@/lib/ranking";
import {
  readUserGeo,
  haversineKm,
  distanceLabel,
  GEO_STORAGE_KEY,
  type LatLng,
} from "@/lib/geo";
import type {
  Venue,
  Event,
  VenueType,
  EventCategory,
  UserPreferences,
} from "@/lib/types";

const ONBOARDING_STORAGE_KEY = "fl.onboarding.v1";

type FilterKey =
  | "for-you"
  | "restaurants"
  | "bars"
  | "cafes"
  | "music"
  | "events";

type FeedItem = { kind: "venue"; data: Venue } | { kind: "event"; data: Event };

// Bars chip — bar-family venue types (the brief's `type === "bar"` is the
// shorthand; we have a richer existing taxonomy so all four bar-adjacent
// types fall under this chip).
const BAR_TYPES: VenueType[] = ["Bar", "Wine Bar", "Pub", "Listening Bar"];

// Music chip — union of (venues with music type) + (events with music
// category). Live Music is the only purely-music venue type in the enum;
// Listening Bars stay under Bars to avoid double-counting Spiritland.
const MUSIC_VENUE_TYPES: VenueType[] = ["Live Music"];
const MUSIC_EVENT_CATEGORY: EventCategory = "Music";

// Editorial eyebrow: 06:00–17:59 → "today in"; 18:00–05:59 → "tonight in".
function getEyebrow(): "today in" | "tonight in" {
  const h = new Date().getHours();
  return h >= 6 && h < 18 ? "today in" : "tonight in";
}

export function ExploreFeed({
  venues: allVenues,
  events: allEvents,
  greetingName,
  preferences,
}: {
  venues: Venue[];
  events: Event[];
  greetingName: string;
  preferences: UserPreferences | null;
}) {
  const [selectedFilter, setSelectedFilter] = useState<FilterKey>("for-you");
  const [searchOpen, setSearchOpen] = useState(false);
  const eyebrow = getEyebrow();

  // Preferences: server-provided (signed-in profile) win; otherwise hydrate
  // from the anonymous onboarding payload in localStorage on mount.
  const [prefs, setPrefs] = useState<UserPreferences | null>(preferences);
  useEffect(() => {
    if (preferences) {
      setPrefs(preferences);
      return;
    }
    try {
      const raw = window.localStorage.getItem(ONBOARDING_STORAGE_KEY);
      if (!raw) return;
      const p = JSON.parse(raw) as Partial<UserPreferences>;
      if (p && (p.moods?.length || p.vibes?.length)) {
        setPrefs({
          moods: p.moods ?? [],
          vibes: p.vibes ?? [],
          budget: p.budget ?? null,
          areas: p.areas ?? [],
        });
      }
    } catch {
      // localStorage unavailable
    }
  }, [preferences]);

  const personalized = hasPrefs(prefs);

  // "Near you" — read the location captured by the welcome sheet (if any) and
  // let the user sort the current view by walking distance.
  const [userGeo, setUserGeo] = useState<LatLng | null>(null);
  const [nearestFirst, setNearestFirst] = useState(false);
  // idle = ready · locating = waiting on the browser · denied = permission off
  // · unavailable = no geolocation / hardware error.
  const [geoStatus, setGeoStatus] = useState<
    "idle" | "locating" | "denied" | "unavailable"
  >("idle");
  useEffect(() => {
    setUserGeo(readUserGeo());
  }, []);

  function toggleNearest() {
    // Re-read in case the welcome sheet stored coords after this mounted.
    const stored = userGeo ?? readUserGeo();
    if (stored) {
      if (!userGeo) setUserGeo(stored);
      setNearestFirst((v) => !v);
      return;
    }
    if (!("geolocation" in navigator)) {
      setGeoStatus("unavailable");
      return;
    }
    setGeoStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const g = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        try {
          window.localStorage.setItem(
            GEO_STORAGE_KEY,
            JSON.stringify({ ...g, at: Date.now() }),
          );
        } catch {
          /* ignore */
        }
        setUserGeo(g);
        setNearestFirst(true);
        setGeoStatus("idle");
      },
      (err) => {
        // Tell the user instead of failing silently. PERMISSION_DENIED = 1.
        setGeoStatus(err.code === 1 ? "denied" : "unavailable");
      },
      // Reuse a recent fix (10 min) so we don't re-prompt or hang.
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    );
  }

  const items = useMemo<FeedItem[]>(() => {
    const base = ((): FeedItem[] => {
      switch (selectedFilter) {
        case "for-you": {
          const all: FeedItem[] = [
            ...allVenues.map<FeedItem>((v) => ({ kind: "venue", data: v })),
            ...allEvents.map<FeedItem>((e) => ({ kind: "event", data: e })),
          ];
          // Rank by taste when we have prefs; otherwise keep the original
          // order. Array.sort is stable, so equal-score items keep their
          // relative order (venues before events).
          if (prefs && personalized) {
            const score = (it: FeedItem) =>
              it.kind === "venue"
                ? scoreVenue(it.data, prefs)
                : scoreEvent(it.data, prefs);
            return [...all].sort((a, b) => score(b) - score(a));
          }
          return all;
        }
        case "restaurants":
          return allVenues
            .filter((v) => v.type === "Restaurant")
            .map<FeedItem>((v) => ({ kind: "venue", data: v }));
        case "bars":
          return allVenues
            .filter((v) => BAR_TYPES.includes(v.type))
            .map<FeedItem>((v) => ({ kind: "venue", data: v }));
        case "cafes":
          return allVenues
            .filter((v) => v.type === "Cafe")
            .map<FeedItem>((v) => ({ kind: "venue", data: v }));
        case "music":
          return [
            ...allVenues
              .filter((v) => MUSIC_VENUE_TYPES.includes(v.type))
              .map<FeedItem>((v) => ({ kind: "venue", data: v })),
            ...allEvents
              .filter((e) => e.category === MUSIC_EVENT_CATEGORY)
              .map<FeedItem>((e) => ({ kind: "event", data: e })),
          ];
        case "events":
          return allEvents.map<FeedItem>((e) => ({ kind: "event", data: e }));
      }
    })();

    // "Nearest first" — sort the filtered view by walking distance. Events and
    // coordinate-less venues sink to the bottom (Infinity).
    if (nearestFirst && userGeo) {
      const dist = (it: FeedItem): number => {
        if (it.kind !== "venue") return Infinity;
        const { lat, lng } = it.data;
        if (lat == null || lng == null) return Infinity;
        return haversineKm(userGeo, { lat, lng });
      };
      return [...base].sort((a, b) => dist(a) - dist(b));
    }
    return base;
  }, [
    selectedFilter,
    allVenues,
    allEvents,
    prefs,
    personalized,
    nearestFirst,
    userGeo,
  ]);

  // Smart category-tag visibility:
  //   For You / Music / Events → mixed sources or subtypes → show tags
  //   Restaurants / Bars / Cafés → single category → hide tags
  const showCategoryTag =
    selectedFilter === "for-you" ||
    selectedFilter === "music" ||
    selectedFilter === "events";

  return (
    <div className="pb-6">
      {/* MOBILE masthead (hidden on desktop, which uses the hero band below).
          Editorial wordmark left, search right; the "fun London" wordmark now
          carries the brand gradient. */}
      <header className="px-5 pt-8 pb-6 lg:hidden">
        {/* Personal greeting line — same display name appears on /profile. */}
        <div className="text-xl font-medium text-fg mb-1">
          Hi {greetingName},
        </div>
        <div className="flex justify-between items-end">
          <h1 className="flex items-baseline gap-3 m-0 leading-none">
            <span
              className="text-xl italic font-medium text-muted-fg lowercase"
              suppressHydrationWarning
            >
              {eyebrow}
            </span>
            <span className="inline-flex items-baseline gap-2">
              <span className="text-3xl font-bold fl-grad-text lowercase">
                fun
              </span>
              <span className="text-3xl font-bold fl-grad-text">{CITY}</span>
            </span>
          </h1>
          <button
            type="button"
            aria-label="Search"
            onClick={() => setSearchOpen(true)}
            className="p-2 -mr-2 text-fg"
          >
            <Search className="w-6 h-6" strokeWidth={2} />
          </button>
        </div>
        {/* Positioning line — states the thesis on the most-seen screen so a
            first-time user understands what makes this different in seconds. */}
        <p className="mt-2 text-[12px] font-semibold text-muted-fg leading-snug">
          {LEAD_TAGLINE}
        </p>
      </header>

      {/* DESKTOP hero band (lg+ only) — big lowercase headline + trust strip,
          where the "no chains, cross-checked" credibility becomes visible. */}
      <section className="hidden lg:block px-6 pt-10 pb-7">
        <h1 className="text-5xl font-extrabold lowercase tracking-tight leading-[1.04]">
          <span className="fl-grad-text">the independent {CITY}</span>
          <br />
          <span className="text-heading">worth leaving the house for.</span>
        </h1>
        <div className="mt-5 flex items-center gap-3 text-[13px] font-bold uppercase tracking-wider text-muted-fg">
          <span>{allVenues.length} independent venues</span>
          <span className="text-border">/</span>
          <span>cross-checked in 2+ sources</span>
          <span className="text-border">/</span>
          <span>no chains</span>
        </div>
      </section>

      <FilterChipRow selected={selectedFilter} onSelect={setSelectedFilter} />

      {/* "Near you" sort + taste status line. */}
      <div className="px-5 lg:px-6 pt-1.5 flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={toggleNearest}
          aria-pressed={nearestFirst}
          disabled={geoStatus === "locating"}
          className={
            "inline-flex items-center gap-1 h-7 px-3 rounded-full text-[11px] font-bold transition disabled:opacity-70 " +
            (nearestFirst
              ? "bg-primary text-primary-fg"
              : "bg-muted text-muted-fg")
          }
        >
          <MapPin size={12} strokeWidth={2.4} />
          {geoStatus === "locating"
            ? "Locating…"
            : nearestFirst
              ? "Nearest first"
              : "Near you"}
        </button>
        {geoStatus === "denied" && (
          <span className="text-[11px] font-semibold text-muted-fg">
            Location is off. Turn it on for this site in your browser to sort by
            nearest.
          </span>
        )}
        {geoStatus === "unavailable" && (
          <span className="text-[11px] font-semibold text-muted-fg">
            Could not get your location. Try again.
          </span>
        )}
        {selectedFilter === "for-you" &&
          personalized &&
          !nearestFirst &&
          geoStatus === "idle" && (
            <span className="text-[11px] font-semibold text-muted-fg">
              ✨ Sorted around your taste
            </span>
          )}
      </div>

      {items.length === 0 ? (
        <div className="px-5 pt-10 text-center text-sm text-muted-fg">
          Nothing here yet. Check back soon.
        </div>
      ) : (
        <div className="px-5 lg:px-6 pt-5 grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-4 gap-4 lg:gap-5">
          {items.map((item, index) =>
            item.kind === "venue" ? (
              <VenueCard
                key={`venue-${item.data.id}`}
                venue={item.data}
                variant="wide"
                showCategoryTag={showCategoryTag}
                priority={index === 0}
                distanceLabel={
                  nearestFirst &&
                  userGeo &&
                  item.data.lat != null &&
                  item.data.lng != null
                    ? distanceLabel(
                        haversineKm(userGeo, {
                          lat: item.data.lat,
                          lng: item.data.lng,
                        }),
                      )
                    : undefined
                }
              />
            ) : (
              <EventCard
                key={`event-${item.data.id}`}
                event={item.data}
                showCategoryTag={showCategoryTag}
                priority={index === 0}
              />
            ),
          )}
        </div>
      )}

      {searchOpen && (
        <SearchOverlay
          venues={allVenues}
          events={allEvents}
          onClose={() => setSearchOpen(false)}
        />
      )}
    </div>
  );
}

// ── Filter chip row ──────────────────────────────────────────────────────
//
// Visual language mirrors components/bottom-nav.tsx active state:
//   • icon + label vertical stack, no pill / no border / no background
//   • active → text-accent (purple) + stroke 2.4 + font-medium on label
//   • inactive → text-muted-fg + stroke 2 + font-normal
// No circular halo — the bottom nav doesn't render one, and we mirror it
// exactly so the top filter row and bottom nav read as one design system.

function FilterChipRow({
  selected,
  onSelect,
}: {
  selected: FilterKey;
  onSelect: (key: FilterKey) => void;
}) {
  const chips: { key: FilterKey; label: string; Icon: LucideIcon }[] = [
    { key: "for-you", label: "For You", Icon: Flame },
    { key: "restaurants", label: "Eats", Icon: UtensilsCrossed },
    { key: "bars", label: "Bars", Icon: Wine },
    { key: "cafes", label: "Cafés", Icon: Coffee },
    { key: "music", label: "Music", Icon: Music },
    { key: "events", label: "Events", Icon: Ticket },
  ];

  return (
    <div className="px-5 lg:px-6 grid grid-cols-6 lg:flex lg:gap-5 gap-1 py-2">
      {chips.map((c) => {
        const isSelected = selected === c.key;
        const iconClass =
          "w-6 h-6 transition-colors duration-200 " +
          (isSelected ? "text-accent" : "text-muted-fg");
        const labelClass =
          "text-xs transition-colors duration-200 " +
          (isSelected
            ? "text-accent font-medium"
            : "text-muted-fg font-normal");
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => onSelect(c.key)}
            aria-pressed={isSelected}
            className="flex flex-col items-center gap-1 py-2"
          >
            <c.Icon className={iconClass} strokeWidth={isSelected ? 2.4 : 2} />
            <span className={labelClass}>{c.label}</span>
          </button>
        );
      })}
    </div>
  );
}
