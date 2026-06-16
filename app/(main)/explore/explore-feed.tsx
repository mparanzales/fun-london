"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Flame,
  UtensilsCrossed,
  Wine,
  Coffee,
  Music,
  Ticket,
  Search,
  MapPin,
  X,
  type LucideIcon,
} from "lucide-react";
import { VenueCard } from "@/components/venue-card";
import { EventCard } from "@/components/event-card";
import { SearchOverlay } from "@/components/search-overlay";
import { searchCatalog } from "@/lib/search-action";
import { loadFeedPage } from "@/lib/feed-action";
import type { FeedFilter, FeedSort } from "@/lib/queries";
import { FEED_PAGE_SIZE } from "@/lib/feed-constants";
import { SignupWall } from "@/components/signup-wall";
import { AuthWall } from "@/components/auth-wall";
import { CITY } from "@/lib/config";
import { hasPrefs } from "@/lib/ranking";
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

type FilterKey =
  | "for-you"
  | "restaurants"
  | "bars"
  | "cafes"
  | "music"
  | "events";

// Anon-only: which thing a soft AuthWall is gating. The CATEGORY chips are NOT
// here — for anon they filter to a 4-card preview + the sign-up wall, just like
// For You. Search is open to everyone now (signed-out search is server-side and
// card-level); only the Near-you sort still raises the blur wall.
type WallTarget = "near";
const WALL_TITLES: Record<WallTarget, string> = {
  near: "Sign up to sort by distance",
};

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

// How many general spots a signed-out visitor sees before the sign-up wall.
// Kept short on purpose — a taste, not the catalogue. Exported so the Server
// Component slices the anonymous preview to the SAME count in the DB.
export const PREVIEW_COUNT = 4;

// FEED_PAGE_SIZE lives in @/lib/feed-constants (a neutral module) so the server
// page can import the same value — importing it FROM this "use client" module
// into a Server Component resolved to undefined at runtime and emptied the feed.

// Shown-once flag for the signed-in "turn on location" nudge.
const LOCATION_PROMPTED_KEY = "fl.loc.prompted.v1";

