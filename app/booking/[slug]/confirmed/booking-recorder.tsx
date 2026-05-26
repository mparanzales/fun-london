"use client";

// Records the booking into the BookingsProvider on mount. Renders nothing.
// Lives in its own client component so the page stays a Server Component.
//
// Idempotent: BookingsProvider.addBooking is a no-op if `id` already exists,
// so refreshing the confirmation page or navigating back doesn't duplicate.

import { useEffect } from "react";
import { useBookings } from "@/components/bookings-context";
import { MOCK_USER } from "@/lib/mock-data";

type Props = {
  id: string;
  venueId: string;
  venueSlug: string;
  partySize: number;
  slotLabel: string;
};

export function BookingRecorder({
  id,
  venueId,
  venueSlug,
  partySize,
  slotLabel,
}: Props) {
  const { addBooking } = useBookings();

  useEffect(() => {
    addBooking({
      id,
      userId: MOCK_USER.id,
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
  }, [id, venueId, venueSlug, partySize, slotLabel, addBooking]);

  return null;
}
