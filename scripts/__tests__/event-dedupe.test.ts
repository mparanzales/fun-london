import { describe, it, expect } from "vitest";
import { nameTokens, makeRow, sameEvent } from "../event-dedupe";

const JUL = ["2026-07-01T12:00:00Z", "2026-07-20T22:00:00Z"] as const;

describe("event dedupe", () => {
  it("merges name variants of the same pop-up at the same venue", () => {
    const a = makeRow("PleasingLand", "14 Carnaby Street", JUL[0], JUL[1]);
    const b = makeRow("PleasingLand Pop-Up", "14 Carnaby St", JUL[0], JUL[1]);
    expect(sameEvent(a, b)).toBe(true);
  });

  it("merges across venue-string variants when the names are very similar", () => {
    const a = makeRow(
      "Royal Academy Summer Exhibition",
      "Royal Academy of Arts",
      JUL[0],
      JUL[1],
    );
    const b = makeRow(
      "Royal Academy of Arts Summer Exhibition 2026",
      "Royal Academy of Arts, Main Galleries, Burlington House",
      JUL[0],
      JUL[1],
    );
    expect(sameEvent(a, b)).toBe(true);
  });

  it("does NOT merge genuinely different gigs at the same venue", () => {
    const a = makeRow("The RnB Orchestra", "Jazz Cafe", JUL[0], JUL[0]);
    const b = makeRow("The Afrobeats Orchestra", "Jazz Cafe", JUL[0], JUL[0]);
    expect(sameEvent(a, b)).toBe(false);
  });

  it("does NOT merge the same name on non-overlapping dates", () => {
    const a = makeRow(
      "SoLo Craft Fair",
      "Leadenhall Market",
      "2026-07-01T12:00:00Z",
      "2026-07-02T12:00:00Z",
    );
    const b = makeRow(
      "SoLo Craft Fair",
      "Leadenhall Market",
      "2026-09-01T12:00:00Z",
      "2026-09-02T12:00:00Z",
    );
    expect(sameEvent(a, b)).toBe(false);
  });

  it("strips stopwords so generic words don't drive a match", () => {
    expect([...nameTokens("The Pop-Up Shop")]).toEqual([]);
  });
});
