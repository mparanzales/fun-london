"use client";

import { useMemo, useState } from "react";
import {
  Sparkles,
  Music,
  UtensilsCrossed,
  Palette,
  Laugh,
  Disc3,
  Store,
  Search,
  Moon,
  type LucideIcon,
} from "lucide-react";
import { EventCard } from "@/components/event-card";
import { SearchOverlay } from "@/components/search-overlay";
import { searchEvents } from "@/lib/search-action";
import { SignupWall } from "@/components/signup-wall";
import { AuthWall } from "@/components/auth-wall";
import type { Event, EventCategory } from "@/lib/types";

// How many events a signed-out visitor sees before the sign-up wall (mirrors
// the Explore feed's metered preview). Exported so the Server Component slices
// the anonymous preview to the SAME count in the DB.
export const PREVIEW_COUNT = 4;

// ── Filter shapes ───────────────────────────────────────────────────────

type QuickFilter = "all" | "today" | "this-week" | "this-month" | "custom";

const QUICK_FILTERS: { id: QuickFilter; label: string }[] = [
  // Labels are intentionally short so all 5 chips fit on a single row
  // at mobile widths without horizontal scroll.
  { id: "all", label: "All" },
  { id: "today", label: "Today" },
  { id: "this-week", label: "Week" },
  { id: "this-month", label: "Month" },
  { id: "custom", label: "Custom" },
];

// "popup" is a pseudo-category (it filters to temporary pop-up listings rather
// than an EventCategory), so it lives in this row next to the real categories.
type CategoryFilter = "all" | EventCategory | "popup";

// Anon-only: which chrome interaction a soft AuthWall is gating. The CATEGORY
// chips are NOT here — for anon they filter to a 4-card preview + the wall, just
// like the "All" view. Search is open to anon (server-side, like Explore); only
// the date pills raise the blur wall.
type EventsWallTarget = "date";
function eventsWallTitle(): string {
  return "Sign up to filter by date";
}

// Every category chip we COULD show, in display order. Which ones actually
// render is decided per-load from the events present (see categoryChips) — a
// chip for a category with zero events is a dead filter and makes the feed
// look like it's hiding content, so we only show categories we can fill.
const ALL_CATEGORY_CHIPS: {
  id: EventCategory;
  label: string;
  Icon: LucideIcon;
}[] = [
  { id: "Music", label: "Music", Icon: Music },
  { id: "Food", label: "Food", Icon: UtensilsCrossed },
  { id: "Art", label: "Art", Icon: Palette },
  { id: "Comedy", label: "Comedy", Icon: Laugh },
  { id: "Club", label: "Club", Icon: Disc3 },
];

// ── Date helpers ────────────────────────────────────────────────────────

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfToday(): Date {
  const d = startOfToday();
  d.setDate(d.getDate() + 1);
  d.setMilliseconds(d.getMilliseconds() - 1);
  return d;
}

function endOfThisWeek(): Date {
  // Rolling 7 days from now so "this week" stays usable any day of the
  // week, not just early in it.
  const d = endOfToday();
  d.setDate(d.getDate() + 6);
  return d;
}

function endOfThisMonth(): Date {
  const d = startOfToday();
  d.setMonth(d.getMonth() + 1, 0); // last day of current month
  d.setHours(23, 59, 59, 999);
  return d;
}

