import { describe, it, expect } from "vitest";
import { compareHits, type SearchHit } from "@/lib/search-match";
import type { Venue, Event } from "@/lib/types";

// compareHits is the single ordering used by every search box to merge venues
// and events into ONE relevance-ranked list. These lock in that the two types
// interleave by how well they match, not by kind.

function venue(name: string, score: number, rating: number): SearchHit {
  return { kind: "venue", data: { name, rating } as Venue, score };
}
function event(name: string, score: number): SearchHit {
  return { kind: "event", data: { name } as Event, score };
}

const order = (hits: SearchHit[]) =>
  [...hits].sort(compareHits).map((h) => h.data.name);

describe("compareHits: relevance interleaving across venues + events", () => {
  it("ranks by match tier first, regardless of type", () => {
    // A name match (tier 0) of EITHER type beats a description match (tier 2).
    const hits = [
      venue("Desc-only Venue", 2, 5.0), // weak match, top-rated
      event("Name Match Event", 0), // strong match
    ];
    expect(order(hits)).toEqual(["Name Match Event", "Desc-only Venue"]);
  });

  it("interleaves venues and events within the same tier by quality", () => {
    // All tier-1 matches: a great venue leads, the event sits in the middle
    // (neutral ~3.0/5 prior), a poor venue trails — i.e. NOT grouped by type.
    const hits = [
      venue("Weak Venue", 1, 2.0), // quality 0.4
      event("Middle Event", 1), // quality 0.6
      venue("Great Venue", 1, 4.5), // quality 0.9
    ];
    expect(order(hits)).toEqual(["Great Venue", "Middle Event", "Weak Venue"]);
  });

  it("breaks exact ties by name for a deterministic, stable order", () => {
    const hits = [
      venue("Bravo", 0, 4.0),
      venue("Alpha", 0, 4.0), // same tier + same rating -> name decides
    ];
    expect(order(hits)).toEqual(["Alpha", "Bravo"]);
  });
});
