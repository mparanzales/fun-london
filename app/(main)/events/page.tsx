"use client";

import { useState } from "react";
import { EventCard } from "@/components/event-card";
import { getEvents } from "@/lib/mock-data";
import type { DateLabel, EventCategory } from "@/lib/types";

const DATE_FILTERS: DateLabel[] = ["Tonight", "This Weekend", "This Week"];

type CategoryFilter = "all" | EventCategory;
const CATEGORY_FILTERS: { id: CategoryFilter; label: string; emoji: string }[] =
  [
    { id: "all", label: "All", emoji: "" },
    { id: "Music", label: "Music", emoji: "🎵" },
    { id: "Food", label: "Food", emoji: "🍽" },
    { id: "Art", label: "Art", emoji: "🎨" },
    { id: "Comedy", label: "Comedy", emoji: "😂" },
  ];

export default function EventsPage() {
  const [dateFilter, setDateFilter] = useState<DateLabel>("Tonight");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");

  const events = getEvents();
  const filtered = events
    .filter((e) => e.dateLabel === dateFilter)
    .filter((e) => categoryFilter === "all" || e.category === categoryFilter);

  return (
    <div className="pt-4 pb-6">
      <header className="px-5 pb-3">
        <h1 className="text-[28px] font-extrabold tracking-tight text-primary">
          What&apos;s On
        </h1>
        <div className="text-xs text-muted-fg mt-0.5">Tuesday 12 May</div>
      </header>

      <div className="px-5 pb-2.5 flex gap-1.5">
        {DATE_FILTERS.map((f) => {
          const on = dateFilter === f;
          return (
            <button
              key={f}
              onClick={() => setDateFilter(f)}
              className={
                "px-4 py-3 rounded-full text-[11px] font-extrabold uppercase tracking-[0.06em] transition " +
                (on ? "bg-primary text-primary-fg" : "bg-muted text-muted-fg")
              }
            >
              {f}
            </button>
          );
        })}
      </div>

      <div className="px-5 pb-3.5 flex gap-1.5 overflow-x-auto no-scrollbar">
        {CATEGORY_FILTERS.map((c) => {
          const on = categoryFilter === c.id;
          return (
            <button
              key={c.id}
              onClick={() => setCategoryFilter(c.id)}
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

      <div className="px-5 flex flex-col gap-3">
        {filtered.map((e) => (
          <EventCard key={e.id} event={e} />
        ))}
        {filtered.length === 0 && (
          <div className="p-5 text-center text-sm text-muted-fg">
            Nothing matches that filter. Try another.
          </div>
        )}
      </div>
    </div>
  );
}
