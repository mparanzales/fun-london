"use client";

// Full-screen search overlay for /explore.
//
// Two modes:
//  • CLIENT (signed-in): the Explore page already holds the whole catalogue in
//    memory, so we filter it instantly with no round-trip.
//  • SERVER (signed-out): we don't ship the full catalogue to anonymous
//    visitors, so search calls a server action that returns only card-level
//    matches. Search works for everyone; the catalogue still never reaches the
//    anon client.
//
// Matching (apostrophe/accent-insensitive) is shared with the server via
// lib/search-match. Signed-in additionally matches in-memory vibe/mood tags;
// signed-out matches the card-level fields only.

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { isGooglePlacesUrl } from "@/lib/img";
import Link from "next/link";
import { Search, X } from "lucide-react";
import { track } from "@/lib/analytics";
import { recordSignal } from "@/lib/signals";
import { normalize, scoreMatch, compareHits } from "@/lib/search-match";
import type { SearchHit } from "@/lib/search-match";
import type { Venue, Event } from "@/lib/types";

type Result = SearchHit;

export function SearchOverlay({
  venues,
  events,
  searchAction,
  onClose,
}: {
  venues: Venue[];
  events: Event[];
  // When provided (signed-out), search runs server-side and returns a single
  // relevance-ranked list of card-level results. When omitted (signed-in),
  // search filters `venues`/`events` locally.
  searchAction?: (q: string) => Promise<SearchHit[]>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Autofocus the field and wire Escape-to-close.
  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // CLIENT MODE: normalise each item's name + haystack once, so each keystroke
  // is two cheap substring checks instead of re-normalising the catalogue.
  const venueIndex = useMemo(
    () =>
      venues.map((v) => ({
        v,
        name: normalize(v.name),
        hay: normalize(
          [v.neighbourhood, v.type, v.vibe, ...v.vibeTags, ...v.moodTags].join(
            " ",
          ),
        ),
      })),
    [venues],
  );
  const eventIndex = useMemo(
    () =>
      events.map((e) => ({
        e,
        name: normalize(e.name),
        hay: normalize([e.venueName, e.area, e.category].join(" ")),
      })),
    [events],
  );

  // SERVER MODE: debounce the query, call the action, hold its ranked rows.
  const [serverResults, setServerResults] = useState<Result[]>([]);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (!searchAction) return;
    const q = query.trim();
    if (q.length < 2) {
      setServerResults([]);
      setPending(false);
      return;
    }
    setPending(true);
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await searchAction(q);
        if (!cancelled) setServerResults(r);
      } catch {
        if (!cancelled) setServerResults([]);
      } finally {
        if (!cancelled) setPending(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, searchAction]);

  const results = useMemo<Result[]>(() => {
    const q = normalize(query);
    if (!q) return [];

    // Server already merged venues + events into one relevance-ranked list.
    if (searchAction) return serverResults;

    const out: Result[] = [];
    for (const { v, name, hay } of venueIndex) {
      const score = scoreMatch(name, hay, q);
      if (score !== null) out.push({ kind: "venue", data: v, score });
    }
    for (const { e, name, hay } of eventIndex) {
      const score = scoreMatch(name, hay, q);
      if (score !== null) out.push({ kind: "event", data: e, score });
    }
    // Same relevance interleave the server uses, so both modes rank alike.
    return out.sort(compareHits);
  }, [query, searchAction, serverResults, venueIndex, eventIndex]);

  // Track searches, debounced, so we log the intent once the user pauses typing
  // (not on every keystroke). Only meaningful queries (≥2 chars).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const t = setTimeout(() => {
      track("search_query", { q, results: results.length });
      // Kind C: send only the query LENGTH (never the raw text — no PII).
      recordSignal("search", {
        surface: "search_results",
        context: { query_len: q.length, results: results.length },
      });
    }, 700);
    return () => clearTimeout(t);
  }, [query, results.length]);

  const q = query.trim();
  const showEmpty = q.length > 0 && results.length === 0 && !pending;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search"
      className="fixed inset-0 z-50 bg-bg"
    >
      <div className="max-w-md mx-auto h-full flex flex-col">
        {/* Search bar */}
        <div className="px-4 pt-4 pb-3 flex items-center gap-2 border-b border-border">
          <div className="flex-1 flex items-center gap-2 h-11 rounded-full bg-muted px-4">
            <Search className="w-5 h-5 text-muted-fg" strokeWidth={2} />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search venues, events, areas…"
              className="flex-1 bg-transparent outline-none text-fg text-[15px] placeholder:text-muted-fg"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear"
                className="text-muted-fg"
              >
                <X className="w-4 h-4" strokeWidth={2} />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-sm font-semibold text-primary px-1"
          >
            Cancel
          </button>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {!q ? (
            <p className="pt-8 text-center text-sm text-muted-fg">
              Find a place or an event by name, area, or vibe.
            </p>
          ) : showEmpty ? (
            <div className="pt-10 text-center">
              <Search
                className="w-8 h-8 text-muted-fg mb-1"
                strokeWidth={1.75}
                aria-hidden
              />
              <p className="text-sm text-muted-fg">
                Nothing matches “{q}”. Try a venue name, area, or category.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col">
              {results.map((r) =>
                r.kind === "venue" ? (
                  <ResultRow
                    key={`v-${r.data.id}`}
                    href={`/venue/${r.data.slug}`}
                    imgUrl={r.data.imgUrl}
                    title={r.data.name}
                    subtitle={`${r.data.type} · ${r.data.neighbourhood} · ${r.data.price}`}
                    onNavigate={onClose}
                  />
                ) : (
                  <ResultRow
                    key={`e-${r.data.id}`}
                    href={`/event/${r.data.id}`}
                    imgUrl={r.data.imgUrl}
                    title={r.data.name}
                    subtitle={`${r.data.category} · ${r.data.venueName} · ${r.data.area}`}
                    onNavigate={onClose}
                  />
                ),
              )}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultRow({
  href,
  imgUrl,
  title,
  subtitle,
  onNavigate,
}: {
  href: string;
  imgUrl: string;
  title: string;
  subtitle: string;
  onNavigate: () => void;
}) {
  return (
    <li>
      <Link
        href={href}
        onClick={onNavigate}
        prefetch={false}
        className="flex items-center gap-3 py-2.5 border-b border-border last:border-0"
      >
        <div className="relative w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 bg-muted">
          {imgUrl && (
            <Image
              src={imgUrl}
              alt=""
              fill
              sizes="48px"
              // Google Places photo URLs 302-redirect with an API key;
              // bypass the optimizer for those (same as venue detail).
              unoptimized={isGooglePlacesUrl(imgUrl)}
              className="object-cover"
            />
          )}
        </div>
        <div className="min-w-0">
          <div className="text-[14px] font-bold text-heading leading-tight truncate">
            {title}
          </div>
          <div className="text-[11px] text-muted-fg mt-0.5 truncate">
            {subtitle}
          </div>
        </div>
      </Link>
    </li>
  );
}
