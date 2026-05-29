"use client";

import { useMemo, useState } from "react";
import { EventCard } from "@/components/event-card";
import type { Event, EventCategory } from "@/lib/types";

// ── Filter shapes ───────────────────────────────────────────────────────

type QuickFilter = "all" | "today" | "this-week" | "this-month" | "custom";

const QUICK_FILTERS: { id: QuickFilter; label: string }[] = [
  { id: "all", label: "All upcoming" },
  { id: "today", label: "Today" },
  { id: "this-week", label: "This week" },
  { id: "this-month", label: "This month" },
  { id: "custom", label: "Pick dates" },
];

type CategoryFilter = "all" | EventCategory;
const CATEGORY_FILTERS: { id: CategoryFilter; label: string; emoji: string }[] =
  [
    { id: "all", label: "All", emoji: "" },
    { id: "Music", label: "Music", emoji: "🎵" },
    { id: "Food", label: "Food", emoji: "🍽" },
    { id: "Art", label: "Art", emoji: "🎨" },
    { id: "Comedy", label: "Comedy", emoji: "😂" },
  ];

// ── Date helpers (Europe/London logical "today") ────────────────────────

function startOfToday(): Date {
  // Use local clock; for our use case Europe/London is the target
  // audience and the server-rendered todayLabel uses the same tz.
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
  // "This week" = the next 7 days from now (rolling), so even on a
  // Monday afternoon "this week" still includes the following Sunday.
  const d = endOfToday();
  d.setDate(d.getDate() + 6);
  return d;
}

function endOfThisMonth(): Date {
  const d = startOfToday();
  d.setMonth(d.getMonth() + 1, 0); // last day of this month
  d.setHours(23, 59, 59, 999);
  return d;
}

function parseDateInput(value: string): Date | null {
  if (!value) return null;
  // <input type="date"> returns "YYYY-MM-DD". Pin to local midnight.
  const d = new Date(`${value}T00:00:00`);
  return isNaN(d.getTime()) ? null : d;
}

// ── Component ───────────────────────────────────────────────────────────

export function EventsFeed({
  events,
  todayLabel,
}: {
  events: Event[];
  todayLabel: string;
}) {
  const [quick, setQuick] = useState<QuickFilter>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");

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

    return events
      .filter((e) => {
        const start = new Date(e.startsAt);
        if (lo && start < lo) return false;
        if (hi && start > hi) return false;
        if (category !== "all" && e.category !== category) return false;
        return true;
      })
      .sort(
        (a, b) =>
          new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
      );
  }, [events, quick, fromDate, toDate, category]);

  return (
    <div className="pt-4 pb-6">
      <header className="px-5 pb-3">
        <h1 className="text-[28px] font-extrabold tracking-tight text-primary">
          What&apos;s On
        </h1>
        <div className="text-xs text-muted-fg mt-0.5">{todayLabel}</div>
      </header>

      {/* Quick date pills */}
      <div className="px-5 pb-2.5 flex gap-1.5 overflow-x-auto no-scrollbar">
        {QUICK_FILTERS.map((f) => {
          const on = quick === f.id;
          return (
            <button
              key={f.id}
              onClick={() => setQuick(f.id)}
              className={
                "px-3.5 py-2.5 rounded-full text-[11px] font-extrabold uppercase tracking-[0.06em] whitespace-nowrap transition " +
                (on ? "bg-primary text-primary-fg" : "bg-muted text-muted-fg")
              }
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* Custom date range picker — only shown when "Pick dates" is selected */}
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

      {/* Category chips */}
      <div className="px-5 pb-3.5 flex gap-1.5 overflow-x-auto no-scrollbar">
        {CATEGORY_FILTERS.map((c) => {
          const on = category === c.id;
          return (
            <button
              key={c.id}
              onClick={() => setCategory(c.id)}
              className={
                "px-3.5 py-3 rounded-full text-[11px] font-bold whitespace-nowrap border transition " +
                (on
                  ? "bg-accent/10 text-accent border-accent"
                  : "bg-card text-fg border-border")
              }
            >
              {c.emoji ? `${c.emoji} ${c.label}` : c.label}
            </button>
          );
        })}
      </div>

      {/* Event list */}
      <div className="px-5 flex flex-col gap-4">
        {filtered.map((e) => (
          <EventCard key={e.id} event={e} />
        ))}
        {filtered.length === 0 && (
          <div className="rounded-2xl bg-card border border-border p-5 text-center">
            <div className="text-2xl mb-1">🌙</div>
            <p className="text-sm text-muted-fg leading-relaxed">
              No events match that filter yet. Tier 3 ingests every 4 hours from
              Ticketmaster — more sources coming soon.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
