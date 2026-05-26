"use client";
import Image from "next/image";
import Link from "next/link";
import { Heart } from "lucide-react";
import { useSaved } from "@/components/saved-context";
import type { Venue } from "@/lib/types";

type Props = {
  venue: Venue;
  variant?: "tall" | "wide";
  /**
   * Hide the category pill on the photo. Use `false` for single-category
   * sections (e.g. "Eats" filter) where the tag adds no information.
   */
  showCategoryTag?: boolean;
};

export function VenueCard({
  venue,
  variant = "tall",
  showCategoryTag = true,
}: Props) {
  const { isSaved, toggleSaved } = useSaved();
  const saved = isSaved(venue.slug);

  const onHeart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    toggleSaved(venue.slug);
  };

  // The whole card is wrapped in a Link to /venue/[slug]. The heart
  // button is rendered INSIDE the link's positioned ancestor but its
  // onHeart handler calls e.preventDefault() to suppress navigation when
  // the user taps the heart icon specifically.
  return (
    <div
      className={
        variant === "tall"
          ? "relative block w-[170px] flex-shrink-0"
          : "relative block w-full"
      }
    >
      <Link
        href={`/venue/${venue.slug}`}
        aria-label={`View ${venue.name}`}
        className="block"
      >
        <div
          className="relative w-full rounded-2xl overflow-hidden shadow-card group"
          style={{ aspectRatio: variant === "tall" ? "3/4" : "16/12" }}
        >
          <Image
            src={venue.imgUrl}
            alt={venue.name}
            fill
            sizes={
              variant === "tall" ? "170px" : "(max-width: 640px) 50vw, 240px"
            }
            className="object-cover group-hover:scale-105 transition-transform duration-500"
          />
          {/* Bottom gradient for any future title overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />

          {showCategoryTag && (
            <div className="absolute top-3 left-3 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-white text-xs font-medium uppercase tracking-wider">
              {venue.type}
            </div>
          )}
        </div>

        <div className="pt-2 pl-0.5 pr-0.5">
          <div className="text-[13px] font-extrabold text-heading leading-tight truncate">
            {venue.name}
          </div>
          <div className="text-[10.5px] text-muted-fg mt-0.5 flex items-center gap-1.5">
            <span>{venue.neighbourhood}</span>
            <span>·</span>
            <span>{venue.price}</span>
          </div>
          <div className="text-[11px] font-normal text-muted-fg/70 mt-0.5 truncate">
            {venue.vibe}
          </div>
        </div>
      </Link>

      {/* Heart button is a sibling of the Link, absolutely positioned
          inside the same relative parent. preventDefault on its handler
          suppresses any bubbled navigation. */}
      <button
        onClick={onHeart}
        aria-label={saved ? "Unsave" : "Save"}
        className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center cursor-pointer z-10"
      >
        <Heart
          size={22}
          strokeWidth={1.75}
          className={
            "drop-shadow-md " +
            (saved ? "fill-primary text-primary" : "fill-none text-white")
          }
        />
      </button>
    </div>
  );
}
