import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The storage carriers for attribution. Two invariants, both security-shaped:
//
//   ONE-SHOT. Every read removes the value BEFORE validating it. The failure
//   paths in /auth/callback arm a sign-in trigger and never consume it, so
//   without a hard one-shot a failed OAuth attempt would attribute the
//   visitor's NEXT successful sign-in, days later, to the wrong door.
//
//   ALLOW-LISTED. Both values cross a navigation. safe-redirect passes any
//   site-internal path through with its query string intact, so a value that
//   crossed a navigation unvalidated would be caller-controllable.

let sessionStore: Map<string, string>;
let localStore: Map<string, string>;

function stubWindow() {
  sessionStore = new Map<string, string>();
  localStore = new Map<string, string>();
  vi.stubGlobal("window", {
    innerWidth: 375,
    sessionStorage: {
      getItem: (k: string) => sessionStore.get(k) ?? null,
      setItem: (k: string, v: string) => void sessionStore.set(k, v),
      removeItem: (k: string) => void sessionStore.delete(k),
    },
    localStorage: {
      getItem: (k: string) => localStore.get(k) ?? null,
      setItem: (k: string, v: string) => void localStore.set(k, v),
      removeItem: (k: string) => void localStore.delete(k),
    },
  });
}

async function keys() {
  vi.resetModules();
  return await import("@/lib/analytics-keys");
}

