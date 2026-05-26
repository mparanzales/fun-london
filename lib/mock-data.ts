// ─────────────────────────────────────────────────────────────────────────
// MOCK DATA — what's left after the Supabase migration.
//
// The catalog (venues + events) now lives in Supabase; reads go through
// lib/queries.ts. Saved venues and bookings now live in Supabase too,
// with localStorage as the anon-mode fallback (see saved-context.tsx
// and bookings-context.tsx).
//
// What stays here:
//   • MOCK_USER         — the "Maria" demo persona. Drives the
//                          /explore greeting and /profile h1 fallback
//                          when the auth user has no display_name yet
//                          (Phase 3.5 / cleanup PR moves these to
//                          public.profiles).
//   • MOCK_SAVED_IDS    — slugs of venues seeded as "already saved"
//                          on first mount for anon users. Slugs, not
//                          ids, so the seed survives Supabase reseeds.
//   • MOCK_PARTICIPANTS — Plan Together's hardcoded 4 voters. No DB
//                          story yet; static demo data.
// ─────────────────────────────────────────────────────────────────────────

import type { User, Participant } from "./types";

// ── User ─────────────────────────────────────────────────────────────────

export const MOCK_USER: User = {
  id: "user-demo",
  email: "demo@funlondon.app",
  displayName: "Maria",
  avatarUrl: null,
  preferences: {
    moods: ["dinner", "drinks"],
    vibes: ["chill"],
    budget: "££",
    areas: ["Shoreditch", "Soho"],
  },
  onboarded: true,
  createdAt: "2024-01-15T10:00:00Z",
};

export function getCurrentUser(): User {
  return MOCK_USER;
}

// ── Saved venues seed ────────────────────────────────────────────────────
// Anon users start with two venues already hearted, so /saved isn't empty
// on first run. Slugs (not ids) — they outlive any Supabase reseed.

export const MOCK_SAVED_IDS: string[] = [
  "dishoom-shoreditch",
  "borough-market",
];

// ── Plan Together — mock multiplayer participants ────────────────────────
// Colors and emoji mirror the prototype's plan-together.jsx voter palette.

export const MOCK_PARTICIPANTS: Participant[] = [
  { id: "you", name: "You", color: "hsl(20 90% 55%)", emoji: "🧡" },
  { id: "maya", name: "Maya", color: "hsl(330 80% 60%)", emoji: "💖" },
  { id: "tom", name: "Tom", color: "hsl(220 80% 60%)", emoji: "💙" },
  { id: "alex", name: "Alex", color: "hsl(280 70% 65%)", emoji: "💜" },
];

export function getParticipants(): Participant[] {
  return MOCK_PARTICIPANTS;
}
