"use client";

// Records the booking into the BookingsProvider on mount. Renders nothing.
// Lives in its own client component so the page stays a Server Component.
//
// Idempotent: BookingsProvider.addBooking is a no-op if `id` already exists,
// so refreshing the confirmation page or navigating back doesn't duplicate.

import { useEffect } from "react";
import { useBookings } from "@/components/bookings-context";

type Props = {
  id: string;
  authUserId: string | null;
  venueId: string;
  venueSlug: string;
  partySize: number;
  slotLabel: string;
};

export function BookingRecorder({
  id,
  authUserId,
  venueId,
  venueSlug,
  partySize,
  slotLabel,
}: Props) {
  const { addBooking } = useBookings();

  useEffect(() => {
    // userId is purely a local stamp here — BookingsProvider routes the
    // actual DB write via its own authUserId prop. Anonymous bookings
    // get empty string; signed-in bookings get the real auth uuid.
    addBooking({
      id,
      userId: authUserId ?? "",
      venueId,
      venueSlug,
      partySize,
      startsAt: new Date().toISOString(),
      status: "confirmed",
      notes: null,
      createdAt: new Date().toISOString(),
      dateLabel: "Today",
      slotLabel,
    });
  }, [id, authUserId, venueId, venueSlug, partySize, slotLabel, addBooking]);

  return null;
}
