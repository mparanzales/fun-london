"use client";

// Client-side bookings state. Mirrors saved-context.tsx exactly. Each
// booking is recorded when /booking/[slug]/confirmed renders and shows
// up on /saved under "Coming up".
//
// Persists to localStorage under "fl.bookings.v1". Idempotent on id so
// navigating back to the confirmation URL never duplicates a booking.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Booking } from "@/lib/types";

const STORAGE_KEY = "fl.bookings.v1";

// Local-storage payload extends the canonical Booking with two display
// caches (dateLabel, slotLabel). When Supabase ships, these become
// computed from `startsAt` + locale at render time; until then the
// confirmation page captures them at booking time.
export type StoredBooking = Booking & {
  dateLabel: string;
  slotLabel: string;
  venueSlug: string;
};

type BookingsContextValue = {
  bookings: StoredBooking[];
  addBooking: (b: StoredBooking) => void;
  removeBooking: (id: string) => void;
  hasBooking: (id: string) => boolean;
  count: number;
};

const BookingsContext = createContext<BookingsContextValue | null>(null);

export function BookingsProvider({ children }: { children: React.ReactNode }) {
  const [bookings, setBookings] = useState<StoredBooking[]>([]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw) as StoredBooking[];
      if (!Array.isArray(arr)) return;
      // Merge, don't replace. A child component (e.g. BookingRecorder on
      // /booking/[slug]/confirmed) can call addBooking from its own mount
      // effect, which runs BEFORE this hydrate effect (React fires child
      // effects before parent effects). A naive setBookings(arr) here
      // would discard that just-added booking. We dedupe by id (current
      // session wins on conflict) and resort newest-first by createdAt.
      setBookings((prev) => {
        const map = new Map<string, StoredBooking>();
        for (const b of arr) map.set(b.id, b);
        for (const b of prev) map.set(b.id, b);
        return [...map.values()].sort((a, b) =>
          b.createdAt.localeCompare(a.createdAt),
        );
      });
    } catch {
      // localStorage unavailable or corrupted, keep empty seed.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bookings));
    } catch {
      // ignore quota / privacy mode
    }
  }, [bookings]);

  const addBooking = useCallback((b: StoredBooking) => {
    setBookings((prev) => {
      if (prev.some((x) => x.id === b.id)) return prev;
      return [b, ...prev];
    });
  }, []);

  const removeBooking = useCallback((id: string) => {
    setBookings((prev) => prev.filter((b) => b.id !== id));
  }, []);

  const value = useMemo<BookingsContextValue>(
    () => ({
      bookings,
      addBooking,
      removeBooking,
      hasBooking: (id) => bookings.some((b) => b.id === id),
      count: bookings.length,
    }),
    [bookings, addBooking, removeBooking],
  );

  return (
    <BookingsContext.Provider value={value}>
      {children}
    </BookingsContext.Provider>
  );
}

export function useBookings(): BookingsContextValue {
  const ctx = useContext(BookingsContext);
  if (!ctx)
    throw new Error("useBookings must be used inside <BookingsProvider>");
  return ctx;
}
