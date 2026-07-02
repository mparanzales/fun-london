"use client";

// What's On filter sheet: refine events by area, plus a sort toggle. Holds a
// local DRAFT and only reports back on "Apply". Only signed-in visitors reach
// it (the Filters pill gates anon to the sign-in wall, like the date pills), so
// there's no in-sheet locking. Mirrors the Explore Filters sheet's chrome.
//
// Price is deliberately absent: event price is freeform text (often just
// "Tickets via <platform>"), so a tier filter would be fabricated. Open-now is
// venue-only (events have fixed start times).

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Clock, ArrowDownAZ } from "lucide-react";
import { REGIONS, type Region } from "@/lib/regions";

export type EventSort = "soonest" | "az";

export type EventFilters = {
  regions: Region[];
  sort: EventSort;
};

export const EMPTY_EVENT_FILTERS: EventFilters = {
  regions: [],
  sort: "soonest",
};

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];
}

export function eventFilterCount(f: EventFilters): number {
  return (f.regions.length > 0 ? 1 : 0) + (f.sort !== "soonest" ? 1 : 0);
}

export function EventFilterSheet({
  value,
  onApply,
  onClose,
}: {
  value: EventFilters;
  onApply: (next: EventFilters) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<EventFilters>(value);

  // Portal to <body> (like the other sheets) so the fixed overlay escapes the
  // `.fl-page` transform wrapper, which otherwise traps `position: fixed`.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const chip = (on: boolean) =>
    "inline-flex items-center justify-center gap-1 h-10 px-4 rounded-full text-[13px] font-bold transition border " +
    (on
      ? "bg-primary text-primary-fg border-primary"
      : "bg-card text-fg border-border");

  const sortOptions: { id: EventSort; label: string; Icon: typeof Clock }[] = [
    { id: "soonest", label: "Soonest", Icon: Clock },
    { id: "az", label: "A-Z", Icon: ArrowDownAZ },
  ];

  const count = eventFilterCount(draft);

  if (!mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Filter and sort events"
      className="fixed inset-0 z-50 flex items-end justify-center"
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className="relative w-full max-w-md bg-bg rounded-t-3xl border-t border-border p-5"
        style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="text-[11px] font-extrabold tracking-[0.12em] uppercase text-muted-fg">
            Filter & sort
          </div>
          <div className="flex items-center gap-3">
            {count > 0 && (
              <button
                type="button"
                onClick={() => setDraft(EMPTY_EVENT_FILTERS)}
                className="text-[12px] font-bold text-primary"
              >
                Clear all
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="text-muted-fg -mr-1 p-1"
            >
              <X className="w-5 h-5" strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* Area */}
        <div className="mb-5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted-fg mb-2">
            Area
          </div>
          <div className="flex flex-wrap gap-2">
            {REGIONS.map((r) => {
              const on = draft.regions.includes(r);
              return (
                <button
                  key={r}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setDraft((d) => ({ ...d, regions: toggle(d.regions, r) }))
                  }
                  className={chip(on)}
                >
                  {r}
                </button>
              );
            })}
          </div>
        </div>

        {/* Sort */}
        <div className="mb-6">
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted-fg mb-2">
            Sort by
          </div>
          <div className="flex gap-2">
            {sortOptions.map((o) => {
              const on = draft.sort === o.id;
              return (
                <button
                  key={o.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setDraft((d) => ({ ...d, sort: o.id }))}
                  className={chip(on) + " flex-1"}
                >
                  <o.Icon size={14} strokeWidth={2.2} />
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>

        <button
          type="button"
          onClick={() => onApply(draft)}
          className="w-full h-[52px] rounded-2xl bg-primary text-white font-extrabold text-[15px]"
        >
          {count > 0 ? `Show results · ${count} applied` : "Show results"}
        </button>
      </div>
    </div>,
    document.body,
  );
}
