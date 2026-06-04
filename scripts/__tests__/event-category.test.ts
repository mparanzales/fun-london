import { describe, it, expect } from "vitest";
import { tmCategory } from "../event-category";

// Locks the de-music behaviour: club nights are Club (not Music), comedy is
// Comedy wherever it sits, and non-fitting segments are dropped (null) instead
// of being dumped into Music — which is what made the feed look gig-only.

describe("tmCategory", () => {
  it("maps plain music to Music", () => {
    expect(tmCategory("Music", "Rock")).toBe("Music");
    expect(tmCategory("Music", "Pop")).toBe("Music");
    expect(tmCategory("Music", "Jazz")).toBe("Music");
  });

  it("maps Dance/Electronic music genres to Club, not Music", () => {
    expect(tmCategory("Music", "Dance/Electronic")).toBe("Club");
    expect(tmCategory("Music", "House")).toBe("Club");
    expect(tmCategory("Music", "Techno")).toBe("Club");
    expect(tmCategory("Music", "Drum & Bass")).toBe("Club");
  });

  it("maps comedy to Comedy regardless of segment", () => {
    // Comedy is a genre under Arts & Theatre on Ticketmaster.
    expect(tmCategory("Arts & Theatre", "Comedy")).toBe("Comedy");
    expect(tmCategory("Comedy", undefined)).toBe("Comedy");
  });

  it("maps Arts & Theatre to Art", () => {
    expect(tmCategory("Arts & Theatre", "Theatre")).toBe("Art");
    expect(tmCategory("Arts & Theatre", "Dance")).toBe("Art");
  });

  it("drops non-fitting segments instead of defaulting to Music", () => {
    expect(tmCategory("Sports", "Soccer")).toBeNull();
    expect(tmCategory("Film", "Documentary")).toBeNull();
    expect(tmCategory("Miscellaneous", "Fairs & Festivals")).toBeNull();
    expect(tmCategory(undefined, undefined)).toBeNull();
  });
});
