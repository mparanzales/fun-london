"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ExternalLink,
  Calendar,
  Clock,
  Star,
  ChevronDown,
  MapPin,
  Globe,
  Phone,
} from "lucide-react";
import { EventActions } from "@/components/event-actions";
import { applyAffiliate } from "@/lib/affiliate";
import { track } from "@/lib/analytics";
import {
  getOpenState,
  londonWallClock,
  type OpenState,
} from "@/lib/opening-hours";
import type { Event, Venue, OpeningPeriod } from "@/lib/types";

// Event detail — mirrors the venue detail composition so a tap from /events
// lands in the same visual language as a tap from /explore. The venue-level
// richness (rating, hours, address, map, reviews) comes from event.placeDetails
// (Google Places, resolved by venue name+area — facts only, never an LLM). Every
// Places section is guarded, so an event whose venue didn't resolve still
// renders with what we have. placeDetails is signed-in only (moat).

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

export function EventDetail({
  event,
  venue,
}: {
  event: Event;
  venue: Venue | null;
}) {
  const router = useRouter();
  const place = event.placeDetails;

  const isPopup = event.isPopup;
  const isExternal = !!event.sourceUrl && event.sourceUrl.startsWith("http");
  const longDateLabel =
    isPopup && event.endsAt
      ? `Ends ${formatLongDate(event.endsAt)}`
      : formatLongDate(event.startsAt);
  const eyebrow = isPopup
    ? `Pop-up · ${event.area}`
    : `${event.area} · ${event.category}`;
  const ticketProvider = providerFromUrl(event.sourceUrl);
  const ctaLabel = isPopup
    ? "Visit official page"
    : ticketProvider
      ? `Get tickets → ${ticketProvider}`
      : "Get tickets";
  const ctaHref = isPopup
    ? event.sourceUrl
    : event.sourceUrl && isExternal
      ? applyAffiliate("ticketmaster", event.sourceUrl)
      : event.sourceUrl;

  // Prefer the event's own blurb; fall back to Google's factual one-liner.
  const blurb = event.description ?? place?.editorial ?? null;

  // Live open/closed of the venue, in Europe/London, computed post-mount to
  // avoid a hydration mismatch.
  const [hoursOpen, setHoursOpen] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
  }, []);
  const openState: OpenState =
    now && place?.openingHours
      ? getOpenState(place.openingHours, now)
      : { status: "unknown" };
  const today = now ? londonWallClock(now).day : -1;

  const mapsHref =
    place?.mapsUrl ??
    (place?.lat != null && place?.lng != null
      ? `https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`
      : place?.address
        ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(place.address)}`
        : null);

  return (
    <div className="max-w-md mx-auto min-h-screen bg-bg pb-32">
      {/* ── Hero ───────────────────────────────────────────────────── */}
      <div className="relative w-full" style={{ aspectRatio: "4/3" }}>
        <Image
          src={event.imgUrl}
          alt={event.name}
          fill
          priority
          sizes="(max-width: 640px) 100vw, 640px"
          className="object-cover"
        />
        <button
          onClick={() => router.back()}
          aria-label="Back"
          className="absolute top-4 left-4 w-10 h-10 flex items-center justify-center"
        >
          <ArrowLeft
            size={24}
            className="text-white drop-shadow-md"
            strokeWidth={2}
          />
        </button>
      </div>

      {/* ── Info block ─────────────────────────────────────────────── */}
      <section className="px-5 pt-5">
        <div className="text-[11px] font-extrabold tracking-[0.12em] uppercase text-muted-fg">
          {eyebrow}
        </div>
        <h1 className="text-[28px] font-extrabold tracking-tight text-heading leading-tight mt-1.5">
          {event.name}
        </h1>
        <div className="text-base font-semibold text-fg mt-2">
          {event.venueName}
        </div>

        {/* Venue rating (grey star, like the venue page). From Places. */}
        {place?.rating != null && (
          <div className="flex items-center gap-1.5 mt-2 text-sm text-muted-fg">
            <Star
              className="w-4 h-4 text-muted-fg fill-current"
              strokeWidth={0}
            />
            <span>{place.rating}</span>
            {place.ratingCount != null && (
              <>
                <span aria-hidden>·</span>
                <span>{place.ratingCount.toLocaleString()} reviews</span>
              </>
            )}
          </div>
        )}

        {/* Quick facts — date + time + price */}
        <div className="flex flex-wrap gap-2 mt-5">
          <span className="flex items-center gap-1.5 border border-fg/15 rounded-full px-3 py-1.5 text-xs font-medium text-fg">
            <Calendar size={13} strokeWidth={2} />
            {longDateLabel}
          </span>
          {!isPopup && (
            <span className="flex items-center gap-1.5 border border-fg/15 rounded-full px-3 py-1.5 text-xs font-medium text-fg">
              <Clock size={13} strokeWidth={2} />
              {event.timeLabel}
            </span>
          )}
          <span className="border border-fg/15 rounded-full px-3 py-1.5 text-xs font-medium text-fg">
            {event.price}
          </span>
        </div>

        {/* What is this — the event's blurb, or Google's factual one-liner. */}
        {blurb && (
          <p className="text-[15px] text-fg/90 leading-relaxed mt-5">{blurb}</p>
        )}

        {/* Add to calendar (.ics) + share */}
        <EventActions event={event} />

        {/* ── Hours / Open now (the venue's) ─────────────────────────── */}
        {place?.openingHours && (
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
                      : "Venue hours"}
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
                        {dayHoursLine(place.openingHours!.periods, day)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {/* ── Reviews (Google, verbatim + attribution) ───────────────── */}
        {place?.reviews && place.reviews.length > 0 && (
          <div className="mt-8">
            <div className="flex items-baseline justify-between mb-3">
              <div className="text-[11px] font-extrabold tracking-[0.12em] uppercase text-muted-fg">
                Reviews
              </div>
              <span className="text-[10px] text-muted-fg">
                Reviews from Google
              </span>
            </div>
            <div className="flex gap-3 overflow-x-auto -mx-5 px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {place.reviews.map((r, i) => (
                <div
                  key={i}
                  className="min-w-[240px] max-w-[240px] rounded-2xl bg-muted px-4 py-3.5"
                >
                  <div className="flex gap-0.5 mb-2">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <Star
                        key={s}
                        className={
                          "w-3.5 h-3.5 fill-current " +
                          (s <= Math.round(r.rating ?? 0)
                            ? "text-muted-fg"
                            : "text-fg/15")
                        }
                        strokeWidth={0}
                      />
                    ))}
                  </div>
                  {r.text && (
                    <p className="text-[13px] text-fg leading-relaxed line-clamp-5">
                      {r.text}
                    </p>
                  )}
                  {r.author && (
                    <p className="text-[11px] text-muted-fg mt-2">{r.author}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Plan your visit — venue address + map + links ──────────── */}
        {place &&
          (place.address || mapsHref || place.website || place.phone) && (
            <div className="mt-8">
              <div className="text-[11px] font-extrabold tracking-[0.12em] uppercase text-muted-fg mb-3">
                Plan your visit
              </div>
              {mapsHref && (
                <a
                  href={mapsHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open in Google Maps"
                  className="relative flex mb-3 h-24 items-center justify-center gap-2 overflow-hidden rounded-2xl bg-muted text-muted-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <MapPin className="w-5 h-5" strokeWidth={2} />
                  <span className="text-sm font-medium">
                    Open in Google Maps
                  </span>
                </a>
              )}
              {place.address && (
                <p className="text-sm font-semibold text-fg">{place.address}</p>
              )}
              <p className="text-[13px] text-muted-fg mt-0.5">
                {event.venueName}, {event.area}
              </p>
              <div className="flex flex-wrap gap-2 mt-4">
                {place.website && (
                  <a
                    href={place.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full border border-fg/20 px-4 py-2 text-sm font-semibold text-fg transition-colors active:border-primary active:bg-primary active:text-white"
                  >
                    <Globe className="w-4 h-4" strokeWidth={2} />
                    Visit website
                  </a>
                )}
                {place.phone && (
                  <a
                    href={`tel:${place.phone}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-fg/20 px-4 py-2 text-sm font-semibold text-fg transition-colors active:border-primary active:bg-primary active:text-white"
                  >
                    <Phone className="w-4 h-4" strokeWidth={2} />
                    Call venue
                  </a>
                )}
              </div>
            </div>
          )}

        {/* ── Optional venue card (rare: event's venue is in our catalogue) */}
        {venue && (
          <div className="mt-8">
            <div className="text-[11px] font-extrabold tracking-[0.18em] uppercase text-accent mb-1.5">
              The venue
            </div>
            <Link
              href={`/venue/${venue.slug}`}
              className="block rounded-2xl border border-border bg-card p-4 hover:bg-muted/30 transition-colors"
            >
              <div className="text-[15px] font-extrabold text-heading leading-tight">
                {venue.name}
              </div>
              <div className="text-[11px] text-muted-fg mt-0.5">
                {venue.type} · {venue.neighbourhood} · {venue.price}
              </div>
              {venue.vibe && (
                <div className="text-[13px] text-fg/80 italic mt-2 leading-relaxed">
                  {venue.vibe}
                </div>
              )}
              <div className="text-[10px] font-extrabold tracking-[0.14em] uppercase text-accent mt-3">
                See venue details →
              </div>
            </Link>
          </div>
        )}
      </section>

      {/* ── Sticky bottom CTA ──────────────────────────────────────── */}
      <div
        className="fixed bottom-16 left-0 right-0 z-30 px-5 pb-3 pt-3 pointer-events-none"
        style={{
          background:
            "linear-gradient(to top, var(--fl-bg) 65%, transparent 100%)",
        }}
      >
        <div className="max-w-md mx-auto pointer-events-auto">
          {event.sourceUrl ? (
            <a
              href={ctaHref ?? event.sourceUrl}
              target={isExternal ? "_blank" : undefined}
              rel={isExternal ? "noopener noreferrer" : undefined}
              onClick={() =>
                track("event_ticket_click", {
                  id: event.id,
                  provider: isPopup ? "popup" : (ticketProvider ?? "unknown"),
                })
              }
              className="block w-full h-[52px] rounded-2xl text-primary-fg text-[15px] font-extrabold shadow-[0_6px_14px_rgba(0,0,0,0.12)] flex items-center justify-center gap-2"
              style={{
                background:
                  "linear-gradient(135deg, var(--fl-primary), var(--fl-accent))",
              }}
            >
              {ctaLabel}
              {isExternal && (
                <ExternalLink size={16} strokeWidth={2.25} aria-hidden />
              )}
            </a>
          ) : (
            <div className="w-full h-[52px] rounded-2xl bg-muted text-muted-fg text-[15px] font-bold flex items-center justify-center">
              No ticket link yet
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Map an outbound ticket URL to a human provider name.
function providerFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    if (host.includes("ticketmaster") || host.endsWith("ticketm.net"))
      return "Ticketmaster";
    if (host.includes("eventbrite")) return "Eventbrite";
    if (host.includes("skiddle")) return "Skiddle";
    if (host.includes("dice.fm")) return "DICE";
    if (host.includes("universe")) return "Universe";
    return null;
  } catch {
    return null;
  }
}

function formatLongDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/London",
  });
}
