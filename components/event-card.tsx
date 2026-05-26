import Image from "next/image";
import type { Event } from "@/lib/types";

type Props = {
  event: Event;
  /**
   * Hide the category pill on the photo. Use `false` for single-category
   * sections (e.g. all Music events) where the tag adds no information.
   */
  showCategoryTag?: boolean;
};

export function EventCard({ event, showCategoryTag = true }: Props) {
  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="relative h-[130px] w-full">
        <Image
          src={event.imgUrl}
          alt={event.name}
          fill
          sizes="(max-width: 640px) 100vw, 400px"
          className="object-cover"
        />
        {showCategoryTag && (
          <div className="absolute top-3 left-3 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-white text-xs font-medium uppercase tracking-wider">
            {event.category}
          </div>
        )}
      </div>
      <div className="p-3.5">
        <h3 className="text-[15px] font-extrabold text-heading leading-tight">
          {event.name}
        </h3>
        <div className="text-[11px] text-muted-fg mt-1">{event.venueName}</div>
        <div className="flex items-center gap-2 mt-2 text-[11px] text-fg font-semibold">
          <span>{event.area}</span>
          <span className="text-muted-fg">·</span>
          <span>🕒 {event.timeLabel}</span>
          <span className="text-muted-fg">·</span>
          <span>{event.price}</span>
        </div>
      </div>
    </div>
  );
}
