"use client";

// "Did you book?" — the honest booking producer (Epic H part 2).
//
// Fun London is an aggregator: the real reservation happens on the venue's
// own platform (OpenTable / their site / phone), which we deep-link to. So
// the only HONEST booking is one the user tells us they actually made. This
// little panel, shown under the Reserve button on reservable venues, lets
// them log it — date, time, party — which writes a real booking via
// useBookings (DB when signed in, localStorage when anon) and surfaces it in
// Saved → "Coming up". No more phantom bookings.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, Check } from "lucide-react";
import { useBookings } from "@/components/bookings-context";
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
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

export function BookingLogger({ venue }: { venue: Venue }) {
  const router = useRouter();
  const { addBooking } = useBookings();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);

  const today = new Date();
  const [date, setDate] = useState(() => today.toISOString().slice(0, 10));
  const [time, setTime] = useState("20:00");
  const [party, setParty] = useState(2);

  const onSave = () => {
    const startsAt = new Date(`${date}T${time}:00`);
    const ref = `${venue.slug.slice(0, 3).toUpperCase()}-${Math.floor(Math.random() * 9000) + 1000}`;
    addBooking({
      id: ref,
      userId: "",
      venueId: venue.id,
      venueSlug: venue.slug,
      partySize: party,
      startsAt: startsAt.toISOString(),
      status: "confirmed",
      notes: null,
      createdAt: new Date().toISOString(),
      dateLabel: deriveDateLabel(startsAt),
      slotLabel: formatTime(time),
    });
    setDone(true);
  };

  if (done) {
    return (
      <div className="mt-7 rounded-2xl border border-border bg-card p-4 flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
          <Check className="w-5 h-5 text-primary" strokeWidth={2.5} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-extrabold text-heading">
            Added to your plans
          </div>
          <button
            type="button"
            onClick={() => router.push("/saved")}
            className="text-[12px] font-semibold text-primary mt-0.5"
          >
            See it in Saved → Coming up
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-7">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-fg/15 text-sm font-semibold text-fg"
        >
          <CalendarCheck className="w-4 h-4" strokeWidth={2} />
          Booked a table? Add it to your plans
        </button>
      ) : (
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="text-[11px] font-extrabold tracking-[0.12em] uppercase text-muted-fg mb-3">
            Log your booking
          </div>
          <div className="flex gap-2">
            <label className="flex-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-fg mb-1">
                Date
              </div>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full h-10 rounded-xl bg-bg border border-border px-3 text-fg text-[13px]"
              />
            </label>
            <label className="w-28">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-fg mb-1">
                Time
              </div>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full h-10 rounded-xl bg-bg border border-border px-3 text-fg text-[13px]"
              />
            </label>
          </div>
          <div className="flex items-center justify-between mt-3">
            <div className="text-[13px] font-semibold text-fg">Party size</div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                aria-label="Fewer"
                onClick={() => setParty((p) => Math.max(1, p - 1))}
                className="w-8 h-8 rounded-full border border-border text-fg text-lg leading-none"
              >
                −
              </button>
              <span className="w-5 text-center text-sm font-extrabold text-fg">
                {party}
              </span>
              <button
                type="button"
                aria-label="More"
                onClick={() => setParty((p) => Math.min(20, p + 1))}
                className="w-8 h-8 rounded-full border border-border text-fg text-lg leading-none"
              >
                +
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={onSave}
            className="w-full mt-4 h-11 rounded-xl bg-primary text-white text-sm font-extrabold"
          >
            Add to my plans
          </button>
        </div>
      )}
    </div>
  );
}
