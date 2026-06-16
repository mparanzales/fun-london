import Image from "next/image";
import Link from "next/link";
import type { Event } from "@/lib/types";

type Props = {
  event: Event;
  /**
   * Hide the category pill on the photo. Use `false` for single-category
   * sections (e.g. a "Music" filtered view) where the tag adds no
   * information.
   */
  showCategoryTag?: boolean;
  /**
   * Mark this card's image as the LCP candidate (above the fold) so Next
   * eager-loads it. Set on the first card of a feed only.
   */
  priority?: boolean;
};

export function EventCard({
  event,
  showCategoryTag = true,
  priority = false,
}: Props) {
  // Every card opens the internal detail page (events and pop-ups alike), so
  // the user reads the full context there before tapping out to the official
  // page or ticket provider.
  const href = `/event/${event.id}`;

  return (
    <Link
      href={href}
      aria-label={
        event.isPopup
          ? `View the pop-up ${event.name}`
          : `View details for ${event.name}`
      }
      className="relative block w-full transition-transform duration-300 ease-out lg:hover:-translate-y-1"
      // See VenueCard: don't prefetch every card's dynamic detail page.
      prefetch={false}
    >
      <div
        className="relative w-full rounded-2xl overflow-hidden shadow-card group"
        style={{ aspectRatio: "16/12" }}
      >
        <Image
          src={event.imgUrl}
          alt={event.name}
          fill
          sizes="(max-width: 640px) 100vw, 400px"
          priority={priority}
          className="object-cover group-hover:scale-105 transition-transform duration-500"
        />
        {/* Bottom gradient for legibility of any future title overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />

        {event.isPopup ? (
          // Pop-ups get a solid accent pill so they read as time-limited,
          // not as a regular gig.
          <div className="absolute top-3 left-3 px-3 py-1 rounded-full bg-accent text-white text-xs font-semibold uppercase tracking-wider shadow-sm">
            Pop-up
          </div>
        ) : (
          showCategoryTag && (
            <div className="absolute top-3 left-3 px-3 py-1 rounded-full bg-black/35 backdrop-blur-md border border-white/20 text-white text-xs font-medium uppercase tracking-wider">
              {event.category}
            </div>
          )
        )}
      </div>

      <div className="pt-2 pl-0.5 pr-0.5">
        <div className="text-[14px] font-extrabold text-heading leading-tight">
          {event.name}
        </div>
        <div className="text-[11px] text-muted-fg mt-0.5 flex items-center gap-1.5">
          <span className="font-semibold text-fg">{event.venueName}</span>
          <span>·</span>
          <span>{event.area}</span>
        </div>
        <div className="text-[11px] font-medium text-muted-fg mt-1 flex items-center gap-1.5 flex-wrap">
          {event.isPopup && event.endsAt ? (
            // For a pop-up, the urgent info is when it ends.
            <span className="font-semibold text-accent">
              Ends {formatEventDate(event.endsAt)}
            </span>
          ) : (
            <>
              <span>{formatEventDate(event.startsAt)}</span>
              <span>·</span>
              <span>{event.timeLabel}</span>
            </>
          )}
          <span>·</span>
          <span>{event.price}</span>
        </div>
      </div>
    </Link>
  );
}

// "Fri 26 Jun" — short weekday + day + short month. Locale-aware so we
// pick up British conventions automatically.
function formatEventDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Europe/London",
  });
}
