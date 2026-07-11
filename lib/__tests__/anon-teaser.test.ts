import { describe, expect, it } from "vitest";
import {
  ANON_TAG_LIMIT,
  deriveAnonTags,
  deriveAnonTeaser,
  TEASER_MAX,
} from "@/lib/anon-teaser";

// These tests PIN the anon exposure surface (panel ruling 2026-07-11):
// max ~160 chars of description, max 3 tags, and NEVER template prose.
// If a change widens any of these, it is widening what anonymous
// scrapers can harvest — that must be a deliberate decision, not a drift.

const TEMPLATE =
  "An independent restaurant in Soho. Opening hours can vary, so check ahead. A solid pick for a night out in the area.";

describe("deriveAnonTeaser (anon moat surface)", () => {
  it("returns null for the 217-venue template signature (templates never tease)", () => {
    expect(deriveAnonTeaser(TEMPLATE)).toBeNull();
  });

  it("returns null for empty/missing descriptions", () => {
    expect(deriveAnonTeaser("")).toBeNull();
    expect(deriveAnonTeaser(null)).toBeNull();
    expect(deriveAnonTeaser(undefined)).toBeNull();
  });

  it("returns a complete first sentence when it ends within 160 chars", () => {
    const desc =
      "Hand-rolled pasta made in the window since morning, eaten at the counter with a glass of house red for under a tenner. " +
      "The queue is the price of admission and everyone in it knows.";
    const teaser = deriveAnonTeaser(desc)!;
    expect(teaser).toMatch(/tenner\.$/);
    expect(teaser.length).toBeLessThanOrEqual(160);
    expect(teaser).not.toContain("queue");
  });

  it("cuts at a word boundary + ellipsis when the first sentence runs long", () => {
    const long =
      "A cavernous railway-arch listening bar where the sound system was tuned by the same engineer who did the room at Spiritland and the natural wine list runs to forty pages of hand-scrawled notes";
    const teaser = deriveAnonTeaser(long)!;
    expect(teaser.endsWith("…")).toBe(true);
    // cap + space + ellipsis
    expect(teaser.length).toBeLessThanOrEqual(TEASER_MAX + 2);
    // never a mid-word cut
    expect(teaser).not.toMatch(/\w…$/);
  });

  it("never returns more than the sentence cap of the source text", () => {
    const short = "Small plates, big room, no bookings.";
    expect(deriveAnonTeaser(short)).toBe(short);
  });
});

describe("deriveAnonTags (anon moat surface)", () => {
  it("caps at 3 tags no matter how many the venue holds", () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `tag-${i}`);
    expect(deriveAnonTags(twenty)).toHaveLength(ANON_TAG_LIMIT);
    expect(deriveAnonTags(twenty)).toEqual(["tag-0", "tag-1", "tag-2"]);
  });

  it("handles empty/missing tag arrays", () => {
    expect(deriveAnonTags([])).toEqual([]);
    expect(deriveAnonTags(null)).toEqual([]);
    expect(deriveAnonTags(undefined)).toEqual([]);
  });
});
