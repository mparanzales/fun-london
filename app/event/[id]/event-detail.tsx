"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ExternalLink, Calendar, Clock } from "lucide-react";
import { EventActions } from "@/components/event-actions";
import { applyAffiliate } from "@/lib/affiliate";
import { track } from "@/lib/analytics";
import type { Event, Venue } from "@/lib/types";

// Event detail — full-screen immersive layout, mirrors the venue
// detail composition so taps on /events land in the same visual
// language as taps on /explore.
//
// Composition (top → bottom):
//   • Hero image (4:3) with floating Back button
//   • Info block: eyebrow (venue area · category), h1 event name,
//     venue name, date + time row
//   • Quick-fact pill row (date, time, price)
//   • Optional venue link card (so user can dig deeper into the venue
//     curation context before buying tickets)
//   • Sticky bottom CTA: Reserve → opens ticket page in new tab

export function EventDetail({
  event,
  venue,
}: {
  event: Event;
  venue: Venue | null;
}) {
  const router = useRouter();

  const isPopup = event.isPopup;
  const isExternal = !!event.sourceUrl && event.sourceUrl.startsWith("http");
  // Pop-ups run over a range, so the headline date is when they END.
  const longDateLabel =
    isPopup && event.endsAt
      ? `Ends ${formatLongDate(event.endsAt)}`
      : formatLongDate(event.startsAt);
  const eyebrow = isPopup
    ? `Pop-up · ${event.area}`
    : `${event.area} · ${event.category}`;
  // Name the ticket provider from the outbound URL's host so the CTA is
  // always accurate — today it's Ticketmaster, but Eventbrite / Skiddle /
  // DICE / Universe links will label themselves correctly with no schema
  // or type change the moment those sources come online.
  const ticketProvider = providerFromUrl(event.sourceUrl);
  // Pop-ups aren't ticketed: the CTA visits the official page, and we don't
  // tag it with the ticket affiliate.
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

        {/* Bare back icon (no circle) — matches the Explore icon language
            and the venue detail hero. White + drop shadow for legibility
            on any photo in both themes. */}
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
      <div className="px-5 pt-5">
        <div className="text-[11px] font-extrabold tracking-[0.12em] uppercase text-muted-fg">
          {eyebrow}
        </div>
        <h1 className="text-[28px] font-extrabold tracking-tight text-heading leading-tight mt-1.5">
          {event.name}
        </h1>
        <div className="text-base font-semibold text-fg mt-2">
          {event.venueName}
        </div>

        {/* Quick facts pills — date + time + price */}
        <div className="flex flex-wrap gap-2 mt-5">
          <span className="flex items-center gap-1.5 border border-fg/15 rounded-full px-3 py-1.5 text-xs font-medium text-fg">
            <Calendar size={13} strokeWidth={2} />
            {longDateLabel}
          </span>
          {/* A pop-up's "Until X" duplicates the "Ends X" above, so hide it. */}
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

        {/* Editorial blurb — the "what is this" detail. */}
        {event.description && (
          <p className="text-[15px] text-fg/90 leading-relaxed mt-5">
            {event.description}
          </p>
        )}

        {/* Real secondary actions — add to calendar (.ics) + share */}
        <EventActions event={event} />

        {/* ── Optional venue link card ──────────────────────────────
            Surfaces when the event has a linked venue we curate.
            Lets the user dig into the venue's Real Talk + Why-this-
            is-here before deciding on tickets. */}
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
      </div>

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

// Map an outbound ticket URL to a human provider name. Returns null when
// the host isn't one we recognise (CTA then reads a neutral "Get tickets").
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

// "Friday 26 June" — long-form for the event detail eyebrow.
function formatLongDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/London",
  });
}
