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
};

export function EventCard({ event, showCategoryTag = true }: Props) {
  // Internal link to the immersive event detail. From there the user
  // can read venue context, then tap the sticky Reserve CTA that opens
  // the provider's ticket page in a new tab.
  const href = `/event/${event.id}`;

  return (
    <Link
      href={href}
      aria-label={`View details for ${event.name}`}
      className="relative block w-full"
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
          className="object-cover group-hover:scale-105 transition-transform duration-500"
        />
        {/* Bottom gradient for legibility of any future title overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />

        {showCategoryTag && (
          <div className="absolute top-3 left-3 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-white text-xs font-medium uppercase tracking-wider">
            {event.category}
          </div>
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
          <span>{formatEventDate(event.startsAt)}</span>
          <span>·</span>
          <span>{event.timeLabel}</span>
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
