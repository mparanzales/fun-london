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

  it("returns null for a MULTI-PARAGRAPH template (regex must cross newlines)", () => {
    const multiline =
      "An independent restaurant in Soho.\n\nOpening hours can vary, so check ahead.";
    expect(deriveAnonTeaser(multiline)).toBeNull();
  });

  it("trails a truncated first sentence with dots + truncated:true, stripping its full stop", () => {
    const desc =
      "Hand-rolled pasta made in the window since morning, eaten at the counter with a glass of house red for under a tenner. " +
      "The queue is the price of admission and everyone in it knows.";
    const teaser = deriveAnonTeaser(desc)!;
    // Maria's call: the dots ARE the there-is-more signal.
    expect(teaser.text).toMatch(/tenner…$/);
    expect(teaser.text).not.toContain(".…");
    expect(teaser.text.length).toBeLessThanOrEqual(161);
    expect(teaser.text).not.toContain("queue");
    expect(teaser.truncated).toBe(true);
  });

  it("cuts at a word boundary + dots when the first sentence runs long", () => {
    const long =
      "A cavernous railway-arch listening bar where the sound system was tuned by the same engineer who did the room at Spiritland and the natural wine list runs to forty pages of hand-scrawled notes";
    const teaser = deriveAnonTeaser(long)!;
    expect(teaser.text.endsWith("…")).toBe(true);
    expect(teaser.text.length).toBeLessThanOrEqual(TEASER_MAX + 1);
    // word-boundary cut: no whitespace immediately before the dots
    expect(teaser.text).not.toMatch(/\s…$/);
    expect(teaser.truncated).toBe(true);
  });

  it("whole-fit description: no dots AND truncated:false (the Continue-reading gate)", () => {
    // Confirmed review finding: rendering "Continue reading" under a
    // complete description claims more exists when the signed-in text is
    // byte-identical. truncated:false is what suppresses that link.
    const short = "Small plates, big room, no bookings.";
    expect(deriveAnonTeaser(short)).toEqual({
      text: short,
      truncated: false,
    });
  });

  it("never leaves a split surrogate pair at the cut", () => {
    // A long run with no spaces forces the raw 140-slice path; an emoji
    // spanning the boundary must not become a lone surrogate.
    const noSpaces = "x".repeat(139) + "🍷" + "y".repeat(60);
    const teaser = deriveAnonTeaser(noSpaces)!;
    expect(teaser.text).not.toMatch(/[\uD800-\uDBFF]…$/);
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
