"use client";
import { useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { Heart } from "lucide-react";
import { useSaved } from "@/components/saved-context";
import { recordSignal, type SignalSurface } from "@/lib/signals";
import { sizedImageUrl } from "@/lib/img";
import type { Venue } from "@/lib/types";

type Props = {
  venue: Venue;
  variant?: "tall" | "wide";
  /**
   * Hide the category pill on the photo. Use `false` for single-category
   * sections (e.g. "Eats" filter) where the tag adds no information.
   */
  showCategoryTag?: boolean;
  /**
   * Mark this card's image as the LCP candidate (above the fold) so Next
   * eager-loads it. Set on the first card of a feed only — Next warns if the
   * largest-paint image isn't prioritised.
   */
  priority?: boolean;
  /**
   * Optional walk-time / distance label shown in the meta line, e.g. when the
   * feed is sorted by "nearest first".
   */
  distanceLabel?: string;
  /**
   * Which surface this card is shown on — attached to the Kind C `open` /
   * `impression` / `save` signals so the engine knows where a tap happened.
   */
  surface?: SignalSurface;
};

export function VenueCard({
  venue,
  variant = "tall",
  showCategoryTag = true,
  priority = false,
  distanceLabel,
  surface = "feed",
}: Props) {
  const { isSaved, toggleSaved } = useSaved();
  const saved = isSaved(venue.slug);

  // Kind C `impression` (step 0.4): fire once, when ≥50% of the card first
  // enters the viewport. Fire-and-forget + signed-in-gated inside recordSignal.
  const rootRef = useRef<HTMLDivElement>(null);
  const impressed = useRef(false);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || impressed.current) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !impressed.current) {
          impressed.current = true;
          recordSignal("impression", { surface, venueId: venue.id });
          io.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [surface, venue.id]);

  const onHeart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    toggleSaved(venue.slug, surface);
  };

  // `open` (step 0.4): the user tapped into the venue detail from this surface.
  const onOpen = () => recordSignal("open", { surface, venueId: venue.id });

  // Request a card-sized source from the CDN instead of the full-res photo.
  // The optimizer is off (unoptimized: true), so without this every card pulls
  // a multi-thousand-px JPEG. `tall` renders ~170px wide, `wide` up to ~50vw;
  // these widths cover a 2× DPR display. Non-resizable hosts pass through.
  const imgWidth = variant === "tall" ? 384 : 512;
  const imgSrc = sizedImageUrl(venue.imgUrl, imgWidth);

  // The whole card is wrapped in a Link to /venue/[slug]. The heart
  // button is rendered INSIDE the link's positioned ancestor but its
  // onHeart handler calls e.preventDefault() to suppress navigation when
  // the user taps the heart icon specifically.
  return (
    <div
      ref={rootRef}
      className={
        "transition-transform duration-300 ease-out lg:hover:-translate-y-1 " +
        (variant === "tall"
          ? "relative block w-[170px] flex-shrink-0"
          : "relative block w-full")
      }
    >
      <Link
        href={`/venue/${venue.slug}`}
        aria-label={`View ${venue.name}`}
        onClick={onOpen}
        className="block"
        // Don't prefetch: a feed of 24+ cards would each fire a full RSC
        // prefetch of a DYNAMIC detail page (~1.5s server render apiece),
        // congesting the network + server. The detail loads on tap instead.
        prefetch={false}
      >
        <div
          className="relative w-full rounded-2xl overflow-hidden shadow-card group"
          style={{ aspectRatio: variant === "tall" ? "3/4" : "16/12" }}
        >
          <Image
            src={imgSrc}
            alt={venue.name}
            fill
            sizes={
              variant === "tall" ? "170px" : "(max-width: 640px) 50vw, 240px"
            }
            // Google Places photo URLs 302-redirect with a per-request
            // API key; bypass Vercel's optimizer for those so we don't
            // burn the optimization quota on rerenderable proxies.
            unoptimized={venue.imgUrl.includes("googleapis.com")}
            priority={priority}
            className="object-cover group-hover:scale-105 transition-transform duration-500"
          />
          {/* Bottom gradient for any future title overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />

          {showCategoryTag && (
            <div className="absolute top-3 left-3 px-3 py-1 rounded-full bg-black/35 backdrop-blur-md border border-white/20 text-white text-xs font-medium uppercase tracking-wider">
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
            {distanceLabel && (
              <>
                <span>·</span>
                <span className="text-primary font-semibold">
                  {distanceLabel}
                </span>
              </>
            )}
          </div>
          <div className="text-[11px] italic text-fg/75 mt-1 truncate">
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
        className="absolute top-1.5 right-1.5 w-11 h-11 flex items-center justify-center cursor-pointer z-10"
      >
        <Heart
          size={22}
          strokeWidth={2}
          // key remounts the icon when `saved` flips so fl-pop replays on
          // each save; the class is only present when saved, so unsave
          // doesn't celebrate.
          key={saved ? "saved" : "unsaved"}
          className={
            "drop-shadow-md " +
            (saved
              ? "fl-pop fill-primary text-primary"
              : "fill-none text-white")
          }
        />
      </button>
    </div>
  );
}
