"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronDown,
  Check,
  Globe,
  Heart,
  MapPin,
  Phone,
  Plus,
  Share2,
  Star,
} from "lucide-react";
import { useSaved } from "@/components/saved-context";
import { ReserveSheet } from "@/components/reserve-sheet";
import { platformLabel, type ReserveTarget } from "@/lib/booking-link";
import { shareOrCopy } from "@/lib/share";
import { track } from "@/lib/analytics";
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

export function VenueDetail({ venue }: { venue: Venue }) {
  const router = useRouter();
  const { isSaved, toggleSaved } = useSaved();
  const saved = isSaved(venue.slug);
  const [whyOpen, setWhyOpen] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [showReserve, setShowReserve] = useState(false);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [descOpen, setDescOpen] = useState(false);

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
          // Google Places photo URLs 302-redirect with an API key;
          // bypass Vercel's optimizer for those.
          unoptimized={venue.imgUrl.includes("googleapis.com")}
          className="object-cover"
        />

        {/* Bottom scrim so the vibe tagline stays legible over any photo. */}
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/55 to-transparent"
        />

        {/* Floating photo controls — bare icons (no circle), matching the
            Explore / bottom-nav icon language. White + a drop shadow so they
            read on any photo in both day and night themes. 44px hit targets
            with a visible focus ring for keyboard / switch-control users. */}

        {/* Back button — overlays photo, top-left */}
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Back"
          className="absolute top-3 left-3 w-11 h-11 flex items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
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
          <p className="absolute inset-x-0 bottom-0 px-5 pb-4 text-[15px] italic leading-snug text-white/90 drop-shadow-md">
            {venue.vibe}
          </p>
        )}
      </div>

      {/* ── Info block ────────────────────────────────────────────── */}
      <section className="px-5">
        <div className="text-[11px] font-extrabold tracking-[0.12em] uppercase text-muted-fg pt-5">
          {venue.neighbourhood.toUpperCase()} · {venue.price} · {venue.type}
        </div>

        <h1 className="text-3xl font-extrabold text-fg leading-tight mt-1">
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

        {/* Vibe tags as filter chips — tapping routes to that tag's results on
            Explore. Placed before the description so the at-a-glance signal
            leads. Press state mirrors the Reserve CTA (violet fill, white). */}
        {pills.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-4">
            {pills.map((label) => (
              <Link
                key={label}
                href={`/explore?tag=${encodeURIComponent(label)}`}
                className="rounded-full border border-fg/20 px-3 py-1.5 text-xs font-semibold text-fg transition-colors active:border-primary active:bg-primary active:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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

        {/* ── Real Talk ──────────────────────────────────────────────
            Moved high on purpose: this honest, practical signal is the
            most differentiated content on the page. Eyebrow + headline,
            then a vertical accent rule down the flag list with hairline
            dividers. Body is upright text-fg (not italic muted) for
            readability and AA contrast. */}
        {hasRealTalk && (
          <div className="mt-8">
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

        {/* ── Hours / Open now ──────────────────────────────────────
            Live open/closed computed in Europe/London from the structured
            periods (see lib/opening-hours). Collapsed: status + next change;
            expanded: the full week, dash-free ("6pm until 1am"), today bold.
            Hidden for signed-out users (openingHours is a moat field). */}
        {venue.openingHours && (
          <div className="mt-6 border-y border-fg/10">
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

        {/* ── Reviews ────────────────────────────────────────────────
            Section scaffold + explicit empty state. Real Google reviews
            land here in Phase 2 (Places Details); until then we show
            skeleton cards, never placeholder or invented quotes. */}
        <div className="mt-8">
          <div className="text-[11px] font-extrabold tracking-[0.12em] uppercase text-muted-fg mb-3">
            Reviews
          </div>
          <div className="flex gap-3 overflow-x-auto -mx-5 px-5 pb-1">
            {[0, 1].map((i) => (
              <div
                key={i}
                aria-hidden
                className="min-w-[200px] rounded-2xl border border-dashed border-fg/20 px-4 py-4"
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
          <p className="text-[13px] text-muted-fg mt-2">
            Reviews from Google land here soon.
          </p>
        </div>

        {/* ── Plan your visit ────────────────────────────────────────
            Address + map + dash-free practical actions. The map is a
            placeholder until Phase 2 swaps in a Static Map image (needs the
            server-only Places key). Directions deep-links to Google Maps. */}
        {(venue.address ||
          (venue.lat && venue.lng) ||
          venue.phone ||
          venue.websiteUrl) && (
          <div className="mt-8">
            <div className="text-[11px] font-extrabold tracking-[0.12em] uppercase text-muted-fg mb-3">
              Plan your visit
            </div>
            {venue.lat && venue.lng && (
              <div
                aria-hidden
                className="mb-3 h-28 rounded-2xl bg-muted flex items-center justify-center gap-2 text-muted-fg"
              >
                <MapPin className="w-5 h-5" strokeWidth={2} />
                <span className="text-sm font-medium">
                  {venue.neighbourhood}
                </span>
              </div>
            )}
            {venue.address && (
              <p className="text-sm font-semibold text-fg">{venue.address}</p>
            )}
            <p className="text-[13px] text-muted-fg mt-0.5">
              {venue.neighbourhood}, London
            </p>
            <div className="flex flex-wrap gap-2 mt-4">
              {((venue.lat && venue.lng) || venue.address) && (
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
                  className="inline-flex items-center gap-1.5 rounded-full border border-fg/20 px-4 py-2 text-sm font-semibold text-fg transition-colors active:border-primary active:bg-primary active:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <MapPin className="w-4 h-4" strokeWidth={2} />
                  Get directions
                </a>
              )}
              {venue.websiteUrl && (
                <a
                  href={venue.websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full border border-fg/20 px-4 py-2 text-sm font-semibold text-fg transition-colors active:border-primary active:bg-primary active:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <Globe className="w-4 h-4" strokeWidth={2} />
                  {venue.type === "Restaurant"
                    ? "See the menu"
                    : "Visit website"}
                </a>
              )}
              {venue.phone && (
                <a
                  href={`tel:${venue.phone}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-fg/20 px-4 py-2 text-sm font-semibold text-fg transition-colors active:border-primary active:bg-primary active:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
          className="flex-shrink-0 w-12 h-12 inline-flex items-center justify-center border border-fg/15 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
          className="flex-shrink-0 inline-flex items-center gap-1.5 px-5 border border-fg/15 rounded-full text-fg text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Plus className="w-4 h-4" strokeWidth={2.5} />
          Plan
        </Link>
        {isReservable && reserveTarget ? (
          // Agent flow: open the picker (date/time/party), pre-fill the
          // venue's booking platform, then land on the "Did you book?" page.
          <button
            type="button"
            onClick={() => setShowReserve(true)}
            className="flex-1 bg-primary text-white rounded-full px-5 py-3 font-semibold text-sm"
          >
            Reserve → {platformLabel(reserveTarget.platform)}
          </button>
        ) : isReservable && venue.phone ? (
          // No online booking — the honest action is to call the venue.
          <a
            href={`tel:${venue.phone}`}
            className="flex-1 bg-primary text-white rounded-full px-5 py-3 font-semibold text-sm text-center no-underline"
          >
            Call to book
          </a>
        ) : isReservable ? (
          // Reservable type but we hold no booking channel for it. Show
          // an honest status instead of a fake confirmation flow.
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
