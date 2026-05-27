"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronDown, Heart, Star } from "lucide-react";
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
  const [whyOpen, setWhyOpen] = useState(false);

  const isReservable = RESERVABLE_TYPES.includes(venue.type);

  // Top-priority booking link if we have one. The agent thesis V1:
  // Reserve button deep-links to the venue's best-known booking URL
  // (lowest `priority` number wins). If absent, falls through to the
  // legacy in-app confirmation stub.
  const topBookingLink =
    venue.bookingLinks && venue.bookingLinks.length > 0
      ? [...venue.bookingLinks].sort((a, b) => a.priority - b.priority)[0]
      : null;

  const hasRealTalk = !!venue.criticalFlags && venue.criticalFlags.length > 0;
  const hasWhy =
    (!!venue.editorialSources && venue.editorialSources.length > 0) ||
    (!!venue.creatorCoverage && venue.creatorCoverage.length > 0);

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

        {/* ── Real Talk ──────────────────────────────────────────────
            Critical flags surfaced boldly — the brand's honesty rule.
            Each flag is a left-accented card with bold label + body. */}
        {hasRealTalk && (
          <div className="mt-7">
            <div className="flex items-baseline gap-2 mb-3">
              <span className="text-[11px] font-extrabold tracking-[0.12em] uppercase text-accent">
                Real Talk
              </span>
              <span className="text-[11px] text-muted-fg">
                what to actually expect
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {venue.criticalFlags!.map((flag, i) => (
                <div
                  key={i}
                  className="relative rounded-2xl bg-muted/40 border border-fg/10 px-4 py-3 pl-5"
                >
                  <span
                    aria-hidden
                    className="absolute left-0 top-2 bottom-2 w-1 rounded-r bg-accent"
                  />
                  <div className="text-sm font-extrabold text-fg leading-tight">
                    {flag.label}
                  </div>
                  <div className="text-[13px] text-muted-fg leading-snug mt-0.5">
                    {flag.body}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Why this is here ───────────────────────────────────────
            Editorial sources + creator coverage as a collapsible
            expandable. Transparency promise — users can fact-check the
            catalog independent of our own editorial. */}
        {hasWhy && (
          <div className="mt-7">
            <button
              type="button"
              onClick={() => setWhyOpen((v) => !v)}
              aria-expanded={whyOpen}
              className="w-full flex items-center justify-between px-1 py-2 text-left"
            >
              <span className="text-[11px] font-extrabold tracking-[0.12em] uppercase text-primary">
                Why this is here
              </span>
              <ChevronDown
                className={
                  "w-4 h-4 text-muted-fg transition-transform " +
                  (whyOpen ? "rotate-180" : "rotate-0")
                }
                strokeWidth={2}
              />
            </button>
            {whyOpen && (
              <div className="mt-2 rounded-2xl bg-muted/30 border border-fg/10 px-4 py-3">
                {venue.editorialSources &&
                  venue.editorialSources.length > 0 && (
                    <div>
                      <div className="text-[10px] font-extrabold tracking-[0.12em] uppercase text-muted-fg mb-1.5">
                        Editorial coverage
                      </div>
                      <ul className="space-y-1">
                        {venue.editorialSources.map((src, i) => (
                          <li key={i} className="text-[13px] leading-snug">
                            <a
                              href={src.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-fg underline decoration-fg/30 underline-offset-2 hover:decoration-fg"
                            >
                              {src.publication}
                            </a>
                            {src.title && (
                              <span className="text-muted-fg">
                                {" "}
                                — {src.title}
                              </span>
                            )}
                            {src.date && (
                              <span className="text-muted-fg/80 italic">
                                {" · "}
                                {new Date(src.date).toLocaleDateString(
                                  "en-GB",
                                  { month: "short", year: "numeric" },
                                )}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                {venue.creatorCoverage && venue.creatorCoverage.length > 0 && (
                  <div
                    className={
                      venue.editorialSources &&
                      venue.editorialSources.length > 0
                        ? "mt-3 pt-3 border-t border-fg/10"
                        : ""
                    }
                  >
                    <div className="text-[10px] font-extrabold tracking-[0.12em] uppercase text-muted-fg mb-1.5">
                      Creators covering this
                    </div>
                    <ul className="space-y-1">
                      {venue.creatorCoverage.map((c, i) => (
                        <li key={i} className="text-[13px] leading-snug">
                          <a
                            href={c.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-fg underline decoration-fg/30 underline-offset-2 hover:decoration-fg"
                          >
                            {c.creator}
                          </a>
                          <span className="text-muted-fg/80">
                            {" "}
                            · {c.platform}
                          </span>
                          {c.verdict === "critical" && (
                            <span className="ml-1.5 inline-block px-1.5 py-0.5 text-[9px] font-extrabold uppercase rounded bg-accent/15 text-accent">
                              Critical
                            </span>
                          )}
                          {c.verdict === "mixed" && (
                            <span className="ml-1.5 inline-block px-1.5 py-0.5 text-[9px] font-extrabold uppercase rounded bg-fg/10 text-fg">
                              Mixed
                            </span>
                          )}
                          {c.note && (
                            <div className="text-[12px] text-muted-fg italic mt-0.5">
                              “{c.note}”
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
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
        {isReservable && topBookingLink ? (
          // Agent thesis V1: deep-link to the venue's top-priority
          // booking platform. Opens in a new tab so the user keeps the
          // Fun London tab open and can come back.
          <a
            href={topBookingLink.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 bg-primary text-white rounded-full px-5 py-3 font-semibold text-sm text-center no-underline"
          >
            Reserve →{" "}
            {topBookingLink.platform === "website"
              ? "their site"
              : topBookingLink.platform}
          </a>
        ) : isReservable ? (
          // Legacy fallback for demo venues without bookingLinks.
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