beforeEach(() => {
  vi.unstubAllGlobals();
  stubWindow();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("entry surface", () => {
  it("round-trips a legal value", async () => {
    const k = await keys();
    k.writeEntrySurface("explore");
    expect(k.readEntrySurface()).toBe("explore");
  });

  it("is NOT one-shot: several events on the destination page need it", async () => {
    const k = await keys();
    k.writeEntrySurface("search_results");
    expect(k.readEntrySurface()).toBe("search_results");
    expect(k.readEntrySurface()).toBe("search_results");
  });

  it("falls back to direct rather than returning a stored junk value", async () => {
    const k = await keys();
    sessionStore.set(k.ENTRY_SURFACE_KEY, "javascript:alert(1)");
    expect(k.readEntrySurface()).toBe("direct");
  });

  it("reports direct when nothing was ever written", async () => {
    const k = await keys();
    expect(k.readEntrySurface()).toBe("direct");
  });

  it("never throws when storage is unavailable", async () => {
    const k = await keys();
    vi.stubGlobal("window", {
      get sessionStorage(): Storage {
        throw new Error("private mode");
      },
    });
    expect(() => k.writeEntrySurface("plan")).not.toThrow();
    expect(k.readEntrySurface()).toBe("direct");
  });

  it("validates with isEntrySurface", async () => {
    const k = await keys();
    expect(k.isEntrySurface("venue")).toBe(true);
    expect(k.isEntrySurface("VENUE")).toBe(false);
    expect(k.isEntrySurface("")).toBe(false);
    expect(k.isEntrySurface(null)).toBe(false);
    expect(k.isEntrySurface(42)).toBe(false);
  });
});

describe("plan handoff (booking attribution)", () => {
  it("round-trips for the venue that was opened", async () => {
    const k = await keys();
    k.writePlanHandoff("padella", 1);
    expect(k.readPlanHandoff("padella")).toEqual({
      slug: "padella",
      stopIndex: 1,
    });
  });

  it("is ONE-SHOT, so it cannot be replayed onto a second booking", async () => {
    const k = await keys();
    k.writePlanHandoff("padella", 0);
    expect(k.readPlanHandoff("padella")).not.toBeNull();
    expect(k.readPlanHandoff("padella")).toBeNull();
  });

  it("does not leak onto a DIFFERENT venue page", async () => {
    const k = await keys();
    k.writePlanHandoff("padella", 2);
    expect(k.readPlanHandoff("kiln")).toBeNull();
    // And the mismatched read consumed it, so it cannot be picked up later.
    expect(k.readPlanHandoff("padella")).toBeNull();
  });

  it("refuses a stop index outside 0..2", async () => {
    const k = await keys();
    for (const bad of [-1, 3, 99, 1.5, Number.NaN]) {
      k.writePlanHandoff("padella", bad);
      expect(k.readPlanHandoff("padella")).toBeNull();
    }
  });

  it("expires", async () => {
    vi.useFakeTimers();
    const k = await keys();
    k.writePlanHandoff("padella", 0);
    vi.advanceTimersByTime(6 * 60 * 1000); // TTL is 5 minutes
    expect(k.readPlanHandoff("padella")).toBeNull();
  });

  it("survives a corrupt stored value", async () => {
    const k = await keys();
    sessionStore.set(k.PLAN_HANDOFF_KEY, "{not json");
    expect(() => k.readPlanHandoff("padella")).not.toThrow();
    expect(k.readPlanHandoff("padella")).toBeNull();
  });
});

describe("sign-in trigger", () => {
  it("round-trips an allow-listed value", async () => {
    const k = await keys();
    k.writeSignInTrigger("venue_booking_cta");
    expect(k.consumeSignInTrigger()).toBe("venue_booking_cta");
  });

  it("is ONE-SHOT: a second sign-in cannot inherit the same trigger", async () => {
    const k = await keys();
    k.writeSignInTrigger("plan_save");
    expect(k.consumeSignInTrigger()).toBe("plan_save");
    expect(k.consumeSignInTrigger()).toBe("unknown");
  });

  it("returns unknown rather than omitting, so carrier loss is measurable", async () => {
    const k = await keys();
    expect(k.consumeSignInTrigger()).toBe("unknown");
  });

  it("rejects a value that is not on the allow-list", async () => {
    const k = await keys();
    localStore.set(
      k.SIGNIN_TRIGGER_KEY,
      JSON.stringify({ trigger: "<script>alert(1)</script>", at: Date.now() }),
    );
    expect(k.consumeSignInTrigger()).toBe("unknown");
  });

  it("expires, so a forgotten trigger cannot attribute tomorrow's sign-in", async () => {
    vi.useFakeTimers();
    const k = await keys();
    k.writeSignInTrigger("saved_screen");
    vi.advanceTimersByTime(16 * 60 * 1000); // TTL is 15 minutes
    expect(k.consumeSignInTrigger()).toBe("unknown");
  });

  it("is cleared on sign-out", async () => {
    const k = await keys();
    k.writeSignInTrigger("profile");
    k.clearSignInTrigger();
    expect(k.consumeSignInTrigger()).toBe("unknown");
  });

  it("validates with isSignInTrigger", async () => {
    const k = await keys();
    expect(k.isSignInTrigger("plan_save")).toBe(true);
    expect(k.isSignInTrigger("plan_save ")).toBe(false);
    expect(k.isSignInTrigger("arbitrary")).toBe(false);
    expect(k.isSignInTrigger(undefined)).toBe(false);
  });

  it("survives a corrupt stored value", async () => {
    const k = await keys();
    localStore.set(k.SIGNIN_TRIGGER_KEY, "@@@");
    expect(k.consumeSignInTrigger()).toBe("unknown");
  });
});

describe("booking return · the stop you went off to book", () => {
  // sessionStorage-backed like the handoff; same privacy shape (slug + index
  // + timestamp only), one-shot so it can never replay onto a later visit.
  it("round-trips and is one-shot", async () => {
    const k = await keys();
    k.writeBookingReturn("the-dove", 1);
    expect(k.readBookingReturn()).toEqual({ slug: "the-dove", stopIndex: 1 });
    expect(k.readBookingReturn()).toBeNull(); // consumed
  });
  it("refuses an out-of-range index and a missing slug", async () => {
    const k = await keys();
    k.writeBookingReturn("x", 5 as never);
    expect(k.readBookingReturn()).toBeNull();
    sessionStore.set(
      "fl.bookreturn.v1",
      JSON.stringify({ stopIndex: 1, at: Date.now() }),
    );
    expect(k.readBookingReturn()).toBeNull();
  });
  it("expires rather than restoring a stale trip", async () => {
    const k = await keys();
    sessionStore.set(
      "fl.bookreturn.v1",
      JSON.stringify({
        slug: "x",
        stopIndex: 0,
        at: Date.now() - 3 * 60 * 60 * 1000,
      }),
    );
    expect(k.readBookingReturn()).toBeNull();
  });
});
