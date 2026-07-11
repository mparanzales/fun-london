"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
  Globe,
  Heart,
  Lock,
  Phone,
  Plus,
  Share2,
  Star,
} from "lucide-react";
import { useSaved } from "@/components/saved-context";
import { MapTilePlaceholder } from "@/components/map-tile-placeholder";
import { ReserveSheet } from "@/components/reserve-sheet";
import { platformLabel, type ReserveTarget } from "@/lib/booking-link";
import { shareOrCopy } from "@/lib/share";
import { track } from "@/lib/analytics";
import { recordSignal } from "@/lib/signals";
import {
  getOpenState,
  londonWallClock,
  type OpenState,
} from "@/lib/opening-hours";
import type { Venue, VenueType, OpeningPeriod } from "@/lib/types";

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

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

// Dash-free time formatting for the hours strip ("6pm", "1:30am", "midnight").
function fmtClock(hour: number, minute: number): string {
  if (hour === 0 && minute === 0) return "midnight";
  if (hour === 12 && minute === 0) return "noon";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const suffix = hour < 12 ? "am" : "pm";
  return minute === 0
    ? `${h12}${suffix}`
    : `${h12}:${String(minute).padStart(2, "0")}${suffix}`;
}

// One day's opening line, built from the structured periods so it never
// renders Google's en-dash strings. "6pm until 1am", "Closed", "Open 24 hours".
function dayHoursLine(periods: OpeningPeriod[], day: number): string {
  const todays = periods.filter((p) => p.open.day === day);
  if (todays.length === 0) return "Closed";
  return todays
    .map((p) =>
      p.close === null
        ? "Open 24 hours"
        : `${fmtClock(p.open.hour, p.open.minute)} until ${fmtClock(p.close.hour, p.close.minute)}`,
    )
    .join(", ");
}

// The secondary line shown next to the status dot in the collapsed strip.
function openSummary(state: OpenState): string {
  if (state.status === "open") {
    return state.closesAt === null
      ? "Open 24 hours"
      : `closes at ${fmtClock(state.closesAt.hour, state.closesAt.minute)}`;
  }
  if (state.status === "closed" && state.opensAt) {
    return `opens ${DAY_NAMES[state.opensAt.day]} ${fmtClock(state.opensAt.hour, state.opensAt.minute)}`;
  }
  return "";
}

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

