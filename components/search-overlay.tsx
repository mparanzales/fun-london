"use client";

// Full-screen search overlay for /explore. Pure client-side filtering —
// the Explore page already holds the entire catalog (venues + events) in
// memory, so search is instant with no extra round-trip. Matches by name,
// area, type, vibe tags (venues) and name, venue, area, category (events).
//
// Opened from the Explore masthead search button. A route change (tapping
// a result) unmounts this overlay automatically.

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Search, X } from "lucide-react";
import type { Venue, Event } from "@/lib/types";

type Result =
  | { kind: "venue"; data: Venue; score: number }
  | { kind: "event"; data: Event; score: number };

// 0 = name starts with query (best), 1 = name contains query,
// 2 = some other field contains query (weakest). Lower sorts first.
function scoreMatch(
  name: string,
  haystack: string[],
  q: string,
): number | null {
  const n = name.toLowerCase();
  if (n.startsWith(q)) return 0;
  if (n.includes(q)) return 1;
  if (haystack.some((h) => h.toLowerCase().includes(q))) return 2;
  return null;
}

export function SearchOverlay({
  venues,
  events,
  onClose,
}: {
  venues: Venue[];
  events: Event[];
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

  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const out: Result[] = [];

    for (const v of venues) {
      const score = scoreMatch(
        v.name,
        [v.neighbourhood, v.type, v.vibe, ...v.vibeTags, ...v.moodTags],
        q,
      );
      if (score !== null) out.push({ kind: "venue", data: v, score });
    }
    for (const e of events) {
      const score = scoreMatch(e.name, [e.venueName, e.area, e.category], q);
      if (score !== null) out.push({ kind: "event", data: e, score });
    }

    return out.sort((a, b) => a.score - b.score);
  }, [query, venues, events]);

  const q = query.trim();

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
          ) : results.length === 0 ? (
            <div className="pt-10 text-center">
              <div className="text-2xl mb-1">🔍</div>
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
              unoptimized={imgUrl.includes("googleapis.com")}
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