export function ExploreFeed({
  venues: allVenues,
  events: allEvents,
  greetingName,
  preferences,
  signedIn,
  totalVenues,
  initialHasMore = false,
}: {
  venues: Venue[];
  events: Event[];
  greetingName: string;
  preferences: UserPreferences | null;
  signedIn: boolean;
  // Real catalogue size for the hero trust strip. For anon, `allVenues` is
  // only the trimmed preview, so the count must be passed separately.
  totalVenues: number;
  // Signed-in: whether page 0 (in `allVenues`) has more pages to paginate.
  initialHasMore?: boolean;
}) {
  const [selectedFilter, setSelectedFilter] = useState<FilterKey>("for-you");
  const [searchOpen, setSearchOpen] = useState(false);
  const eyebrow = getEyebrow();
  // Anon: clicking a category chip, search, or "Near you" raises a soft blur
  // wall (sign-in on top) over the For You preview — never a redirect, and never
  // catalogue data behind it (the backdrop stays the 4 public preview cards).
  // null = no wall.
  const [wallFor, setWallFor] = useState<WallTarget | null>(null);

  // Preferences come only from a signed-in profile now — the anonymous taste
  // quiz was removed. Anonymous visitors therefore have no taste signal: the
  // feed keeps its default order and the "Sorted around your taste" label
  // stays off, so we never claim personalisation we don't have.
  const personalized = hasPrefs(preferences);

  // "Near you" — read any previously captured location and let the user sort
  // the current view by walking distance.
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

  // One-time "turn on location" nudge for signed-in users. The old anonymous
  // welcome sheet used to ask for location; it's retired, so signed-in users
  // get this slim inline prompt once (until they enable or dismiss it). Shown
  // only when signed in AND no location is stored yet.
  const [showLocPrompt, setShowLocPrompt] = useState(false);
  useEffect(() => {
    if (!signedIn) return;
    try {
      if (window.localStorage.getItem(LOCATION_PROMPTED_KEY)) return;
      if (readUserGeo()) return;
      setShowLocPrompt(true);
    } catch {
      // localStorage unavailable — skip the nudge.
    }
  }, [signedIn]);

  function markLocPrompted() {
    try {
      window.localStorage.setItem(LOCATION_PROMPTED_KEY, "1");
    } catch {
      /* ignore */
    }
    setShowLocPrompt(false);
  }

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
          // Venues arrive already taste-ranked from the server (fetchVenueFeed)
          // and carry no tags to rank on, so we never re-rank client-side. The
          // small set of events follows the venues.
          return [
            ...allVenues.map<FeedItem>((v) => ({ kind: "venue", data: v })),
            ...allEvents.map<FeedItem>((e) => ({ kind: "event", data: e })),
          ];
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
  }, [selectedFilter, allVenues, allEvents, nearestFirst, userGeo]);

  // ── Signed-in feed: cursor pagination ───────────────────────────────────────
  // Page 0 arrives server-rendered in `allVenues`; the rest paginate in via the
  // server action as the user scrolls. The whole catalogue never ships, and the
  // next batch is fetched ~2 screens early so it's there before you reach it.
  const [loaded, setLoaded] = useState<Venue[]>(allVenues);
  const [feedHasMore, setFeedHasMore] = useState(initialHasMore);
  const loadingRef = useRef(false);
  const reqIdRef = useRef(0);
  const firstRun = useRef(true);
  const lastKeyRef = useRef<string | null>(null);

  // Reset + fetch page 0 whenever the view (category or nearest sort) changes.
  useEffect(() => {
    if (!signedIn) return;
    const sort: FeedSort = nearestFirst ? "nearest" : "taste";
    const filter =
      selectedFilter === "events" ? null : (selectedFilter as FeedFilter);
    const geoKey = userGeo
      ? `${userGeo.lat.toFixed(3)},${userGeo.lng.toFixed(3)}`
      : "";
    const key = `${selectedFilter}|${sort}|${sort === "nearest" ? geoKey : ""}`;
    // Page 0 of the default view is already server-rendered; don't re-fetch it.
    if (firstRun.current) {
      firstRun.current = false;
      lastKeyRef.current = key;
      return;
    }
    if (lastKeyRef.current === key) return; // e.g. geo loaded during taste sort
    lastKeyRef.current = key;

    if (!filter) {
      setLoaded([]); // "Events" view has no venue pages
      setFeedHasMore(false);
      return;
    }
    const myReq = ++reqIdRef.current;
    loadingRef.current = true;
    setLoaded([]);
    setFeedHasMore(true);
    loadFeedPage({
      filter,
      offset: 0,
      limit: FEED_PAGE_SIZE,
      sort,
      lat: userGeo?.lat ?? null,
      lng: userGeo?.lng ?? null,
    })
      .then((res) => {
        if (myReq !== reqIdRef.current) return;
        setLoaded(res.venues);
        setFeedHasMore(res.hasMore);
      })
      .finally(() => {
        if (myReq === reqIdRef.current) loadingRef.current = false;
      });
  }, [signedIn, selectedFilter, nearestFirst, userGeo]);

  const loadMore = useCallback(() => {
    if (
      !signedIn ||
      loadingRef.current ||
      !feedHasMore ||
      selectedFilter === "events"
    )
      return;
    const sort: FeedSort = nearestFirst ? "nearest" : "taste";
    loadingRef.current = true;
    const myReq = reqIdRef.current;
    loadFeedPage({
      filter: selectedFilter as FeedFilter,
      offset: loaded.length,
      limit: FEED_PAGE_SIZE,
      sort,
      lat: userGeo?.lat ?? null,
      lng: userGeo?.lng ?? null,
    })
      .then((res) => {
        if (myReq !== reqIdRef.current) return;
        setLoaded((prev) => [...prev, ...res.venues]);
        setFeedHasMore(res.hasMore);
      })
      .finally(() => {
        loadingRef.current = false;
      });
  }, [
    signedIn,
    feedHasMore,
    selectedFilter,
    nearestFirst,
    userGeo,
    loaded.length,
  ]);

  const ioRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useCallback(
    (node: HTMLDivElement | null) => {
      ioRef.current?.disconnect();
      if (!node) return;
      ioRef.current = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting) loadMore();
        },
        // Big runway: start fetching the next page ~3-4 screens before the
        // tail is reached, and since the observer re-arms after each page it
        // keeps that buffer full — so real scrolling lands on loaded cards, not
        // the skeleton (which stays a fallback for an extreme flick only).
        { rootMargin: "3000px" },
      );
      ioRef.current.observe(node);
    },
    [loadMore],
  );

  // The list actually rendered. Signed-in: the server-paginated `loaded` venues
  // (plus events for the music / events views). Anon: the metered preview.
  const displayItems: FeedItem[] = useMemo(() => {
    if (!signedIn) return items;
    if (selectedFilter === "events") {
      return allEvents.map<FeedItem>((e) => ({ kind: "event", data: e }));
    }
    const venueItems = loaded.map<FeedItem>((v) => ({
      kind: "venue",
      data: v,
    }));
    if (selectedFilter === "music") {
      return [
        ...venueItems,
        ...allEvents
          .filter((e) => e.category === MUSIC_EVENT_CATEGORY)
          .map<FeedItem>((e) => ({ kind: "event", data: e })),
      ];
    }
    return venueItems;
  }, [signedIn, items, loaded, selectedFilter, allEvents]);

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
          <span>{totalVenues} independent venues</span>
          <span className="text-border">/</span>
          <span>cross-checked in 2+ sources</span>
          <span className="text-border">/</span>
          <span>no chains</span>
        </div>
      </section>

      {/* Category chips filter the feed for everyone. For anon each category
          shows its own first 4 (from the per-category preview) + the sign-up
          wall, exactly like For You. */}
      <FilterChipRow selected={selectedFilter} onSelect={setSelectedFilter} />

      {/* "Near you" sort + taste status line. */}
      <div className="px-5 lg:px-6 pt-1.5 flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={signedIn ? toggleNearest : () => setWallFor("near")}
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

      {/* One-time location nudge for signed-in users (slim inline card, not a
          modal). "Turn on" reuses the same geolocation flow as the chip. */}
      {showLocPrompt && geoStatus !== "denied" && (
        <div className="px-5 lg:px-6 pt-3">
          <div className="flex items-center gap-3 rounded-2xl bg-card border border-border p-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <MapPin size={18} className="text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-extrabold text-heading">
                See what&apos;s good near you
              </div>
              <div className="text-[11px] text-muted-fg">
                Turn on location to sort by walking distance.
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                markLocPrompted();
                toggleNearest();
              }}
              className="h-8 px-3 rounded-full text-[11px] font-extrabold uppercase tracking-wider bg-primary text-primary-fg shrink-0"
            >
              Turn on
            </button>
            <button
              type="button"
              onClick={markLocPrompted}
              aria-label="Dismiss"
              className="text-muted-fg shrink-0"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      {displayItems.length === 0 ? (
        <div className="px-5 pt-10 text-center text-sm text-muted-fg">
          Nothing here yet. Check back soon.
        </div>
      ) : (
        <>
          <div className="px-5 lg:px-6 pt-5 grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-4 gap-4 lg:gap-5">
            {(signedIn
              ? displayItems
              : displayItems.slice(0, PREVIEW_COUNT)
            ).map((item, index) =>
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
          {signedIn && feedHasMore && (
            // Sentinel + skeletons. The observer (rootMargin ~2 screens)
            // prefetches the next page well before this is reached; the
            // skeletons keep the feed from ever ending abruptly if a fast
            // scroll outruns the fetch.
            <div
              ref={loadMoreRef}
              className="px-5 lg:px-6 pt-4 grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-4 gap-4 lg:gap-5"
            >
              {[0, 1].map((i) => (
                <div
                  key={i}
                  aria-hidden
                  className="aspect-[4/3] rounded-2xl bg-muted animate-pulse"
                />
              ))}
            </div>
          )}
          {!signedIn && <SignupWall returnTo="/explore" />}
        </>
      )}

      {searchOpen && (
        <SearchOverlay
          venues={[]}
          events={[]}
          searchAction={searchCatalog}
          onClose={() => setSearchOpen(false)}
        />
      )}

      {/* Anon soft wall: a chip / search / Near-you tap blurs the preview and
          puts sign-in on top, with a "Keep browsing" back out. */}
      {!signedIn && wallFor && (
        <AuthWall
          signedIn={false}
          mainShell
          title={WALL_TITLES[wallFor]}
          onBack={() => setWallFor(null)}
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
            className={
              "flex flex-col items-center gap-1 py-2 rounded-xl transition-colors " +
              (isSelected ? "bg-accent/10" : "")
            }
          >
            <c.Icon className={iconClass} strokeWidth={isSelected ? 2.4 : 2} />
            <span className={labelClass}>{c.label}</span>
          </button>
        );
      })}
    </div>
  );
}
