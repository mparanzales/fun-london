"use client";

import Link from "next/link";
import Image from "next/image";
import { VenueCard } from "@/components/venue-card";
import { useSaved } from "@/components/saved-context";
import { useBookings } from "@/components/bookings-context";
import type { Venue } from "@/lib/types";

export function SavedList({
  allVenues,
  isAnon = false,
}: {
  allVenues: Venue[];
  isAnon?: boolean;
}) {
  const { savedSet } = useSaved();
  const { bookings } = useBookings();
  const saved = allVenues.filter((v) => savedSet.has(v.slug));

  // "Coming up" should only list reminders that haven't passed. Compare against
  // the start of today (so something earlier today still counts), and show the
  // soonest first. Past reminders drop off rather than lingering as "upcoming".
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const upcoming = bookings
    .filter((b) => {
      const d = new Date(b.startsAt);
      return !Number.isNaN(d.getTime()) && d >= startOfToday;
    })
    .sort(
      (a, b) =>
        new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
    );

  const hasBookings = upcoming.length > 0;
  const hasSaved = saved.length > 0;
  const hasAnything = hasBookings || hasSaved;
  // Warn anonymous users that anything here lives only in this browser.
  const showAnonWarning = isAnon && hasAnything;

  return (
    <div className="pt-4 pb-6">
      <header className="px-5 pb-3.5">
        <h1 className="text-[28px] font-extrabold tracking-tight text-primary">
          Your spots
        </h1>
        {hasAnything && (
          <div className="text-xs text-muted-fg mt-0.5">
            {summary(upcoming.length, saved.length)}
          </div>
        )}
      </header>

      {showAnonWarning && (
        <div className="px-5 pb-4">
          <div className="rounded-2xl border border-accent/40 bg-accent/10 px-4 py-3.5 flex items-start gap-3">
            <span className="text-lg leading-none mt-0.5">📌</span>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-extrabold text-heading">
                Saved on this device only
              </div>
              <p className="text-[12px] text-muted-fg mt-0.5 leading-relaxed">
                Sign in to keep your spots safe and reach them from any device.
                Clearing your browser would lose them.
              </p>
              <Link
                href="/sign-in?return=/saved"
                className="inline-block mt-2 text-[12px] font-extrabold text-primary no-underline"
              >
                Sign in to save them →
              </Link>
            </div>
          </div>
        </div>
      )}

      {hasBookings && (
        <section className="px-5 pb-6">
          <h2 className="text-[11px] font-extrabold tracking-[0.12em] uppercase text-muted-fg mb-3">
            Coming up
          </h2>
          <div className="flex flex-col gap-2">
            {upcoming.map((b) => {
              const venue = allVenues.find((v) => v.slug === b.venueSlug);
              if (!venue) return null;
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
          {hasBookings && (
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

      {!hasAnything && (
        <div className="mx-5 mt-5 p-6 rounded-2xl bg-card border border-border text-center">
          <div className="text-3xl">💛</div>
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
