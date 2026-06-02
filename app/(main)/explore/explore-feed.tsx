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
  type LucideIcon,
} from "lucide-react";
import { VenueCard } from "@/components/venue-card";
import { EventCard } from "@/components/event-card";
import { SearchOverlay } from "@/components/search-overlay";
import { CITY, TAGLINE } from "@/lib/config";
import { hasPrefs, scoreVenue, scoreEvent } from "@/lib/ranking";
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

  const items = useMemo<FeedItem[]>(() => {
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
  }, [selectedFilter, allVenues, allEvents, prefs, personalized]);

  // Smart category-tag visibility:
  //   For You / Music / Events → mixed sources or subtypes → show tags
  //   Restaurants / Bars / Cafés → single category → hide tags
  const showCategoryTag =
    selectedFilter === "for-you" ||
    selectedFilter === "music" ||
    selectedFilter === "events";

  return (
    <div className="pb-6">
      {/* Masthead row: editorial wordmark left, search affordance right.
          items-end aligns the search button to the bottom edge of the
          wordmark line (not the eyebrow), so they baseline together. */}
      <header className="px-5 pt-8 pb-6">
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
              <span className="text-3xl font-bold text-primary lowercase">
                fun
              </span>
              <span className="text-3xl font-bold text-primary">{CITY}</span>
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
          {TAGLINE}
        </p>
      </header>

      <FilterChipRow selected={selectedFilter} onSelect={setSelectedFilter} />

      {selectedFilter === "for-you" && personalized && (
        <div className="px-5 pt-1.5 text-[11px] font-semibold text-muted-fg">
          ✨ Sorted around your taste
        </div>
      )}

      {items.length === 0 ? (
        <div className="px-5 pt-10 text-center text-sm text-muted-fg">
          Nothing here yet. Check back soon.
        </div>
      ) : (
        <div className="px-5 pt-5 flex flex-col gap-4">
          {items.map((item) =>
            item.kind === "venue" ? (
              <VenueCard
                key={`venue-${item.data.id}`}
                venue={item.data}
                variant="wide"
                showCategoryTag={showCategoryTag}
              />
            ) : (
              <EventCard
                key={`event-${item.data.id}`}
                event={item.data}
                showCategoryTag={showCategoryTag}
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
    <div className="px-5 grid grid-cols-6 gap-1 py-2">
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
