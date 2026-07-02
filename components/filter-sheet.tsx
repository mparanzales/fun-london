"use client";

// Explore filter bottom-sheet: refine the feed by price, area, opening hours and
// sort. It holds a local DRAFT and only reports back on "Apply", so the feed
// doesn't churn on every tap. Price / area / top-rated work for everyone;
// "open now" and "nearest" read signed-in-only data, so for anon they raise the
// sign-in wall instead of toggling (onLockedFeature).

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Lock, MapPin, Star, Sparkles, Clock } from "lucide-react";
import { REGIONS, type Region } from "@/lib/regions";
import type { PriceTier } from "@/lib/types";

export type SortMode = "for-you" | "nearest" | "top-rated";

export type ExploreFilters = {
  price: PriceTier[];
  regions: Region[];
  openNow: boolean;
  sort: SortMode;
};

export const EMPTY_FILTERS: ExploreFilters = {
  price: [],
  regions: [],
  openNow: false,
  sort: "for-you",
};

// Only the three common tiers are offered (Free venues are rare and opt-out of
// the price filter by simply not matching any selected tier).
const PRICE_TIERS: PriceTier[] = ["£", "££", "£££"];

// Which lock the anon wall is gating when a signed-in-only control is tapped.
export type LockedFeature = "near" | "open";

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];
}

function activeCount(f: ExploreFilters): number {
  return (
    (f.price.length > 0 ? 1 : 0) +
    (f.regions.length > 0 ? 1 : 0) +
    (f.openNow ? 1 : 0) +
    (f.sort === "top-rated" ? 1 : 0)
  );
}

export function FilterSheet({
  value,
  signedIn,
  onApply,
  onClose,
  onLockedFeature,
}: {
  value: ExploreFilters;
  signedIn: boolean;
  onApply: (next: ExploreFilters) => void;
  onClose: () => void;
  onLockedFeature: (feature: LockedFeature) => void;
}) {
  const [draft, setDraft] = useState<ExploreFilters>(value);

  // Portal to <body> (like the other sheets) so the fixed overlay escapes the
  // `.fl-page` transform wrapper, which otherwise traps `position: fixed` and
  // drops the panel below the fold. `mounted` guards SSR where there's no body.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const chip = (on: boolean) =>
    "inline-flex items-center justify-center gap-1 h-10 px-4 rounded-full text-[13px] font-bold transition border " +
    (on
      ? "bg-primary text-primary-fg border-primary"
      : "bg-card text-fg border-border");

  const sortOptions: {
    id: SortMode;
    label: string;
    Icon: typeof Star;
    locked: boolean;
  }[] = [
    { id: "for-you", label: "For you", Icon: Sparkles, locked: false },
    { id: "top-rated", label: "Top rated", Icon: Star, locked: false },
    { id: "nearest", label: "Nearest", Icon: MapPin, locked: !signedIn },
  ];

  const count = activeCount(draft);

  if (!mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Filter and sort"
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
                onClick={() => setDraft(EMPTY_FILTERS)}
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

        {/* Price */}
        <div className="mb-5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted-fg mb-2">
            Price
          </div>
          <div className="flex gap-2">
            {PRICE_TIERS.map((p) => {
              const on = draft.price.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setDraft((d) => ({ ...d, price: toggle(d.price, p) }))
                  }
                  className={chip(on) + " flex-1"}
                >
                  {p}
                </button>
              );
            })}
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

        {/* Open now — signed-in only */}
        <div className="mb-5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted-fg mb-2">
            Opening hours
          </div>
          <button
            type="button"
            aria-pressed={draft.openNow}
            onClick={() =>
              signedIn
                ? setDraft((d) => ({ ...d, openNow: !d.openNow }))
                : onLockedFeature("open")
            }
            className={chip(draft.openNow && signedIn)}
          >
            <Clock size={14} strokeWidth={2.2} />
            Open now
            {!signedIn && (
              <Lock size={12} strokeWidth={2.4} className="ml-0.5 opacity-70" />
            )}
          </button>
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
                  onClick={() => {
                    if (o.locked) {
                      onLockedFeature("near");
                      return;
                    }
                    setDraft((d) => ({ ...d, sort: o.id }));
                  }}
                  className={chip(on) + " flex-1"}
                >
                  <o.Icon size={14} strokeWidth={2.2} />
                  {o.label}
                  {o.locked && (
                    <Lock
                      size={12}
                      strokeWidth={2.4}
                      className="ml-0.5 opacity-70"
                    />
                  )}
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
