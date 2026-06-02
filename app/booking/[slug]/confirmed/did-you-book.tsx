"use client";

// "Did you book?" — the page the app lands on after the user is handed off
// to the venue's booking site. If they booked, we log a REAL booking (with
// the date/time/party they chose) so it shows in Saved → "Coming up". If
// not, no phantom record is created.

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check } from "lucide-react";
import { useBookings } from "@/components/bookings-context";
import { track } from "@/lib/analytics";
import type { Venue } from "@/lib/types";

function deriveDateLabel(d: Date): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  const diff = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff > 1 && diff < 7)
    return d.toLocaleDateString("en-GB", { weekday: "long" });
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h)) return hhmm;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

export function DidYouBook({
  venue,
  date,
  time,
  party,
}: {
  venue: Venue;
  date: string;
  time: string;
  party: number;
}) {
  const router = useRouter();
  const { addBooking } = useBookings();
  const [saved, setSaved] = useState(false);

  // Guard against a malformed ?d=/?t= producing an Invalid Date — calling
  // .toISOString() on one throws, and this route has no error boundary.
  const parsed = date && time ? new Date(`${date}T${time}:00`) : new Date();
  const startsAt = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const dateLabel = deriveDateLabel(startsAt);
  const slotLabel = time ? formatTime(time) : "";

  const onYes = () => {
    // Internal record id only — NOT a venue reservation reference. Prefixed
    // "self-" so it can never be mistaken for a confirmation code, and never
    // shown to the user as one (see saved-list.tsx).
    const id = `self-${venue.slug}-${startsAt.getTime()}`;
    addBooking({
      id,
      userId: "",
      venueId: venue.id,
      venueSlug: venue.slug,
      partySize: party,
      startsAt: startsAt.toISOString(),
      // We did not make or verify this booking — the user self-reported it.
      status: "self_added",
      notes: null,
      createdAt: new Date().toISOString(),
      dateLabel,
      slotLabel,
    });
    track("booking_self_logged", { venue: venue.slug, party });
    setSaved(true);
  };

  return (
    <div className="max-w-md mx-auto min-h-screen bg-bg pb-10">
      <div className="px-5 pt-4">
        <Link
          href={`/venue/${venue.slug}`}
          aria-label="Back"
          className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-fg/5 text-fg"
        >
          <ArrowLeft className="w-5 h-5" strokeWidth={2} />
        </Link>
      </div>

      {/* Venue card */}
      <div className="mx-5 mt-4 flex items-center gap-3 p-3 rounded-2xl bg-card border border-border">
        <div className="relative w-16 h-16 rounded-xl overflow-hidden flex-shrink-0">
          <Image
            src={venue.imgUrl}
            alt={venue.name}
            fill
            sizes="64px"
            unoptimized={venue.imgUrl.includes("googleapis.com")}
            className="object-cover"
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-extrabold text-heading truncate">
            {venue.name}
          </div>
          <div className="text-xs text-muted-fg mt-0.5">
            {dateLabel}
            {slotLabel ? ` · ${slotLabel}` : ""} · Party of {party}
          </div>
        </div>
      </div>

      {!saved ? (
        <div className="px-5 mt-8 text-center">
          <h1 className="text-2xl font-extrabold text-heading leading-tight">
            Did you book it?
          </h1>
          <p className="text-sm text-muted-fg mt-2 leading-relaxed">
            If you grabbed the table on {venue.name}&apos;s booking page, add it
            to your plans and we&apos;ll keep it in{" "}
            <span className="font-semibold text-fg">Coming up</span>.
          </p>
          <div className="mt-7 flex flex-col gap-2.5">
            <button
              type="button"
              onClick={onYes}
              className="w-full h-[52px] rounded-2xl bg-primary text-white font-extrabold text-[15px]"
            >
              Yes, add it to my plans
            </button>
            <button
              type="button"
              onClick={() => router.push(`/venue/${venue.slug}`)}
              className="w-full h-12 rounded-2xl border border-fg/15 text-fg font-semibold text-sm"
            >
              Not yet
            </button>
          </div>
        </div>
      ) : (
        <div className="px-5 mt-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
            <Check className="w-8 h-8 text-primary" strokeWidth={3} />
          </div>
          <h1 className="text-2xl font-extrabold text-heading">
            Added to your plans 🎉
          </h1>
          <p className="text-sm text-muted-fg mt-2">
            {dateLabel}
            {slotLabel ? ` · ${slotLabel}` : ""}, party of {party}.
          </p>
          <p className="text-xs text-muted-fg/80 mt-2 leading-relaxed">
            Your confirmation comes from {venue.name}, since that&apos;s where
            you booked. We&apos;ve saved this here so you don&apos;t forget.
          </p>
          <div className="mt-7 flex flex-col gap-2.5">
            <Link
              href="/saved"
              className="w-full h-[52px] rounded-2xl bg-primary text-white font-extrabold text-[15px] flex items-center justify-center"
            >
              See it in Coming up
            </Link>
            <Link
              href="/explore"
              className="w-full h-12 rounded-2xl border border-fg/15 text-fg font-semibold text-sm flex items-center justify-center"
            >
              Back to exploring
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
