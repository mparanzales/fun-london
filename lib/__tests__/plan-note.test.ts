import { describe, it, expect } from "vitest";
import { pickReviewSnippet, isGrounded, MAX_NOTE_CHARS } from "@/lib/plan-note";
import type { VenueReview } from "@/lib/types";

const review = (p: Partial<VenueReview>): VenueReview => ({
  author: "A",
  rating: 5,
  text: "x".repeat(120),
  relativeTime: "2 weeks ago",
  ...p,
});

const venue = {
  name: "Zuma",
  type: "Restaurant",
  neighbourhood: "Knightsbridge",
};

describe("pickReviewSnippet", () => {
  it("returns null with no reviews", () => {
    expect(pickReviewSnippet(null)).toBeNull();
    expect(pickReviewSnippet([])).toBeNull();
  });

  it("skips low ratings and too-short text", () => {
    expect(
      pickReviewSnippet([
        review({ rating: 3, text: "y".repeat(120) }),
        review({ rating: 5, text: "short" }),
      ]),
    ).toBeNull();
  });

  it("prefers the higher rating, then the snippet nearest the sweet spot", () => {
    const four = review({ rating: 4, text: "a".repeat(220), author: "four" });
    const fiveFar = review({ rating: 5, text: "b".repeat(600), author: "far" });
    const fiveNear = review({
      rating: 5,
      text: "c".repeat(210),
      author: "near",
    });
    const picked = pickReviewSnippet([four, fiveFar, fiveNear]);
    expect(picked?.author).toBe("near"); // 5★ beats 4★; nearest 220 beats the long one
  });
});

describe("isGrounded (the fact-checker gate)", () => {
  const snippet = review({
    rating: 5,
    text: "The robata grill is incredible and the cocktails are creative. Buzzy room, great service.",
  });

  it("accepts a line whose claims trace back to the review", () => {
    expect(
      isGrounded(
        "Great for the robata grill and creative cocktails",
        snippet,
        venue,
      ),
    ).toBe(true);
  });

  it("accepts pure positive sentiment over a high-rated review", () => {
    expect(
      isGrounded("A buzzy, brilliant spot worth the trip", snippet, venue),
    ).toBe(true);
  });

  it("rejects an invented claim the review never makes", () => {
    // 'omakase' / 'Michelin' appear nowhere in the snippet or venue identity.
    expect(
      isGrounded(
        "Book the omakase, a Michelin-starred tasting menu",
        snippet,
        venue,
      ),
    ).toBe(false);
  });

  it("rejects a fabricated number not in the snippet", () => {
    expect(
      isGrounded(
        "Famous for its 12-course robata cocktails feast",
        snippet,
        venue,
      ),
    ).toBe(false);
  });

  it("rejects too-short or too-long lines", () => {
    expect(isGrounded("Go", snippet, venue)).toBe(false);
    expect(isGrounded("x".repeat(MAX_NOTE_CHARS + 1), snippet, venue)).toBe(
      false,
    );
  });

  it("counts the venue's own identity as grounded context", () => {
    const s = review({
      rating: 5,
      text: "Loved every minute, will be back soon.",
    });
    // 'Knightsbridge' is the venue's neighbourhood → allowed even if not in the review.
    expect(isGrounded("A lovely Knightsbridge favourite", s, venue)).toBe(true);
  });
});
