import { describe, it, expect } from "vitest";
import { hasPrefs, scoreVenue } from "@/lib/ranking";
import type { UserPreferences, Venue, Mood } from "@/lib/types";
import { makeVenue } from "./_fixtures";

function prefs(p: Partial<UserPreferences>): UserPreferences {
  return {
    moods: [],
    vibes: [],
    budget: null,
    areas: [],
    ...p,
  } as UserPreferences;
}

describe("hasPrefs", () => {
  it("is false for null or empty preferences", () => {
    expect(hasPrefs(null)).toBe(false);
    expect(hasPrefs(prefs({}))).toBe(false);
  });

  it("is true once there's a mood or a vibe", () => {
    expect(hasPrefs(prefs({ moods: ["dinner"] as Mood[] }))).toBe(true);
  });
});

describe("scoreVenue", () => {
  it("rewards a venue that matches the user's moods + budget over one that doesn't", () => {
    const p = prefs({ moods: ["dinner"] as Mood[], budget: "££" });
    const match = makeVenue({
      moodTags: ["dinner"] as Mood[],
      price: "££" as Venue["price"],
    });
    const miss = makeVenue({
      moodTags: [] as Mood[],
      price: "£££" as Venue["price"],
    });
    expect(scoreVenue(match, p)).toBeGreaterThan(scoreVenue(miss, p));
  });

  it("gives a mood match a meaningful boost (+3)", () => {
    const p = prefs({ moods: ["dinner"] as Mood[] });
    const withMood = makeVenue({ moodTags: ["dinner"] as Mood[] });
    const without = makeVenue({ moodTags: [] as Mood[] });
    expect(scoreVenue(withMood, p) - scoreVenue(without, p)).toBeCloseTo(3, 5);
  });
});
