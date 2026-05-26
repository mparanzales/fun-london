"use client";

// Client-side saved-set state. With Supabase out of scope, heart toggles
// propagate across tabs through this provider instead of a backend.
//
// Seeds from MOCK_SAVED_IDS on first mount, then persists to localStorage
// so a refresh keeps the user's saves.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { MOCK_SAVED_IDS } from "@/lib/mock-data";

const STORAGE_KEY = "fl.saved.v1";

type SavedContextValue = {
  savedSet: Set<string>;
  isSaved: (venueId: string) => boolean;
  toggleSaved: (venueId: string) => void;
  count: number;
};

const SavedContext = createContext<SavedContextValue | null>(null);

export function SavedProvider({ children }: { children: React.ReactNode }) {
  const [savedSet, setSavedSet] = useState<Set<string>>(
    () => new Set(MOCK_SAVED_IDS),
  );

  // Hydrate from localStorage on mount.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw) as string[];
        if (Array.isArray(arr)) setSavedSet(new Set(arr));
      }
    } catch {
      // localStorage unavailable or corrupted — keep seed.
    }
  }, []);

  // Persist on every change.
  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(Array.from(savedSet)),
      );
    } catch {
      // ignore quota / privacy mode
    }
  }, [savedSet]);

  const toggleSaved = useCallback((venueId: string) => {
    setSavedSet((prev) => {
      const next = new Set(prev);
      if (next.has(venueId)) next.delete(venueId);
      else next.add(venueId);
      return next;
    });
  }, []);

  const value = useMemo<SavedContextValue>(
    () => ({
      savedSet,
      isSaved: (id) => savedSet.has(id),
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
