import { describe, it, expect } from "vitest";
import { sanitizeContext } from "../signals";

// sanitizeContext is the SOLE guard for the "coarse, non-identifying context
// only" invariant (the DB CHECK can't inspect nested JSON). These tests pin
// that guard: PII / precise-geo keys are dropped, coarse signals pass.

describe("sanitizeContext", () => {
  it("keeps coarse, non-identifying signals", () => {
    expect(
      sanitizeContext({
        rank: 3,
        position: 12,
        query_len: 8,
        area: "Fitzrovia",
        from_filter: true,
        target: "menu",
      }),
    ).toEqual({
      rank: 3,
      position: 12,
      query_len: 8,
      area: "Fitzrovia",
      from_filter: true,
      target: "menu",
    });
  });

  it("drops precise-geolocation keys", () => {
    const out = sanitizeContext({
      lat: 51.5207,
      lng: -0.1418,
      geohash: "gcpvj0",
      coords: "51.52,-0.14",
      rank: 1,
    });
    expect(out).toEqual({ rank: 1 });
    expect(out).not.toHaveProperty("lat");
    expect(out).not.toHaveProperty("lng");
    expect(out).not.toHaveProperty("geohash");
    expect(out).not.toHaveProperty("coords");
  });

  it("drops PII-ish keys (email, phone, name, address, ip, device, token)", () => {
    const out = sanitizeContext({
      email: "a@b.com",
      phone: "07000000000",
      venue_name: "Padella",
      address: "6 Southwark St",
      postcode: "SE1 1TQ",
      ip: "1.2.3.4",
      device_id: "abc",
      access_token: "xyz",
      user_id: "u1",
      session_id: "s1",
      rank: 2,
    });
    expect(out).toEqual({ rank: 2 });
  });

  it("clamps over-long strings to 120 chars and drops undefined", () => {
    const long = "x".repeat(300);
    const out = sanitizeContext({ note: long, skip: undefined, ok: "fine" });
    expect((out.note as string).length).toBe(120);
    expect(out).not.toHaveProperty("skip");
    expect(out.ok).toBe("fine");
  });

  it("returns an empty object for undefined / empty input", () => {
    expect(sanitizeContext()).toEqual({});
    expect(sanitizeContext({})).toEqual({});
  });

  it("does not over-block coarse keys that merely contain a substring", () => {
    // 'length' contains no blocked token; 'neighbourhood' is not 'name';
    // 'long_press' should be blocked (starts with 'long'), but 'belonging'
    // must NOT be (the token is bounded by _ or string edges).
    const out = sanitizeContext({
      length: 5,
      neighbourhood: "Soho",
      belonging: "x",
    });
    expect(out).toEqual({ length: 5, neighbourhood: "Soho", belonging: "x" });
  });
});
