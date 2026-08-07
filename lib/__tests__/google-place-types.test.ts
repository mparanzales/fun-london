// The spec for this classifier is a real incident: on 2026-08-05/06 the
// keyword guesser published Osterley Bookshop, Books for Cooks, Burlington
// Arcade, The London Dungeon and a Victorian cabmen's hut as evening
// RESTAURANTS, which put them in the night planner's dinner pool. Each of
// those failures is a test below, expressed as the Google category the place
// actually carries.
//
// The load-bearing property is not "maps things correctly" — it is
// "REFUSES what it does not recognise". A regression that makes an unknown
// type fall through to Restaurant must turn this file red.

import { describe, expect, it } from "vitest";
import { classifyFromGoogle, refineTimeOfDay } from "../google-place-types";

const ok = (primary: string, types: string[] = []) => {
  const r = classifyFromGoogle(primary, types);
  if (!r.ok) throw new Error(`expected publishable, got refusal: ${r.reason}`);
  return r.classification;
};

describe("classifyFromGoogle · fails closed", () => {
  it("REFUSES shops, which is the bug that shipped bookshops as restaurants", () => {
    // Osterley Bookshop / Books for Cooks
    expect(classifyFromGoogle("book_store", ["store"])).toMatchObject({
      ok: false,
    });
    // Burlington Arcade
    expect(classifyFromGoogle("shopping_mall", [])).toMatchObject({
      ok: false,
    });
    // Lock & Co. Hatters
    expect(classifyFromGoogle("clothing_store", ["store"])).toMatchObject({
      ok: false,
    });
  });

  it("names WHY it refused, so the reviewer sees the reason", () => {
    const r = classifyFromGoogle("book_store", []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("book_store");
    if (!r.ok) expect(r.reason).toContain("shop");
  });

  it("refuses an unknown/garbage category instead of defaulting", () => {
    expect(classifyFromGoogle("dentist", ["health"])).toMatchObject({
      ok: false,
    });
    expect(classifyFromGoogle("not_a_real_google_type", [])).toMatchObject({
      ok: false,
    });
  });

  it("refuses when Google returned no category at all", () => {
    expect(classifyFromGoogle(null, null)).toMatchObject({ ok: false });
    expect(classifyFromGoogle(undefined, [])).toMatchObject({ ok: false });
  });

  it("refuses delivery/takeaway/fast food despite the _restaurant suffix", () => {
    expect(classifyFromGoogle("fast_food_restaurant", [])).toMatchObject({
      ok: false,
    });
    expect(classifyFromGoogle("meal_takeaway", [])).toMatchObject({
      ok: false,
    });
  });

  it("refuses a plain place of worship but publishes a real landmark", () => {
    expect(classifyFromGoogle("church", [])).toMatchObject({ ok: false });
    // St Paul's-shaped: church AND a landmark category
    expect(
      ok("church", ["historical_landmark", "tourist_attraction"]).type,
    ).toBe("Culture");
  });
});

describe("classifyFromGoogle · correct mappings", () => {
  it("maps the food and drink families", () => {
    expect(ok("restaurant").type).toBe("Restaurant");
    expect(ok("italian_restaurant").type).toBe("Restaurant"); // long tail
    expect(ok("gastropub").type).toBe("Pub"); // specific beats generic
    expect(ok("irish_pub").type).toBe("Pub");
    expect(ok("wine_bar").type).toBe("Wine Bar");
    expect(ok("cocktail_bar").type).toBe("Bar");
    expect(ok("coffee_shop").type).toBe("Cafe");
    expect(ok("bakery").type).toBe("Cafe");
    // dessert_restaurant must land in Cafe, NOT via the _restaurant tail
    expect(ok("dessert_restaurant").type).toBe("Cafe");
  });

  it("maps day-spots, which used to become Evening restaurants", () => {
    expect(ok("art_museum")).toMatchObject({
      type: "Culture",
      timeOfDay: "Day",
      moods: ["culture"],
    });
    // The London Dungeon
    expect(ok("tourist_attraction")).toMatchObject({
      type: "Culture",
      timeOfDay: "Day",
    });
    expect(ok("park")).toMatchObject({ type: "Outdoors", moods: ["activity"] });
    expect(ok("garden").type).toBe("Outdoors");
  });

  it("gives a market ACTIVITY, not dinner (Walthamstow Market shipped as dinner)", () => {
    const c = ok("market");
    expect(c.type).toBe("Market");
    expect(c.timeOfDay).toBe("Day");
    expect(c.moods).toEqual(["activity"]);
    expect(c.moods).not.toContain("dinner");
  });

  it("maps night types to Night", () => {
    expect(ok("night_club")).toMatchObject({
      type: "Live Music",
      timeOfDay: "Night",
    });
    expect(ok("comedy_club").type).toBe("Live Music");
  });

  it("treats breakfast/brunch places as Day", () => {
    expect(ok("brunch_restaurant")).toMatchObject({
      type: "Restaurant",
      timeOfDay: "Day",
    });
  });

  it("prefers primaryType over the types array", () => {
    // Google often lists generic `restaurant` alongside the specific primary.
    expect(
      ok("wine_bar", ["restaurant", "food", "point_of_interest"]).type,
    ).toBe("Wine Bar");
  });

  it("falls back to the types array when primaryType is absent", () => {
    expect(ok("", ["art_gallery", "point_of_interest"]).type).toBe("Culture");
  });

  it("records which Google type decided it (audit trail)", () => {
    expect(ok("wine_bar", ["restaurant"]).matchedGoogleType).toBe("wine_bar");
  });
});

describe("refineTimeOfDay · real hours beat the type default", () => {
  const p = (oh: number, ch: number, day = 2) => ({
    open: { day, hour: oh, minute: 0 },
    close: { day, hour: ch, minute: 0 },
  });

  it("demotes an Evening type that shuts in the afternoon", () => {
    // Tongue & Brisket: 07:00-16:00, shipped as Evening/dinner
    expect(refineTimeOfDay("Evening", [p(7, 16), p(7, 16, 3)])).toBe("Day");
  });

  it("keeps Evening when it trades into the night", () => {
    expect(refineTimeOfDay("Evening", [p(17, 23)])).toBe("Evening");
  });

  it("promotes to Night when it only opens late", () => {
    expect(refineTimeOfDay("Evening", [p(21, 3)])).toBe("Night");
  });

  it("leaves the type default alone when hours are missing or 24h", () => {
    expect(refineTimeOfDay("Evening", null)).toBe("Evening");
    expect(refineTimeOfDay("Day", [])).toBe("Day");
    expect(
      refineTimeOfDay("Evening", [
        { open: { day: 1, hour: 0, minute: 0 }, close: null },
      ]),
    ).toBe("Evening");
  });

  it("does not mistake a past-midnight close for an early close", () => {
    // opens Fri 20:00, closes Sat 02:00 — must stay Evening, not become Day
    expect(
      refineTimeOfDay("Evening", [
        {
          open: { day: 5, hour: 20, minute: 0 },
          close: { day: 6, hour: 2, minute: 0 },
        },
      ]),
    ).toBe("Evening");
  });
});
