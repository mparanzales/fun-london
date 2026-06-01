// Plan Together — the mood swipe-deck.
//
// Maria's design (2026-05-31): the swipe step keeps the single-card swipe FEEL
// (one card, ♥ / ✕) but every card is a *mood*, and the deck shown depends on
// whether the group is meeting in the morning / afternoon / night. Each mood
// buckets into one of the three walkable stops (Start → Then → Finish) and
// carries the venue types that satisfy it — so the planner can pick a wine bar
// when the group hearts "cosy wine", not just any bar.
//
// This file is pure data + helpers (no engine change). Phase B threads the
// per-role venue-type intent (derived from hearted moods) into the planner so
// the mood actually narrows the pick. See PLAN-mood-deck.md.

import type { PlanRole } from "@/lib/plan-engine";
import type { VenueType } from "@/lib/types";

// The group's meeting window — Morning / Afternoon / Night, set by the host on
// the settings step. Drives which deck the group swipes.
export type DeckTime = "Morning" | "Afternoon" | "Night";

export interface Mood {
  /** Stable id — also the swipe vote index key within its deck. */
  id: string;
  /** Big card headline, lowercase brat voice. */
  label: string;
  /** One-line whisper under the label. */
  sub: string;
  emoji: string;
  /** Which walkable stop this mood fills. */
  role: PlanRole;
  /** Venue types that satisfy this mood (unioned across hearted moods in B). */
  types: VenueType[];
}

// Decks are ordered the way they're swiped (roughly Start → Then → Finish so
// the deck reads like the arc of the day/night).
export const DECKS: Record<DeckTime, Mood[]> = {
  Morning: [
    {
      id: "brunch",
      label: "slow brunch",
      sub: "eggs, no rush",
      emoji: "🥐",
      role: "Start",
      types: ["Restaurant", "Cafe"],
    },
    {
      id: "coffee",
      label: "proper coffee",
      sub: "a real flat white",
      emoji: "☕",
      role: "Start",
      types: ["Cafe"],
    },
    {
      id: "fresh-air",
      label: "fresh air",
      sub: "a wander, a green bit",
      emoji: "🌳",
      role: "Then",
      types: ["Outdoors"],
    },
    {
      id: "museum",
      label: "museum morning",
      sub: "culture before the crowds",
      emoji: "🎨",
      role: "Then",
      types: ["Culture"],
    },
    {
      id: "market",
      label: "market mooch",
      sub: "browse, snack, repeat",
      emoji: "🛍️",
      role: "Finish",
      types: ["Market"],
    },
  ],
  Afternoon: [
    {
      id: "long-lunch",
      label: "long lunch",
      sub: "sit down, settle in",
      emoji: "🍽️",
      role: "Start",
      types: ["Restaurant"],
    },
    {
      id: "casual-bite",
      label: "casual bite",
      sub: "easy, no fuss",
      emoji: "🥪",
      role: "Start",
      types: ["Cafe", "Restaurant"],
    },
    {
      id: "culture",
      label: "something cultural",
      sub: "a show, a gallery",
      emoji: "🎨",
      role: "Then",
      types: ["Culture"],
    },
    {
      id: "early-drinks",
      label: "early drinks",
      sub: "first one of the day",
      emoji: "🍷",
      role: "Then",
      types: ["Wine Bar", "Bar"],
    },
    {
      id: "park",
      label: "park & wander",
      sub: "outside, while it's light",
      emoji: "🌳",
      role: "Finish",
      types: ["Outdoors"],
    },
  ],
  Night: [
    {
      id: "feast",
      label: "proper feast",
      sub: "a real sit-down",
      emoji: "🍝",
      role: "Start",
      types: ["Restaurant"],
    },
    {
      id: "cocktails",
      label: "cocktails & buzz",
      sub: "dressed up, a scene",
      emoji: "🍸",
      role: "Then",
      types: ["Bar", "Listening Bar"],
    },
    {
      id: "cosy-wine",
      label: "cosy wine",
      sub: "low light, good bottles",
      emoji: "🍷",
      role: "Then",
      types: ["Wine Bar"],
    },
    {
      id: "pub",
      label: "proper pub",
      sub: "a real boozer",
      emoji: "🍺",
      role: "Then",
      types: ["Pub"],
    },
    {
      id: "live",
      label: "live & loud",
      sub: "music you feel",
      emoji: "🎷",
      role: "Finish",
      types: ["Live Music"],
    },
    {
      id: "dancing",
      label: "keep dancing",
      sub: "no curfew",
      emoji: "🪩",
      role: "Finish",
      types: ["Live Music", "Bar"],
    },
  ],
};

// The deck for a meeting window. "now" rooms carry no time-of-day, so default
// to the (best-stocked) Night deck.
export function deckTimeFromTimeOfDay(tod: DeckTime | undefined): DeckTime {
  return tod ?? "Night";
}

// Roles, in walking order — re-exported so the swipe/result steps don't have to
// reach into the engine for the canonical order.
export const ROLE_ORDER: PlanRole[] = ["Start", "Then", "Finish"];

// Given the moods a group hearted, the venue types allowed for each stop = the
// union of the hearted moods that bucket into that role. Empty role = dropped.
// (Phase B feeds this into the planner.)
export function intentFromHeartedMoods(
  hearted: Mood[],
): Record<PlanRole, VenueType[]> {
  const intent: Record<PlanRole, VenueType[]> = {
    Start: [],
    Then: [],
    Finish: [],
  };
  for (const mood of hearted) {
    for (const t of mood.types) {
      if (!intent[mood.role].includes(t)) intent[mood.role].push(t);
    }
  }
  return intent;
}
