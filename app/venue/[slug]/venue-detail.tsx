"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowLeft, Heart, Star } from "lucide-react";
import { useSaved } from "@/components/saved-context";
import type { Venue, VenueType } from "@/lib/types";

// Only these venue types accept a table reservation / ticket booking.
// Museums, markets, cafés, and outdoor spaces are walk-in by nature, so
// the Reserve CTA gets swapped for an informational element on those.
const RESERVABLE_TYPES: VenueType[] = [
  "Restaurant",
  "Bar",
  "Wine Bar",
  "Pub",
  "Listening Bar",
  "Live Music",
];

// Venue detail (Figma frame 3b) — full-screen immersive layout.
//
// Composition (top → bottom):
//   • Hero image (4:3) with floating Back + Heart buttons
//   • Info block: eyebrow, h1 name, rating row
//   • Long description
//   • Quick-fact pill row (next slot, walking, tables, vibes)
//   • Scrollable content area with bottom-padding so the sticky CTA
//     doesn't overlap content
//   • Sticky bottom bar: Save (outlined) + Reserve (filled)
//
// All colors use theme tokens so day and night themes both render the
// same hierarchy. Whites used only over the hero image (Back/Heart
// circles) — that surface is always a photo, not the page background.

export function VenueDetail({ venue }: { venue: Venue }) {
  const router = useRouter();
  const { isSaved, toggleSaved } = useSaved();
  const saved = isSaved(venue.slug);

  const isReservable = RESERVABLE_TYPES.includes(venue.type);

  // First pill: prefix "Tonight " only for reservable venues whose
  // nextSlotLabel is a time. Non-reservable venues seed labels like
  // "Open till 6 PM" or "Open Sun · noon" which read better unprefixed.
  // "Tables free" pill is hidden for non-reservable venues (a museum
  // showing "0 tables free" doesn't make sense) AND hidden when the
  // count is 0 (don't signal "fully booked" next to a working Reserve
  // button — confuses the user).
  const showTablesPill = isReservable && venue.tablesFree > 0;
  const pills = [
    isReservable ? `Tonight ${venue.nextSlotLabel}` : venue.nextSlotLabel,
    `${venue.walkingMins} min walk`,
    ...(showTablesPill ? [`${venue.tablesFree} tables free`] : []),
    venue.vibeTags.join(" · "),
  ];

  return (
    // Mobile-shell constraint matches the (main) route group (max-w-md).
    // Keeps the visual width consistent when navigating from /explore →
    // /venue/[slug] → /booking/.../confirmed instead of jumping to full
    // viewport on desktop.
    <div className="max-w-md mx-auto min-h-screen bg-bg pb-32">
      {/* ── Hero ───────────────────────────────────────────────────── */}
      <div className="relative w-full" style={{ aspectRatio: "4/3" }}>
        <Image
          src={venue.imgUrl}
          alt={venue.name}
          fill
          priority
          sizes="(max-width: 640px) 100vw, 640px"
          className="object-cover"
        />

        {/* Back button — overlays photo, top-left */}
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Back"
          className="absolute top-4 left-4 w-10 h-10 rounded-full bg-white/90 backdrop-blur-md shadow flex items-center justify-center"
        >
          <ArrowLeft className="w-5 h-5 text-fg" strokeWidth={2} />
        </button>

        {/* Heart button — overlays photo, top-right */}
        <button
          type="button"
          onClick={() => toggleSaved(venue.slug)}
          aria-label={saved ? "Unsave" : "Save"}
          className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/90 backdrop-blur-md shadow flex items-center justify-center"
        >
          <Heart
            className={
              "w-5 h-5 " +
              (saved ? "fill-primary text-primary" : "fill-none text-fg")
            }
            strokeWidth={1.75}
          />
        </button>
      </div>

      {/* ── Info block ────────────────────────────────────────────── */}
      <section className="px-5">
        <div className="text-[11px] font-extrabold tracking-[0.12em] uppercase text-muted-fg pt-5">
          {venue.neighbourhood.toUpperCase()} · {venue.price}
        </div>

        <h1 className="text-3xl font-extrabold text-fg leading-tight mt-1">
          {venue.name}
        </h1>

        <div className="flex items-center gap-1.5 mt-2 text-sm text-muted-fg">
          {/* Amber star — Tailwind's amber-500 is theme-stable (warm on both bgs).
              No brand --coral token defined in globals.css; flagged in report. */}
          <Star
            className="w-4 h-4 text-amber-500 fill-current"
            strokeWidth={0}
          />
          <span>{venue.rating}</span>
          <span aria-hidden>·</span>
          <span>{venue.reviewCount.toLocaleString()} reviews</span>
        </div>

        <p className="text-base leading-relaxed text-fg mt-5">
          {venue.longDescription}
        </p>

        {/* Quick facts pills */}
        <div className="flex flex-wrap gap-2 mt-5">
          {pills.map((label) => (
            <span
              key={label}
              className="border border-fg/15 rounded-full px-3 py-1.5 text-xs font-medium text-fg"
            >
              {label}
            </span>
          ))}
        </div>
      </section>

      {/* ── Sticky CTA bar ────────────────────────────────────────── */}
      <div
        // Centered at viewport center, constrained to max-w-md so it
        // matches the page's mobile shell on desktop.
        className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-bg border-t border-fg/10 px-5 py-4 flex gap-3"
        style={{
          paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
        }}
      >
        <button
          type="button"
          onClick={() => toggleSaved(venue.slug)}
          aria-label={saved ? "Unsave" : "Save"}
          className="flex-shrink-0 inline-flex items-center gap-2 px-5 py-3 border border-fg/15 rounded-full text-fg text-sm font-medium"
        >
          <Heart
            className={
              "w-4 h-4 " +
              (saved ? "fill-primary text-primary" : "fill-none text-fg")
            }
            strokeWidth={2}
          />
          Save
        </button>
        {isReservable ? (
          <button
            type="button"
            onClick={() => router.push(`/booking/${venue.slug}/confirmed`)}
            className="flex-1 bg-primary text-white rounded-full px-5 py-3 font-semibold text-sm"
          >
            Reserve · {venue.nextSlotLabel}
          </button>
        ) : (
          // Static info element — non-interactive, occupies the same
          // space as the Reserve button but signals walk-in.
          <div
            role="status"
            className="flex-1 flex items-center justify-center px-5 py-3 rounded-full bg-muted text-muted-fg text-sm font-medium"
          >
            No booking needed. Just walk in.
          </div>
        )}
      </div>
    </div>
  );
}
