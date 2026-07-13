"use client";

// Bookings state. Same dual-mode pattern as saved-context.tsx:
//   • Anonymous — localStorage `fl.bookings.v1` (full StoredBooking
//     objects so display labels survive a refresh).
//   • Signed in — public.bookings via the browser Supabase client.
//     The DB stores the canonical Booking shape (no display labels);
//     we JOIN venues and recompute slot/date labels at read time.
//
// On first mount as signed-in, any leftover local bookings get
// migrated (slug→uuid resolved against the venues table), then
// localStorage is cleared. Migration is FK-safe (rows with unknown
// slugs are dropped) and idempotent (id is the booking ref, so
// re-running is safe under upsert).
//
// State stays as `StoredBooking[]` in memory so /saved's "Coming up"
// section doesn't care whether the data came from localStorage or DB.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createClient } from "@/lib/supabase/client";
import type { Booking } from "@/lib/types";
import { isSignOutTransition } from "@/lib/auth-transition";

const STORAGE_KEY = "fl.bookings.v1";

// Local-storage payload extends the canonical Booking with display
// caches (dateLabel, slotLabel, venueSlug). The DB row has no display
// caches — slotLabel comes from the venue.next_slot_label join.
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

function deriveDateLabel(startsAt: string): string {
  const d = new Date(startsAt);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayDiff = Math.round(
    (new Date(d.toDateString()).getTime() - today.getTime()) / 86_400_000,
  );
  if (dayDiff === 0) return "Today";
  if (dayDiff === 1) return "Tomorrow";
  if (dayDiff > 1 && dayDiff < 7)
    return d.toLocaleDateString("en-GB", { weekday: "long" });
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function BookingsProvider({
  children,
  authUserId,
}: {
  children: React.ReactNode;
  authUserId: string | null;
}) {
  const [bookings, setBookings] = useState<StoredBooking[]>([]);
  const slugToUuidRef = useRef<Map<string, string>>(new Map());
  // Gate the anon persist effect until the first hydrate read (same race the
  // saved-context had: an empty initial write would clobber stored bookings on
  // a hard reload).
  const [hydrated, setHydrated] = useState(false);
  // Mirror of live bookings so add/remove can revert precisely on DB error.
  const bookingsRef = useRef(bookings);
  useEffect(() => {
    bookingsRef.current = bookings;
  }, [bookings]);
  // Previous authUserId, so the hydrate effect can spot the signed-in →
  // signed-out transition. Initialised to the current value so a normal
  // anonymous FIRST mount is never mistaken for a sign-out.
  const prevAuthUserIdRef = useRef(authUserId);

  // ── Hydrate (and migrate if newly signed in) ────────────────────────
  useEffect(() => {
    let cancelled = false;

    // On sign-out (uuid → null) reset local state. The anon branch below
    // MERGES localStorage into the current in-memory list, so without this it
    // would keep the just-signed-out account's bookings (localStorage was
    // emptied on that account's sign-in migration, line ~166), persist them
    // back, and migrate them into the NEXT account on a shared browser. Gated
    // on the transition so a genuine anonymous mount keeps its bookings.
    const signedOut = isSignOutTransition(
      prevAuthUserIdRef.current,
      authUserId,
    );
    prevAuthUserIdRef.current = authUserId;
    if (signedOut) {
      setBookings([]);
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // localStorage unavailable
      }
    }

    if (!authUserId) {
      // Anonymous: hydrate from localStorage, merge with current state
      // (matches the safe-merge pattern from Phase 1 — a child-mount
      // addBooking would otherwise be overwritten).
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const arr = JSON.parse(raw) as StoredBooking[];
          if (Array.isArray(arr)) {
            setBookings((prev) => {
              const map = new Map<string, StoredBooking>();
              for (const b of arr) map.set(b.id, b);
              for (const b of prev) map.set(b.id, b);
              return [...map.values()].sort((a, b) =>
                b.createdAt.localeCompare(a.createdAt),
              );
            });
          }
        }
      } catch {
        // localStorage unavailable
      }
      setHydrated(true);
      return;
    }

    (async () => {
      const supabase = createClient();

      // 1. slug → uuid map (used for migration + future writes)
      const { data: venues, error: venuesErr } = await supabase
        .from("venues")
        .select("id,slug,next_slot_label");
      if (cancelled) return;
      if (venuesErr) {
        console.error("[bookings] venues map failed:", venuesErr);
        return;
      }
      const slugMap = new Map<string, string>();
      const slotLabelMap = new Map<string, string>();
      for (const v of venues ?? []) {
        const venue = v as {
          id: string;
          slug: string;
          next_slot_label: string;
        };
        slugMap.set(venue.slug, venue.id);
        slotLabelMap.set(venue.id, venue.next_slot_label);
      }
      slugToUuidRef.current = slugMap;

      // 2. Migrate localStorage → DB
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const localBookings = JSON.parse(raw) as StoredBooking[];
          if (Array.isArray(localBookings) && localBookings.length > 0) {
            const rows = localBookings
              .filter((b) => slugMap.has(b.venueSlug))
              .map((b) => ({
                id: b.id,
                user_id: authUserId,
                venue_id: slugMap.get(b.venueSlug)!,
                party_size: b.partySize,
                starts_at: b.startsAt,
                status: b.status,
                notes: b.notes,
              }));
            if (rows.length > 0) {
              const { error: migrateErr } = await supabase
                .from("bookings")
                .upsert(rows, { onConflict: "id" });
              if (migrateErr) {
                console.error("[bookings] migration failed:", migrateErr);
                return;
              }
            }
            window.localStorage.removeItem(STORAGE_KEY);
          }
        }
      } catch (e) {
        console.error("[bookings] migration step error:", e);
      }
      if (cancelled) return;

      // 3. Authoritative read with venue join
      const { data: rows, error: readErr } = await supabase
        .from("bookings")
        .select(
          "id,user_id,venue_id,party_size,starts_at,status,notes,created_at,venues(slug,next_slot_label)",
        )
        .eq("user_id", authUserId)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      if (readErr) {
        console.error("[bookings] read failed:", readErr);
        return;
      }
      // Supabase types the FK join as `venues: { ... }[]` because
      // it doesn't know it's a single FK; runtime gives a single
      // object. Cast through unknown to align.
      const mapped: StoredBooking[] = (rows ?? []).map((r) => {
        const row = r as unknown as {
          id: string;
          user_id: string;
          venue_id: string;
          party_size: number;
          starts_at: string;
          status: string;
          notes: string | null;
          created_at: string;
          venues: { slug: string; next_slot_label: string } | null;
        };
        return {
          id: row.id,
          userId: row.user_id,
          venueId: row.venue_id,
          partySize: row.party_size,
          startsAt: row.starts_at,
          status: row.status as Booking["status"],
          notes: row.notes,
          createdAt: row.created_at,
          venueSlug: row.venues?.slug ?? "",
          dateLabel: deriveDateLabel(row.starts_at),
          slotLabel:
            row.venues?.next_slot_label ?? slotLabelMap.get(row.venue_id) ?? "",
        };
      });
      setBookings(mapped);
    })();

    return () => {
      cancelled = true;
    };
  }, [authUserId]);

  // ── Persist (anon only) ─────────────────────────────────────────────
  // Gated on `hydrated` so the empty initial state can't clobber stored
  // bookings before the hydrate read above runs.
  useEffect(() => {
    if (authUserId || !hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bookings));
    } catch {
      // ignore quota / privacy mode
    }
  }, [bookings, authUserId, hydrated]);

  const addBooking = useCallback(
    (b: StoredBooking) => {
      const alreadyThere = bookingsRef.current.some((x) => x.id === b.id);
      setBookings((prev) => {
        if (prev.some((x) => x.id === b.id)) return prev;
        return [b, ...prev];
      });

      if (authUserId) {
        const venueId = slugToUuidRef.current.get(b.venueSlug) ?? b.venueId;
        const supabase = createClient();
        void supabase
          .from("bookings")
          .upsert(
            {
              id: b.id,
              user_id: authUserId,
              venue_id: venueId,
              party_size: b.partySize,
              starts_at: b.startsAt,
              status: b.status,
              notes: b.notes,
            },
            { onConflict: "id" },
          )
          .then(({ error }) => {
            if (error) {
              console.error("[bookings] insert failed, reverting:", error);
              // Only undo the row WE just added (don't drop a pre-existing one).
              if (!alreadyThere) {
                setBookings((prev) => prev.filter((x) => x.id !== b.id));
              }
            }
          });
      }
    },
    [authUserId],
  );

  const removeBooking = useCallback(
    (id: string) => {
      const removed = bookingsRef.current.find((b) => b.id === id);
      setBookings((prev) => prev.filter((b) => b.id !== id));
      if (authUserId) {
        const supabase = createClient();
        void supabase
          .from("bookings")
          .delete()
          .eq("user_id", authUserId)
          .eq("id", id)
          .then(({ error }) => {
            if (error) {
              console.error("[bookings] delete failed, reverting:", error);
              // Put the removed booking back so the UI matches the DB.
              if (removed) {
                setBookings((prev) =>
                  prev.some((x) => x.id === id)
                    ? prev
                    : [removed, ...prev].sort((a, b) =>
                        b.createdAt.localeCompare(a.createdAt),
                      ),
                );
              }
            }
          });
      }
    },
    [authUserId],
  );

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