function parseDateInput(value: string): Date | null {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00`);
  return isNaN(d.getTime()) ? null : d;
}

// ── Component ───────────────────────────────────────────────────────────

export function EventsFeed({
  events,
  todayLabel,
  signedIn,
}: {
  events: Event[];
  todayLabel: string;
  signedIn: boolean;
}) {
  const [quick, setQuick] = useState<QuickFilter>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [searchOpen, setSearchOpen] = useState(false);
  // Anon: a search / date / category interaction raises a soft blur wall
  // (sign-in on top) over the preview — never a redirect. null = no wall.
  const [wallFor, setWallFor] = useState<EventsWallTarget | null>(null);

  const filtered = useMemo(() => {
    const now = new Date();
    let lo: Date | null = null;
    let hi: Date | null = null;

    switch (quick) {
      case "today":
        lo = startOfToday();
        hi = endOfToday();
        break;
      case "this-week":
        lo = now;
        hi = endOfThisWeek();
        break;
      case "this-month":
        lo = now;
        hi = endOfThisMonth();
        break;
      case "custom":
        lo = parseDateInput(fromDate);
        hi = parseDateInput(toDate);
        if (hi) hi.setHours(23, 59, 59, 999);
        break;
      case "all":
      default:
        lo = now; // hide events already past
        hi = null;
    }

    const nowMs = now.getTime();
    return events
      .filter((e) => {
        // A pop-up runs over a range, so test whether its run OVERLAPS the
        // window, not just its start. Normal events have no endsAt, so
        // start and end collapse to the same instant (original behaviour).
        const startMs = new Date(e.startsAt).getTime();
        const endMs = e.endsAt ? new Date(e.endsAt).getTime() : startMs;
        if (lo && endMs < lo.getTime()) return false; // already finished
        if (hi && startMs > hi.getTime()) return false; // starts after window
        if (category === "popup") {
          if (!e.isPopup) return false;
        } else if (category !== "all" && e.category !== category) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        // A pop-up already running (start in the past) sorts as if it were
        // "now" so it sits with today's items rather than weeks above them.
        const key = (e: Event) => {
          const s = new Date(e.startsAt).getTime();
          return e.isPopup ? Math.max(s, nowMs) : s;
        };
        return key(a) - key(b);
      });
  }, [events, quick, fromDate, toDate, category]);

  // Data-driven category chips: "All", then only the categories actually
  // present in the feed (in display order), then "Pop-ups" if any exist. This
  // hides empty filters (e.g. Food until Eventbrite is wired) and surfaces new
  // ones (e.g. Club) automatically as the ingest categorises real events.
  const categoryChips = useMemo(() => {
    const present = new Set(events.map((e) => e.category));
    const chips: { id: CategoryFilter; label: string; Icon: LucideIcon }[] = [
      { id: "all", label: "All", Icon: Sparkles },
      ...ALL_CATEGORY_CHIPS.filter((c) => present.has(c.id)),
    ];
    if (events.some((e) => e.isPopup)) {
      chips.push({ id: "popup", label: "Pop-ups", Icon: Store });
    }
    return chips;
  }, [events]);

  return (
    <div className="pb-6">
      <header className="px-5 pt-8 pb-3 flex justify-between items-end">
        <div>
          <div className="text-sm italic font-medium text-muted-fg lowercase mb-1.5">
            {todayLabel}
          </div>
          <h1 className="text-[32px] font-bold fl-grad-text lowercase tracking-tight m-0 leading-none">
            what&apos;s on
          </h1>
        </div>
        <button
          type="button"
          aria-label="Search"
          onClick={() => setSearchOpen(true)}
          className="p-2 -mr-2 text-fg"
        >
          <Search className="w-6 h-6" strokeWidth={2} />
        </button>
      </header>

      {/* Category row — icon on top, label below, no per-chip background,
          colour shift on selection (mirrors /explore). Sits directly under the
          header, Explore-style; the date rail follows below it. */}
      {categoryChips.length > 1 && (
        <div className="px-5 pt-1 pb-3 flex gap-1 overflow-x-auto no-scrollbar">
          {categoryChips.map((c) => {
            const on = category === c.id;
            const iconClass =
              "w-6 h-6 transition-colors duration-200 " +
              (on ? "text-accent" : "text-muted-fg");
            const labelClass =
              "text-xs transition-colors duration-200 " +
              (on ? "text-accent font-medium" : "text-muted-fg font-normal");
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategory(c.id)}
                aria-pressed={on}
                className={
                  "flex flex-col items-center gap-1 py-2 rounded-xl transition-colors shrink-0 w-14 " +
                  (on ? "bg-accent/10" : "")
                }
              >
                <c.Icon className={iconClass} strokeWidth={on ? 2.4 : 2} />
                <span className={labelClass}>{c.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Quick date filters — small pills in the same style as Explore's
          "Near you" control: bg-muted when off, solid primary when active. */}
      <div className="px-5 pb-2.5 grid grid-cols-5 gap-1.5">
        {QUICK_FILTERS.map((f) => {
          const on = quick === f.id;
          return (
            <button
              key={f.id}
              onClick={
                signedIn
                  ? () => setQuick(f.id)
                  : f.id === "all"
                    ? () => setQuick("all")
                    : () => setWallFor("date")
              }
              className={
                "flex items-center justify-center w-full h-7 rounded-full text-[11px] font-bold transition " +
                (on ? "bg-primary text-primary-fg" : "bg-muted text-muted-fg")
              }
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* Custom date range picker — only shown when "Custom" is selected */}
      {quick === "custom" && (
        <div className="px-5 pb-3 flex items-center gap-2">
          <label className="flex-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-fg mb-1">
              From
            </div>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full h-10 rounded-xl bg-card border border-border px-3 text-fg text-[13px]"
            />
          </label>
          <label className="flex-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-fg mb-1">
              To
            </div>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full h-10 rounded-xl bg-card border border-border px-3 text-fg text-[13px]"
            />
          </label>
        </div>
      )}

      {/* Event list — metered preview for signed-out visitors (like Explore). */}
      <div className="px-5 grid grid-cols-1 lg:grid-cols-2 gap-4">
        {(signedIn ? filtered : filtered.slice(0, PREVIEW_COUNT)).map((e) => (
          <EventCard key={e.id} event={e} />
        ))}
        {filtered.length === 0 && (
          <div className="rounded-2xl bg-card border border-border p-5 text-center">
            <Moon
              className="w-8 h-8 text-muted-fg mb-1"
              strokeWidth={1.75}
              aria-hidden
            />
            <p className="text-sm text-muted-fg leading-relaxed">
              No events match that filter yet. Tier 3 ingests every 4 hours,
              more sources coming soon.
            </p>
          </div>
        )}
      </div>
      {!signedIn && filtered.length > 0 && <SignupWall returnTo="/events" />}

      {searchOpen && (
        <SearchOverlay
          venues={[]}
          events={signedIn ? events : []}
          searchAction={signedIn ? undefined : searchEvents}
          onClose={() => setSearchOpen(false)}
        />
      )}

      {/* Anon soft wall: search / date / category tap blurs the preview and
          puts sign-in on top, with a "Keep browsing" back out. */}
      {!signedIn && wallFor && (
        <AuthWall
          signedIn={false}
          mainShell
          title={eventsWallTitle()}
          onBack={() => setWallFor(null)}
        />
      )}
    </div>
  );
}