export function VenueDetail({
  venue,
  signedIn,
}: {
  venue: Venue;
  // Anon visitors get card-level fields only (the moat). The right column
  // needs to know it's the ANON state — not "signed in, data unsynced" —
  // so it can render honest unlock prompts instead of eternal skeletons.
  signedIn: boolean;
}) {
  const router = useRouter();
  const { isSaved, toggleSaved } = useSaved();
  const saved = isSaved(venue.slug);
  const [whyOpen, setWhyOpen] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [showReserve, setShowReserve] = useState(false);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [descOpen, setDescOpen] = useState(false);
  const [photoIdx, setPhotoIdx] = useState(0);

  // Open/closed is time- and timezone-sensitive, so compute it only after
  // mount to avoid an SSR/client hydration mismatch. Until then the strip
  // renders a neutral "Hours" state.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
  }, []);
  const openState: OpenState = now
    ? getOpenState(venue.openingHours, now)
    : { status: "unknown" };
  const today = now ? londonWallClock(now).day : -1;

  const onShare = async () => {
    track("share", { kind: "venue", venue: venue.slug });
    const result = await shareOrCopy({
      title: venue.name,
      text: `${venue.name} · ${venue.neighbourhood}, London`,
      url: typeof window !== "undefined" ? window.location.href : "",
    });
    if (result === "copied") {
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 1800);
    }
  };

  const isReservable = RESERVABLE_TYPES.includes(venue.type);

  // Top-priority booking link if we have one. The agent thesis V1:
  // Reserve button deep-links to the venue's best-known booking URL
  // (lowest `priority` number wins). If absent, falls through to the
  // legacy in-app confirmation stub.
  const topBookingLink =
    venue.bookingLinks && venue.bookingLinks.length > 0
      ? [...venue.bookingLinks].sort((a, b) => a.priority - b.priority)[0]
      : null;

  // Where "Reserve" sends them: the best booking platform if we have one,
  // else the venue's own site. The picker sheet pre-fills date/time/party
  // into this before opening it.
  const reserveTarget: ReserveTarget | null = topBookingLink
    ? { platform: topBookingLink.platform, url: topBookingLink.url }
    : venue.websiteUrl
      ? { platform: "website", url: venue.websiteUrl }
      : null;

  const hasRealTalk = !!venue.criticalFlags && venue.criticalFlags.length > 0;
  // Only VERIFIED provenance is surfaced. The AI-discovered editorial_sources
  // were substantially dead / recycled / mis-attributed, so "Cross-checked"
  // and the fact-check links must be backed by sources we've actually fetched
  // and confirmed are live + on-topic. Unverified entries stay in the DB but
  // never render and never count — we re-enable each as it passes review.
  const verifiedSources =
    venue.editorialSources?.filter((s) => s.verified) ?? [];
  const verifiedCreators =
    venue.creatorCoverage?.filter((c) => c.verified) ?? [];
  const sourceCount = verifiedSources.length;
  const hasWhy = sourceCount > 0 || verifiedCreators.length > 0;

  // Quick-fact pills. We deliberately do NOT surface "tables free",
  // "next slot", or "X min walk": there's no live-availability feed and
  // no user location, so those would be fabricated numbers — and a
  // booking product can't afford fake signals. Only the editorial vibe
  // tags (real, curated) are shown. (Real walk times return inside Plan
  // My Night, computed step-to-step from venue coordinates.)
  //
  // We store the full tag set on the venue (onezone imports can carry 20+),
  // but only surface the top 6 here so the card stays readable. The rest
  // stay in venue.vibeTags for search and the personalisation engine.
  const PILL_LIMIT = 6;
  const pills = venue.vibeTags.slice(0, PILL_LIMIT);

  // Gallery photos: keyless Storage URLs (hero first). Falls back to the single
  // hero until the Phase 2 gallery backfill populates photo_urls.
  const photos =
    venue.photoUrls && venue.photoUrls.length > 0
      ? venue.photoUrls
      : [venue.imgUrl];

  // Desktop paddles: the snap scroller hides its scrollbars, so without
  // these a mouse/keyboard user can never reach photo 2+.
  const galleryRef = useRef<HTMLDivElement>(null);
  const scrollGallery = (dir: -1 | 1) => {
    const el = galleryRef.current;
    if (!el) return;
    el.scrollBy({
      left: dir * el.clientWidth,
      // The global reduced-motion CSS rule doesn't cover programmatic
      // smooth scrolling, so honor the preference here.
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  };

  const signInHref = `/sign-in?return=${encodeURIComponent(`/venue/${venue.slug}`)}`;

  return (
    // Mobile: the max-w-md phone shell, unchanged. Desktop (lg+): a
    // two-column editorial spread — sticky hero gallery left, content
    // right — so the page uses a laptop screen instead of rendering a
    // phone strip in the middle of it.
    <div className="max-w-md mx-auto min-h-screen bg-bg pb-32 lg:max-w-6xl lg:px-8 lg:pt-10 lg:pb-24 lg:grid lg:grid-cols-2 lg:gap-x-12 lg:items-start">
      {/* ── Hero ───────────────────────────────────────────────────── */}
      <div
        // Sticky offset = DesktopNav h-16 (64px) + the root's lg:pt-10
        // (40px). The theme() calc documents the derivation but does NOT
        // track desktop-nav.tsx — if the nav height changes, update this.
        // Desktop hero is a 4:5 portrait plate (fills the viewport under
        // the sticky offset; venue-feature convention) — radius scales up
        // with it to 3xl, per the panel's paired call. Mobile stays 4:3.
        // The max-h clamp keeps the STICKY plate's bottom edge (and the
        // vibe tagline on it) inside short viewports (1366×768 laptops):
        // 100vh − 104px offset − 40px breath; object-cover absorbs the crop.
        className="relative w-full aspect-[4/3] lg:aspect-[4/5] lg:max-h-[calc(100vh-9rem)] lg:sticky lg:top-[calc(theme(spacing.16)+theme(spacing.10))] lg:rounded-3xl lg:overflow-hidden"
      >
        {/* Swipeable photo gallery — keyless Storage URLs, hero first.
            Scroll-snaps horizontally; the dots track the active slide. */}
        <div
          ref={galleryRef}
          className="absolute inset-0 flex overflow-x-auto snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          onScroll={(e) => {
            const el = e.currentTarget;
            setPhotoIdx(Math.round(el.scrollLeft / el.clientWidth));
          }}
        >
          {photos.map((src, i) => (
            <div key={i} className="relative min-w-full h-full snap-center">
              <Image
                src={src}
                alt={
                  photos.length > 1
                    ? `${venue.name}, photo ${i + 1}`
                    : venue.name
                }
                fill
                priority={i === 0}
                sizes="(max-width: 640px) 100vw, 640px"
                // Keyless Storage URLs optimize fine; only a legacy keyed
                // Google URL (pre-mirror) needs the optimizer bypass.
                unoptimized={src.includes("googleapis.com")}
                className="object-cover"
              />
            </div>
          ))}
        </div>

        {/* Bottom scrim so the vibe tagline stays legible over any photo. */}
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/55 to-transparent"
        />

        {/* Floating photo controls — bare icons (no circle), matching the
            Explore / bottom-nav icon language. White + a drop shadow so they
            read on any photo in both day and night themes. 44px hit targets
            with a visible focus ring for keyboard / switch-control users. */}

        {/* Back button — overlays photo, top-left. Hidden on desktop: the
            top nav carries navigation there, and a floating phone-style
            back arrow reads as a mobile leftover. */}
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Back"
          className="absolute top-3 left-3 w-11 h-11 flex items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 lg:hidden"
        >
          <ArrowLeft
            className="w-6 h-6 text-white drop-shadow-md"
            strokeWidth={2}
          />
        </button>

        {/* Share button — overlays photo, top-right. Save lives only in the
            sticky bar now: one always-reachable save control, no duplicate. */}
        <button
          type="button"
          onClick={onShare}
          aria-label="Share"
          className="absolute top-3 right-3 w-11 h-11 flex items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
        >
          {shareCopied ? (
            <Check
              className="w-6 h-6 text-white drop-shadow-md"
              strokeWidth={2.25}
            />
          ) : (
            <Share2
              className="w-6 h-6 text-white drop-shadow-md"
              strokeWidth={2}
            />
          )}
        </button>

        {/* Vibe tagline — the venue's short editorial voice line, over the
            photo. Hidden if we hold none. */}
        {venue.vibe && (
          <p className="absolute inset-x-0 bottom-0 px-5 pb-4 text-[15px] italic leading-snug text-white/90 drop-shadow-md lg:text-lg lg:leading-snug lg:px-6 lg:pb-5 lg:max-w-[85%]">
            {venue.vibe}
          </p>
        )}

        {/* Desktop prev/next paddles — same white-over-photo icon language
            as Back/Share. Mouse and keyboard users have no other way to
            advance the hidden-scrollbar snap gallery. */}
        {photos.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => scrollGallery(-1)}
              aria-label="Previous photo"
              className="hidden lg:flex absolute left-3 top-1/2 -translate-y-1/2 w-11 h-11 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
            >
              <ChevronLeft
                className="w-6 h-6 text-white drop-shadow-md"
                strokeWidth={2}
              />
            </button>
            <button
              type="button"
              onClick={() => scrollGallery(1)}
              aria-label="Next photo"
              className="hidden lg:flex absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
            >
              <ChevronRight
                className="w-6 h-6 text-white drop-shadow-md"
                strokeWidth={2}
              />
            </button>
          </>
        )}

        {/* Photo dots — only when there's a real gallery. Top-center, clear of
            the back/share controls and the bottom tagline. */}
        {photos.length > 1 && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5">
            {photos.map((_, i) => (
              <span
                key={i}
                aria-hidden
                className={
                  "rounded-full drop-shadow transition-all " +
                  (i === photoIdx
                    ? "w-2 h-2 bg-white"
                    : "w-1.5 h-1.5 bg-white/60")
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Info block ────────────────────────────────────────────── */}
      <section className="px-5 lg:px-0">
        {/* lg:pt-0 keeps the column top level with the hero's top edge. */}
        <div className="text-[11px] font-extrabold tracking-[0.12em] uppercase text-muted-fg pt-5 lg:pt-0 lg:text-xs lg:tracking-[0.16em]">
          {venue.neighbourhood.toUpperCase()} · {venue.price} · {venue.type}
        </div>

        <h1 className="text-3xl lg:text-5xl lg:tracking-tight font-extrabold text-fg leading-tight mt-1">
          {venue.name}
        </h1>

        <div className="flex items-center gap-1.5 mt-2 text-sm text-muted-fg">
          {/* Grey star — a warm neutral. The rating isn't a brand-accent
              moment, so it stays out of the amber/violet vocabulary. */}
          <Star
            className="w-4 h-4 text-muted-fg fill-current"
            strokeWidth={0}
          />
          <span>{venue.rating}</span>
          <span aria-hidden>·</span>
          <span>{venue.reviewCount.toLocaleString()} reviews</span>
        </div>

        {/* Desktop action row — the booking-module-in-the-masthead
            convention (OpenTable/Resy). On mobile these actions live in the
            fixed bottom bar; here they'd otherwise sit two scrolls below
            the fold. Same component + state as the bar, one visible at a
            time. */}
        <VenueActions
          venue={venue}
          saved={saved}
          signedIn={signedIn}
          signInHref={signInHref}
          isReservable={isReservable}
          reserveTarget={reserveTarget}
          onToggleSaved={() => toggleSaved(venue.slug)}
          onReserve={() => setShowReserve(true)}
          className="hidden lg:flex gap-3 mt-6"
        />

        {/* Vibe tags as filter chips — tapping routes to that tag's results on
            Explore. Placed before the description so the at-a-glance signal
            leads. Press state mirrors the Reserve CTA (violet fill, white). */}
        {pills.length > 0 && (
          <div className="flex flex-nowrap gap-2 mt-4 overflow-x-auto -mx-5 px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:mx-0 lg:px-0 lg:flex-wrap lg:overflow-visible">
            {pills.map((label) => (
              <Link
                key={label}
                href={`/explore?tag=${encodeURIComponent(label)}`}
                className="shrink-0 whitespace-nowrap rounded-full border border-fg/20 px-3 py-1.5 text-xs font-semibold text-fg transition-colors active:border-primary active:bg-primary active:text-white lg:hover:border-primary lg:hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {label}
              </Link>
            ))}
          </div>
        )}

        <div className="mt-5">
          <p
            className={
              "text-base leading-relaxed text-fg " +
              (descOpen ? "" : "line-clamp-3")
            }
          >
            {venue.longDescription}
          </p>
          {venue.longDescription.length > 160 && (
            <button
              type="button"
              onClick={() => setDescOpen((v) => !v)}
              aria-expanded={descOpen}
              className="mt-1.5 rounded text-sm font-bold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {descOpen ? "Read less" : "Read more"}
            </button>
          )}
        </div>

        {/* ── Hours / Open now ──────────────────────────────────────
            Live open/closed computed in Europe/London from the structured
            periods (see lib/opening-hours). Collapsed: status + next change;
            expanded: the full week, dash-free ("6pm until 1am"), today bold.
            Hidden for signed-out users (openingHours is a moat field). */}
        {venue.openingHours && (
          // lg:border-b-0 — at lg the NEXT section's deck rule owns that
          // boundary; keeping both drew two hairlines around an empty band.
          <div className="mt-6 border-y border-fg/10 lg:mt-12 lg:border-b-0">
            <button
              type="button"
              onClick={() => setHoursOpen((v) => !v)}
              aria-expanded={hoursOpen}
              className="w-full flex items-center justify-between py-3.5 text-left"
            >
              <span className="flex items-center gap-2.5 text-sm">
                <span
                  aria-hidden
                  className={
                    "w-2 h-2 rounded-full " +
                    (openState.status === "open"
                      ? "bg-green-600"
                      : "bg-muted-fg")
                  }
                />
                <span className="font-extrabold text-fg">
                  {openState.status === "open"
                    ? "Open now"
                    : openState.status === "closed"
                      ? "Closed"
                      : "Hours"}
                </span>
                {openSummary(openState) && (
                  <span className="text-muted-fg">
                    · {openSummary(openState)}
                  </span>
                )}
              </span>
              <ChevronDown
                className={
                  "w-4 h-4 text-muted-fg transition-transform " +
                  (hoursOpen ? "rotate-180" : "rotate-0")
                }
                strokeWidth={2}
              />
            </button>
            {hoursOpen && (
              <ul className="flex flex-col gap-1.5 pb-4 text-[13px]">
                {[1, 2, 3, 4, 5, 6, 0].map((day) => {
                  const isToday = day === today;
                  return (
                    <li
                      key={day}
                      className={
                        "flex justify-between " +
                        (isToday ? "font-bold text-fg" : "text-muted-fg")
                      }
                    >
                      <span>{DAY_NAMES[day]}</span>
                      <span>
                        {dayHoursLine(venue.openingHours!.periods, day)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {/* ── Real Talk ──────────────────────────────────────────────
            Honest, practical signal in an editorial pull-quote treatment:
            eyebrow + headline, then a vertical accent rule down the flag
            list with hairline dividers. Body is upright text-fg (not italic
            muted) for readability and AA contrast. */}
        {hasRealTalk && (
          <div className="mt-8 lg:mt-12 lg:border-t lg:border-fg/10 lg:pt-8">
            <div className="text-[11px] font-extrabold tracking-[0.18em] uppercase text-accent mb-1.5">
              Real Talk
            </div>
            <h2 className="text-[20px] font-bold text-heading leading-tight mb-6">
              What to actually expect.
            </h2>
            <div className="relative pl-5">
              <span
                aria-hidden
                className="absolute left-0 top-1 bottom-1 w-0.5 bg-accent rounded-full"
              />
              <div className="flex flex-col">
                {venue.criticalFlags!.map((flag, i) => (
                  <div
                    key={i}
                    className={i > 0 ? "mt-5 pt-5 border-t border-fg/10" : ""}
                  >
                    <div className="text-[15px] font-extrabold text-fg leading-snug">
                      {flag.label}
                    </div>
                    <p className="text-[14px] text-fg leading-relaxed mt-1.5">
                      {flag.body}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Reviews ────────────────────────────────────────────────
            Real Google reviews when synced (verbatim text + author, plus a
            small "Reviews from Google" attribution — both required by Google's
            display policy). Skeleton cards as the empty state until then;
            never placeholder or invented quotes. */}
        {/* Desktop gets magazine deck rules (hairline + breath) on the
            labelled sections so the column reads as editorial units
            rather than one compressed slab. */}
        <div className="mt-8 lg:mt-12 lg:border-t lg:border-fg/10 lg:pt-8">
          <div className="flex items-baseline justify-between mb-3">
            <div className="text-[11px] font-extrabold tracking-[0.12em] uppercase text-muted-fg">
              Reviews
            </div>
            {venue.reviews && venue.reviews.length > 0 && (
              <span className="text-[10px] text-muted-fg">
                Reviews from Google
              </span>
            )}
          </div>
          {venue.reviews && venue.reviews.length > 0 ? (
            // Desktop becomes a fluid 2-col grid — a hidden-scrollbar row
            // with no swipe makes review 3+ undiscoverable with a mouse,
            // and fixed 240px cards stack single-file below ~1096px.
            <div className="flex gap-3 overflow-x-auto -mx-5 px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:grid lg:grid-cols-2 lg:mx-0 lg:px-0 lg:overflow-visible">
              {venue.reviews.map((r, i) => (
                <div
                  key={i}
                  className="min-w-[240px] max-w-[240px] rounded-2xl bg-muted px-4 py-3.5 lg:min-w-0 lg:max-w-none"
                >
                  <div className="flex gap-0.5 mb-2">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <Star
                        key={s}
                        className={
                          "w-3.5 h-3.5 fill-current " +
                          (s <= Math.round(r.rating)
                            ? "text-muted-fg"
                            : "text-fg/15")
                        }
                        strokeWidth={0}
                      />
                    ))}
                  </div>
                  <p className="text-[13px] text-fg leading-relaxed line-clamp-5">
                    {r.text}
                  </p>
                  <p className="text-[11px] text-muted-fg mt-2">
                    {r.author}
                    {r.relativeTime ? ` · ${r.relativeTime}` : ""}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <>
              {/* Skeletons mean "not synced yet" — true only when signed in.
                  For anon at lg they'd read as a permanently broken fetch,
                  so the desktop anon state gets an honest unlock card
                  instead (mobile keeps today's exact rendering). */}
              <div
                className={
                  "flex gap-3 overflow-x-auto -mx-5 px-5 pb-1 lg:grid lg:grid-cols-2 lg:mx-0 lg:px-0 lg:overflow-visible" +
                  (signedIn ? "" : " lg:hidden")
                }
              >
                {[0, 1].map((i) => (
                  <div
                    key={i}
                    aria-hidden
                    className="min-w-[200px] rounded-2xl border border-dashed border-fg/20 px-4 py-4 lg:min-w-0"
                  >
                    <div className="flex gap-1 mb-3">
                      {[0, 1, 2, 3, 4].map((s) => (
                        <Star
                          key={s}
                          className="w-3 h-3 text-fg/15 fill-current"
                          strokeWidth={0}
                        />
                      ))}
                    </div>
                    <div className="h-2.5 rounded bg-fg/10 mb-2" />
                    <div className="h-2.5 rounded bg-fg/10 mb-2 w-5/6" />
                    <div className="h-2.5 rounded bg-fg/10 w-2/3" />
                  </div>
                ))}
              </div>
              {!signedIn && (
                <div className="hidden lg:flex items-center gap-3 border border-fg/15 rounded-2xl px-4 py-4">
                  <Lock
                    className="w-4 h-4 shrink-0 text-muted-fg"
                    strokeWidth={2}
                  />
                  {/* Reviews, hours and the full description ARE moat-gated
                      for every venue, so this claim is always true. "Booking"
                      is not promised — walk-ins have none. */}
                  <p className="text-[13px] text-muted-fg leading-snug">
                    Reviews, hours and details unlock with a free account.
                  </p>
                  <Link
                    href={signInHref}
                    className="ml-auto shrink-0 text-sm font-bold text-primary rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    Sign up free
                  </Link>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Plan your visit ────────────────────────────────────────
            Address + map + dash-free practical actions. The map is a
            placeholder until Phase 2 swaps in a Static Map image (needs the
            server-only Places key). Directions deep-links to Google Maps. */}
        {(venue.address ||
          (venue.lat && venue.lng) ||
          venue.phone ||
          venue.websiteUrl) && (
          <div className="mt-8 lg:mt-12 lg:border-t lg:border-fg/10 lg:pt-8">
            <div className="text-[11px] font-extrabold tracking-[0.12em] uppercase text-muted-fg mb-3">
              Plan your visit
            </div>
            {venue.lat && venue.lng && (
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${venue.lat},${venue.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open in Google Maps"
                className="relative block mb-3 h-28 lg:h-52 overflow-hidden rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {venue.mapUrl ? (
                  <Image
                    src={venue.mapUrl}
                    alt={`Map of ${venue.name}`}
                    fill
                    sizes="(max-width: 640px) 100vw, 640px"
                    className="object-cover"
                  />
                ) : (
                  <MapTilePlaceholder
                    lat={venue.lat}
                    lng={venue.lng}
                    label={venue.neighbourhood}
                  />
                )}
              </a>
            )}
            {venue.address && (
              <p className="text-sm font-semibold text-fg">{venue.address}</p>
            )}
            <p className="text-[13px] text-muted-fg mt-0.5">
              {venue.neighbourhood}, London
              {((venue.lat && venue.lng) || venue.address) && (
                <>
                  {" · "}
                  <a
                    href={
                      venue.lat && venue.lng
                        ? `https://www.google.com/maps/dir/?api=1&destination=${venue.lat},${venue.lng}`
                        : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
                            `${venue.address}, ${venue.neighbourhood}, London`,
                          )}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() =>
                      recordSignal("outbound_click", {
                        surface: "venue",
                        venueId: venue.id,
                        context: { target: "directions" },
                      })
                    }
                    className="font-bold text-primary rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    Get directions
                  </a>
                </>
              )}
            </p>
            <div className="flex flex-wrap gap-2 mt-4">
              {(venue.menuUrl || venue.websiteUrl) && (
                <a
                  href={venue.menuUrl ?? venue.websiteUrl!}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() =>
                    recordSignal("outbound_click", {
                      surface: "venue",
                      venueId: venue.id,
                      context: { target: venue.menuUrl ? "menu" : "website" },
                    })
                  }
                  className="inline-flex items-center gap-1.5 rounded-full border border-fg/20 px-4 py-2 text-sm font-semibold text-fg transition-colors active:border-primary active:bg-primary active:text-white lg:hover:border-primary lg:hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <Globe className="w-4 h-4" strokeWidth={2} />
                  {/* "See the menu" only when we have a real menu link; else the
                      honest "Visit website" (the homepage, not a menu). */}
                  {venue.menuUrl ? "See the menu" : "Visit website"}
                </a>
              )}
              {venue.phone && (
                <a
                  href={`tel:${venue.phone}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-fg/20 px-4 py-2 text-sm font-semibold text-fg transition-colors active:border-primary active:bg-primary active:text-white lg:hover:border-primary lg:hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <Phone className="w-4 h-4" strokeWidth={2} />
                  Call venue
                </a>
              )}
            </div>
          </div>
        )}

        {/* ── Why this is here ───────────────────────────────────────
            Editorial sources + creator coverage as a collapsible
            expandable. Transparency promise — users can fact-check the
            catalog independent of our own editorial. */}
        {hasWhy && (
          <div className="mt-7 lg:mt-12 lg:border-t lg:border-fg/10 lg:pt-8">
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
              <div className="mt-2 rounded-2xl bg-muted border border-fg/10 px-4 py-3">
                {verifiedSources.length > 0 && (
                  <div>
                    <div className="text-[10px] font-extrabold tracking-[0.12em] uppercase text-muted-fg mb-1.5">
                      Editorial coverage
                    </div>
                    <ul className="space-y-1">
                      {verifiedSources.map((src, i) => (
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
                              , {src.title}
                            </span>
                          )}
                          {src.date && (
                            <span className="text-muted-fg/80 italic">
                              {" · "}
                              {new Date(src.date).toLocaleDateString("en-GB", {
                                month: "short",
                                year: "numeric",
                              })}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {verifiedCreators.length > 0 && (
                  <div
                    className={
                      verifiedSources.length > 0
                        ? "mt-3 pt-3 border-t border-fg/10"
                        : ""
                    }
                  >
                    <div className="text-[10px] font-extrabold tracking-[0.12em] uppercase text-muted-fg mb-1.5">
                      Creators covering this
                    </div>
                    <ul className="space-y-1">
                      {verifiedCreators.map((c, i) => (
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

      {/* ── Mobile CTA bar ────────────────────────────────────────────
          Fixed to the viewport bottom, phone-sheet style — mobile classes
          unchanged. Hidden at lg, where the SAME component renders in the
          masthead instead (shared saved/reserve state keeps them in sync;
          display:none removes this one from the a11y tree, so exactly one
          action row exists at any viewport). */}
      <VenueActions
        venue={venue}
        saved={saved}
        signedIn={signedIn}
        signInHref={signInHref}
        isReservable={isReservable}
        reserveTarget={reserveTarget}
        onToggleSaved={() => toggleSaved(venue.slug)}
        onReserve={() => setShowReserve(true)}
        className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-bg border-t border-fg/10 px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] flex gap-3 lg:hidden"
      />

      {showReserve && reserveTarget && (
        <ReserveSheet
          venue={venue}
          target={reserveTarget}
          onClose={() => setShowReserve(false)}
        />
      )}
    </div>
  );
}

// The Save / Plan / Reserve action row. Rendered twice by VenueDetail —
// fixed bottom bar on mobile, masthead row on desktop — with mutually
// exclusive visibility (lg:hidden vs hidden lg:flex), so state stays in
// one place and screen readers only ever see one instance.
function VenueActions({
  venue,
  saved,
  signedIn,
  signInHref,
  isReservable,
  reserveTarget,
  onToggleSaved,
  onReserve,
  className,
}: {
  venue: Venue;
  saved: boolean;
  signedIn: boolean;
  signInHref: string;
  isReservable: boolean;
  reserveTarget: ReserveTarget | null;
  onToggleSaved: () => void;
  onReserve: () => void;
  className: string;
}) {
  return (
    <div className={className}>
      <button
        type="button"
        onClick={onToggleSaved}
        aria-label={saved ? "Unsave" : "Save"}
        className="flex-shrink-0 w-12 h-12 inline-flex items-center justify-center border border-fg/15 rounded-full transition-colors lg:hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Heart
          className={
            "w-5 h-5 " +
            (saved ? "fill-primary text-primary" : "fill-none text-fg")
          }
          strokeWidth={2}
        />
      </button>
      {/* Add this venue to a night plan. Scaffold → links to the plan
          builder for now; wires to add-to-plan in a later phase. */}
      <Link
        href="/plan"
        aria-label="Add to a plan"
        className="flex-shrink-0 inline-flex items-center gap-1.5 px-5 border border-fg/15 rounded-full text-fg text-sm font-semibold transition-colors active:border-primary active:bg-primary active:text-white lg:hover:border-primary lg:hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Plus className="w-4 h-4" strokeWidth={2.5} />
        Plan
      </Link>
      {isReservable && reserveTarget ? (
        // Agent flow: open the picker (date/time/party), pre-fill the
        // venue's booking platform, then land on the "Did you book?" page.
        <button
          type="button"
          onClick={onReserve}
          className="flex-1 bg-primary text-white rounded-full px-5 py-3 font-semibold text-sm transition-colors lg:hover:bg-primary/90"
        >
          Reserve → {platformLabel(reserveTarget.platform)}
        </button>
      ) : isReservable && venue.phone ? (
        // No online booking — the honest action is to call the venue.
        <a
          href={`tel:${venue.phone}`}
          className="flex-1 bg-primary text-white rounded-full px-5 py-3 font-semibold text-sm text-center no-underline transition-colors lg:hover:bg-primary/90"
        >
          Call to book
        </a>
      ) : isReservable && !signedIn ? (
        // Anon can't hold a booking channel (booking links are moat
        // fields). On mobile the grey status pill stays; on desktop —
        // where the wall isn't the only conversion surface — offer the
        // honest action instead of a dead pill.
        <>
          <div
            role="status"
            className="flex-1 flex items-center justify-center px-5 py-3 rounded-full bg-muted text-muted-fg text-sm font-medium lg:hidden"
          >
            Booking via the venue
          </div>
          <Link
            href={signInHref}
            className="flex-1 hidden lg:inline-flex items-center justify-center px-5 py-3 border border-fg/15 rounded-full text-fg text-sm font-semibold transition-colors lg:hover:border-primary lg:hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {/* "options", not "book": anon can't know a booking channel
                exists — signed-in may honestly land on "Booking via the
                venue". Never promise an action we can't deliver. */}
            Sign in to see booking options
          </Link>
        </>
      ) : isReservable ? (
        // Signed in, reservable type, but we hold no booking channel.
        // Show an honest status instead of a fake confirmation flow.
        <div
          role="status"
          className="flex-1 flex items-center justify-center px-5 py-3 rounded-full bg-muted text-muted-fg text-sm font-medium"
        >
          Booking via the venue
        </div>
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
  );
}
