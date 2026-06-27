"use client";

// Saved-set state. The set holds venue *slugs* — slugs are stable
// across mock-data, Supabase reseeds, and the Phase 3 sign-in
// migration. The schema's saved_venues.venue_id FK is uuid; we resolve
// slug → uuid via a tiny client-side cache populated on mount.
//
// Two modes, picked from `authUserId` prop:
//   • Anonymous (authUserId === null) — hydrate from / persist to
//     localStorage `fl.saved.v1`. Same behaviour as Phase 1/2.
//   • Signed in (authUserId is a uuid) — hydrate from / persist to
//     public.saved_venues via the browser Supabase client. On first
//     mount as signed-in, any leftover localStorage entries get
//     migrated into the DB (slug→uuid resolved, FK-safe), then the
//     local store is cleared.
//
// State is always Set<slug> in memory, so consumers (venue-card,
// venue-detail, saved-list) don't care about the backing store.

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
import { MOCK_SAVED_IDS } from "@/lib/mock-data";
import { track } from "@/lib/analytics";
import { recordSignal, type SignalSurface } from "@/lib/signals";

const STORAGE_KEY = "fl.saved.v1";

type SavedContextValue = {
  savedSet: Set<string>; // venue slugs
  isSaved: (venueSlug: string) => boolean;
  toggleSaved: (venueSlug: string, surface?: SignalSurface) => void;
  count: number;
};

const SavedContext = createContext<SavedContextValue | null>(null);

