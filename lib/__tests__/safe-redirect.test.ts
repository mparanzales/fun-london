// ?return= must never leave our origin.
//
// The interesting cases are the ones a startsWith() check cannot see: the URL
// parser strips tab / newline / carriage return as it resolves, so a path can
// look site-internal as a string and resolve protocol-relative as a URL.

import { describe, it, expect } from "vitest";
import { safeReturnPath } from "@/lib/safe-redirect";

describe("safeReturnPath", () => {
  it("keeps ordinary internal paths, with query and hash", () => {
    expect(safeReturnPath("/explore")).toBe("/explore");
    expect(safeReturnPath("/venue/some-bar")).toBe("/venue/some-bar");
    expect(safeReturnPath("/events?when=tonight")).toBe("/events?when=tonight");
    expect(safeReturnPath("/venue/x#reviews")).toBe("/venue/x#reviews");
  });

  it("falls back on empty and non-string input", () => {
    expect(safeReturnPath(null)).toBe("/explore");
    expect(safeReturnPath(undefined)).toBe("/explore");
    expect(safeReturnPath("")).toBe("/explore");
    expect(safeReturnPath("relative")).toBe("/explore");
    expect(safeReturnPath("https://evil.com")).toBe("/explore");
  });

  it("honours a custom fallback", () => {
    expect(safeReturnPath("//evil.com", "/saved")).toBe("/saved");
  });

  // The cases the old prefix-only guard already caught.
  it.each(["//evil.com", "/\\evil.com", "\\evil.com", "\\\\evil.com"])(
    "rejects %j",
    (raw) => {
      expect(safeReturnPath(raw)).toBe("/explore");
    },
  );

  // The cases it did NOT catch. Each of these passed all three startsWith
  // tests and then resolved to "//evil.com".
  it.each([
    "/\t/evil.com",
    "/\n/evil.com",
    "/\r/evil.com",
    "/\t\\evil.com",
    "/\n\\evil.com",
    "/\t\t//evil.com",
  ])("rejects the control-character spelling %j", (raw) => {
    expect(safeReturnPath(raw)).toBe("/explore");
  });

  it("never returns anything that resolves off-origin", () => {
    // The invariant stated end to end: whatever comes back, pasted after our
    // origin, must still be our origin.
    const ORIGIN = "https://funldn.com";
    const inputs = [
      "/explore",
      "/venue/x?a=1#b",
      "//evil.com",
      "/\\evil.com",
      "/\t/evil.com",
      "/\n/evil.com",
      "/\r/evil.com",
      "https://evil.com",
      "/\t\t//evil.com",
    ];
    for (const raw of inputs) {
      const out = safeReturnPath(raw);
      expect(new URL(ORIGIN + out).origin).toBe(ORIGIN);
    }
  });
});
