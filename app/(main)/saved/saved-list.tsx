"use client";

import Link from "next/link";
import Image from "next/image";
import { Heart } from "lucide-react";
import { VenueCard } from "@/components/venue-card";
import { useSaved } from "@/components/saved-context";
import { useBookings } from "@/components/bookings-context";
import type { Venue } from "@/lib/types";

// Anon never renders here — /saved gates anonymous visitors behind the wall
// (see saved/page.tsx). SavedList always has a signed-in user and the
// card-level catalogue.
export function SavedList({ allVenues }: { allVenues: Venue[] }) {
  const { savedSet } = useSaved();
  const { bookings } = useBookings();
  const saved = allVenues.filter((v) => savedSet.has(v.slug));

  // "Coming up" should only list reminders that haven't passed. Compare against
  // the start of today (so something earlier today still counts), and show the
  // soonest first. Past reminders drop off rather than lingering as "upcoming".
  // Resolve each reminder to its venue card HERE so the header count and the
  // rendered rows come from the same list — a booking whose venue has since
  // dropped out of the catalogue must not inflate "N planned" with no card.
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const upcoming = bookings
    .filter((b) => {
      const d = new Date(b.startsAt);
      return !Number.isNaN(d.getTime()) && d >= startOfToday;
    })
    .map((b) => ({ b, venue: allVenues.find((v) => v.slug === b.venueSlug) }))
    .filter((x): x is { b: (typeof bookings)[number]; venue: Venue } =>
      Boolean(x.venue),
    )
    .sort(
      (a, b) =>
        new Date(a.b.startsAt).getTime() - new Date(b.b.startsAt).getTime(),
    );

  // Past reminders → a "Been there" history (most recent first). Foundation for
  // a future "would you go back?" taste signal.
  const past = bookings
    .filter((b) => {
      const d = new Date(b.startsAt);
      return !Number.isNaN(d.getTime()) && d < startOfToday;
    })
    .map((b) => ({ b, venue: allVenues.find((v) => v.slug === b.venueSlug) }))
    .filter((x): x is { b: (typeof bookings)[number]; venue: Venue } =>
      Boolean(x.venue),
    )
    .sort(
      (a, b) =>
        new Date(b.b.startsAt).getTime() - new Date(a.b.startsAt).getTime(),
    );

  const hasBookings = upcoming.length > 0;
  const hasSaved = saved.length > 0;
  const hasPast = past.length > 0;
  const hasAnything = hasBookings || hasSaved || hasPast;
  const summaryLabel = summary(upcoming.length, saved.length);

  return (
    <div className="pt-4 pb-6">
      <header className="px-5 pb-3.5">
        <h1 className="text-[28px] font-extrabold tracking-tight text-primary">
          Your spots
        </h1>
        {summaryLabel && (
          <div className="text-xs text-muted-fg mt-0.5">{summaryLabel}</div>
        )}
      </header>

      {hasBookings && (
        <section className="px-5 pb-6">
          <h2 className="text-[11px] font-extrabold tracking-[0.12em] uppercase text-muted-fg mb-3">
            Coming up
          </h2>
          <div className="flex flex-col gap-2">
            {upcoming.map(({ b, venue }) => {
              return (
                <Link
                  key={b.id}
                  href={`/venue/${b.venueSlug}`}
                  className="flex items-center gap-3 p-3 rounded-2xl bg-card border border-border"
                >
                  <div className="relative w-14 h-14 rounded-xl overflow-hidden flex-shrink-0">
                    <Image
                      src={venue.imgUrl}
                      alt={venue.name}
                      fill
                      sizes="56px"
                      className="object-cover"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-extrabold text-heading truncate">
                      {venue.name}
                    </div>
                    <div className="text-[11px] text-muted-fg mt-0.5">
                      {b.dateLabel} · {b.slotLabel} · Party of {b.partySize}
                    </div>
                    <div className="text-[10px] text-muted-fg/70 mt-0.5 font-medium">
                      Your reminder
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {hasSaved && (
        <section className="px-5">
          {(hasBookings || hasPast) && (
            <h2 className="text-[11px] font-extrabold tracking-[0.12em] uppercase text-muted-fg mb-3">
              Saved spots
            </h2>
          )}
          <div className="grid grid-cols-2 gap-3">
            {saved.map((v) => (
              <VenueCard key={v.id} venue={v} variant="wide" />
            ))}
          </div>
        </section>
      )}

      {hasPast && (
        <section className="px-5 pt-6">
          <h2 className="text-[11px] font-extrabold tracking-[0.12em] uppercase text-muted-fg mb-3">
            Been there
          </h2>
          <div className="flex flex-col gap-2">
            {past.map(({ b, venue }) => {
              return (
                <Link
                  key={b.id}
                  href={`/venue/${b.venueSlug}`}
                  className="flex items-center gap-3 p-3 rounded-2xl bg-card border border-border opacity-75"
                >
                  <div className="relative w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 grayscale">
                    <Image
                      src={venue.imgUrl}
                      alt={venue.name}
                      fill
                      sizes="56px"
                      className="object-cover"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-extrabold text-heading truncate">
                      {venue.name}
                    </div>
                    <div className="text-[11px] text-muted-fg mt-0.5">
                      {b.dateLabel} · Party of {b.partySize}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {!hasAnything && (
        <div className="mx-5 mt-5 p-6 rounded-2xl bg-card border border-border text-center">
          <Heart
            className="w-9 h-9 text-muted-fg mx-auto"
            strokeWidth={1.75}
            aria-hidden
          />
          <h2 className="text-sm font-extrabold text-heading mt-2">
            Nothing saved yet
          </h2>
          <p className="text-xs text-muted-fg mt-1">
            Tap the heart on any place. Go on, be fussy.
          </p>
        </div>
      )}
    </div>
  );
}

function summary(bookings: number, saved: number): string {
  const parts: string[] = [];
  if (bookings > 0) parts.push(`${bookings} planned`);
  if (saved > 0) parts.push(`${saved} saved`);
  return parts.join(" · ");
}
