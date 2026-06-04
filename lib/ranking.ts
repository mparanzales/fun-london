// "For You" personalization (Epic C).
//
// The onboarding quiz already persists the user's moods + vibes (DB for
// signed-in, localStorage for anonymous). This module turns those prefs
// into a score so the For You feed leads with venues/events that match
// the user's taste. No prefs → every score is 0 and the feed keeps its
// original order (no regression).

import type { Venue, Event, UserPreferences, Mood, Vibe } from "./types";

// Onboarding moods map to event categories: "culture" is surfaced as
// "Live Music" and "activity" as "Comedy" in the quiz copy.
const MOOD_TO_EVENT_CATEGORIES: Record<Mood, string[]> = {
  dinner: ["Food"],
  drinks: ["Club"],
  culture: ["Music"],
  activity: ["Comedy"],
};

const VIBE_KEYWORDS: Record<Vibe, string[]> = {
  chill: [
    "cosy",
    "cozy",
    "relaxed",
    "calm",
    "quiet",
    "intimate",
    "laid-back",
    "mellow",
  ],
  lively: [
    "buzzy",
    "lively",
    "loud",
    "party",
    "vibrant",
    "packed",
    "energetic",
    "bustling",
  ],
  fancy: [
    "elegant",
    "refined",
    "romantic",
    "upscale",
    "smart",
    "special",
    "date",
    "chic",
  ],
  unique: [
    "unique",
    "hidden",
    "quirky",
    "unusual",
    "only",
    "cult",
    "one-of",
    "offbeat",
  ],
};

// Does the user have anything we can personalize on?
export function hasPrefs(prefs: UserPreferences | null): boolean {
  return !!prefs && (prefs.moods.length > 0 || prefs.vibes.length > 0);
}

function vibeBoost(v: Venue, vibes: Vibe[]): number {
  if (vibes.length === 0) return 0;
  const hay = [v.vibe, ...v.vibeTags].join(" ").toLowerCase();
  let s = 0;
  for (const vb of vibes) {
    if (VIBE_KEYWORDS[vb].some((k) => hay.includes(k))) s += 1.5;
  }
  return s;
}

export function scoreVenue(v: Venue, prefs: UserPreferences): number {
  let s = 0;
  const moods = new Set<Mood>(prefs.moods);
  for (const m of v.moodTags) if (moods.has(m)) s += 3;
  s += vibeBoost(v, prefs.vibes);
  if (prefs.budget && v.price === prefs.budget) s += 1;
  s += (v.rating - 4) * 0.5; // gentle quality nudge as a tie-breaker
  // Hand-curated venues edge ahead of robot-discovered ones on close calls,
  // without overriding a strong taste match.
  if (v.curationTier === "curated") s += 0.75;
  return s;
}

export function scoreEvent(e: Event, prefs: UserPreferences): number {
  let s = 0;
  const cats = new Set(prefs.moods.flatMap((m) => MOOD_TO_EVENT_CATEGORIES[m]));
  if (cats.has(e.category)) s += 3;
  return s;
}