export function SavedProvider({
  children,
  authUserId,
}: {
  children: React.ReactNode;
  authUserId: string | null;
}) {
  const [savedSet, setSavedSet] = useState<Set<string>>(
    () => new Set(MOCK_SAVED_IDS),
  );
  // Gate the anon persist effect until the first hydrate read has happened.
  // Without this, on a hard reload the persist effect fires on mount with the
  // empty initial state and overwrites localStorage BEFORE the hydrate effect
  // reads it — silently wiping an anonymous user's saved spots.
  const [hydrated, setHydrated] = useState(false);
  // slug → venue.id (uuid). Populated when authed; empty when anon.
  const slugToUuidRef = useRef<Map<string, string>>(new Map());
  // Mirror of the live set so toggleSaved can read current membership without
  // a stale closure (and without doing side effects inside a state updater).
  const savedSetRef = useRef(savedSet);
  useEffect(() => {
    savedSetRef.current = savedSet;
  }, [savedSet]);

  // ── Hydrate (and migrate if we're newly signed in) ──────────────────
  useEffect(() => {
    let cancelled = false;

    if (!authUserId) {
      // Anonymous path
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const arr = JSON.parse(raw) as string[];
          if (Array.isArray(arr)) setSavedSet(new Set(arr));
        }
      } catch {
        // localStorage unavailable
      }
      setHydrated(true);
      return;
    }

    // Signed-in path: fetch venues map, migrate local→DB if needed,
    // then hydrate from DB. All wrapped in try/catch so a transient
    // network blip doesn't wipe state.
    (async () => {
      const supabase = createClient();

      // 1. slug → uuid map. Restrict to catalog-VISIBLE venues only
      // (google_place_id IS NOT NULL) — the same filter fetchVenues() uses.
      // This keeps the saved-set aligned with what the catalog/Saved list
      // can actually render, so the count never disagrees with the list
      // (e.g. saved demo rows like Dishoom/Borough Market that are hidden
      // from the catalog used to inflate the count but show nothing).
      const { data: venues, error: venuesErr } = await supabase
        .from("venues")
        .select("id,slug")
        .not("google_place_id", "is", null);
      if (cancelled) return;
      if (venuesErr) {
        console.error("[saved] venues map failed:", venuesErr);
        return;
      }
      const map = new Map<string, string>();
      for (const v of venues ?? []) map.set(v.slug as string, v.id as string);
      slugToUuidRef.current = map;

      // 2. Migrate localStorage → DB (one-time, FK-safe)
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const localSlugs = JSON.parse(raw) as string[];
          if (Array.isArray(localSlugs) && localSlugs.length > 0) {
            const toInsert = localSlugs
              .filter((slug) => map.has(slug))
              .map((slug) => ({
                user_id: authUserId,
                venue_id: map.get(slug)!,
              }));
            if (toInsert.length > 0) {
              const { error: migrateErr } = await supabase
                .from("saved_venues")
                .upsert(toInsert, { onConflict: "user_id,venue_id" });
              if (migrateErr) {
                console.error("[saved] migration failed:", migrateErr);
                // Leave local data in place; we'll retry on next mount.
                return;
              }
            }
            // Clear local only after successful migration (or no-op).
            window.localStorage.removeItem(STORAGE_KEY);
          }
        }
      } catch (e) {
        console.error("[saved] migration step error:", e);
      }
      if (cancelled) return;

      // 3. Authoritative read from DB
      const { data: rows, error: readErr } = await supabase
        .from("saved_venues")
        .select("venues(slug)")
        .eq("user_id", authUserId);
      if (cancelled) return;
      if (readErr) {
        console.error("[saved] read failed:", readErr);
        return;
      }
      // Supabase types FK joins as arrays even when it's a single FK;
      // runtime returns a single object. Cast via unknown.
      // Keep only slugs that map to a catalog-visible venue (in `map`),
      // so a saved row pointing at a hidden/demo venue doesn't inflate the
      // count past what the Saved list can show.
      const slugs: string[] = [];
      for (const row of rows ?? []) {
        const v = (row as unknown as { venues: { slug: string } | null })
          .venues;
        if (v?.slug && map.has(v.slug)) slugs.push(v.slug);
      }
      setSavedSet(new Set(slugs));
    })();

    return () => {
      cancelled = true;
    };
  }, [authUserId]);

  // ── Persist (anon only — authed writes happen in toggleSaved) ───────
  // Gated on `hydrated` so the empty initial state can't clobber a real
  // saved list before the hydrate read above has run.
  useEffect(() => {
    if (authUserId || !hydrated) return;
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(Array.from(savedSet)),
      );
    } catch {
      // ignore quota / privacy mode
    }
  }, [savedSet, authUserId, hydrated]);

  const toggleSaved = useCallback(
    (venueSlug: string, surface: SignalSurface = "venue") => {
      const wasSaved = savedSetRef.current.has(venueSlug);

      // Optimistic UI update.
      const apply = (saved: boolean) =>
        setSavedSet((prev) => {
          const next = new Set(prev);
          if (saved) next.add(venueSlug);
          else next.delete(venueSlug);
          return next;
        });
      apply(!wasSaved);

      track(wasSaved ? "venue_unsave" : "venue_save", { venue: venueSlug });

      // Kind C signal (algorithm step 0.4) → public.user_events. venueId
      // resolves only when signed in (the slug→uuid map is empty for anon);
      // recordSignal self-gates to signed-in users, so anon is a harmless no-op.
      recordSignal(wasSaved ? "unsave" : "save", {
        surface,
        venueId: slugToUuidRef.current.get(venueSlug) ?? null,
      });

      if (!authUserId) return; // anon: localStorage persist effect handles it

      const venueId = slugToUuidRef.current.get(venueSlug);
      if (!venueId) return;

      // Persist to the DB; if it fails, REVERT the optimistic change so the UI
      // reflects what's actually stored (rather than lying until next reload).
      const supabase = createClient();
      const op = wasSaved
        ? supabase
            .from("saved_venues")
            .delete()
            .eq("user_id", authUserId)
            .eq("venue_id", venueId)
        : supabase
            .from("saved_venues")
            .upsert(
              { user_id: authUserId, venue_id: venueId },
              { onConflict: "user_id,venue_id" },
            );
      void op.then(({ error }) => {
        if (error) {
          console.error("[saved] write failed, reverting:", error);
          apply(wasSaved);
        }
      });
    },
    [authUserId],
  );

  const value = useMemo<SavedContextValue>(
    () => ({
      savedSet,
      isSaved: (slug) => savedSet.has(slug),
      toggleSaved,
      count: savedSet.size,
    }),
    [savedSet, toggleSaved],
  );

  return (
    <SavedContext.Provider value={value}>{children}</SavedContext.Provider>
  );
}

export function useSaved(): SavedContextValue {
  const ctx = useContext(SavedContext);
  if (!ctx) throw new Error("useSaved must be used inside <SavedProvider>");
  return ctx;
}
