"use client";

// One-shot: when a user signs in on a device that previously completed
// onboarding as anonymous, copy their localStorage onboarding payload
// into public.profiles.preferences. Idempotent — if DB preferences are
// already set, does nothing. Mirrors the saved/bookings migration
// pattern but with a single row.
//
// The localStorage key is left in place: the splash route uses it as
// a device-local "you've seen onboarding" gate, separate from the DB
// "this user has preferences" state.

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Mood, Vibe } from "@/lib/types";

const ONBOARDING_STORAGE_KEY = "fl.onboarding.v1";

type LocalPayload = {
  moods?: Mood[];
  vibes?: Vibe[];
};

export function ProfilePrefsMigration({
  authUserId,
}: {
  authUserId: string | null;
}) {
  useEffect(() => {
    if (!authUserId) return;
    let cancelled = false;

    (async () => {
      let local: LocalPayload | null = null;
      try {
        const raw = window.localStorage.getItem(ONBOARDING_STORAGE_KEY);
        if (!raw) return;
        local = JSON.parse(raw) as LocalPayload;
      } catch {
        return;
      }
      if (!local || cancelled) return;

      const supabase = createClient();

      // Only migrate if DB prefs are still null (idempotent on re-mount).
      const { data: existing, error: readErr } = await supabase
        .from("profiles")
        .select("preferences")
        .eq("id", authUserId)
        .maybeSingle();
      if (cancelled) return;
      if (readErr) {
        console.error("[profile-prefs] read failed:", readErr);
        return;
      }
      if (existing?.preferences) return;

      const prefs = {
        moods: local.moods ?? [],
        vibes: local.vibes ?? [],
        budget: null,
        areas: [] as string[],
      };
      const { error: writeErr } = await supabase
        .from("profiles")
        .upsert(
          { id: authUserId, preferences: prefs, onboarded: true },
          { onConflict: "id" },
        );
      if (cancelled) return;
      if (writeErr) {
        console.error("[profile-prefs] write failed:", writeErr);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authUserId]);

  return null;
}
