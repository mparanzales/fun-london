import { describe, it, expect } from "vitest";
import { isSignOutTransition } from "@/lib/auth-transition";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

describe("isSignOutTransition", () => {
  it("fires on sign-out, uuid to null: the data-bleed guard", () => {
    // The regression: signed in as A, then SIGNED_OUT flips authUserId to null.
    // Without a reset here A's saved/booking set is retained in memory,
    // persisted to localStorage, and later migrated into the next account.
    expect(isSignOutTransition(A, null)).toBe(true);
  });

  it("does NOT fire on a normal anonymous mount (null → null)", () => {
    // A genuine anon user must keep their localStorage saved spots — clearing
    // here would wipe them on every page load.
    expect(isSignOutTransition(null, null)).toBe(false);
  });

  it("does NOT fire on sign-in (null → uuid)", () => {
    // Sign-in migrates localStorage into the DB; nothing to clear.
    expect(isSignOutTransition(null, A)).toBe(false);
  });

  it("does NOT fire on token refresh (uuid → same uuid)", () => {
    expect(isSignOutTransition(A, A)).toBe(false);
  });

  it("does NOT fire on a direct account switch (uuid → different uuid)", () => {
    // In practice sign-out always routes through null first; a direct switch
    // re-hydrates authoritatively from B's DB rows, so there is nothing to
    // bleed and no clear is needed.
    expect(isSignOutTransition(A, B)).toBe(false);
  });
});
