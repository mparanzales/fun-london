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

  // Dot segments. The path normaliser can manufacture a leading "//" out of an
  // input that never contained one, and the host cannot change during a
  // path-relative resolve, so an origin check on the PARSED input sees nothing
  // wrong. These are the cases that make returning the normalised path more
  // dangerous than returning the raw string.
  it.each([
    "/venue/..//evil.com",
    "/venue/../..//evil.com",
    "/%2e%2e//evil.com",
    "/a/../\\/evil.com",
    "/./..//evil.com",
  ])("rejects the dot-segment spelling %j", (raw) => {
    expect(safeReturnPath(raw)).toBe("/explore");
  });

  it("never returns anything that RESOLVES off-origin", () => {
    // 🧨 Resolve, do not concatenate. `new URL(ORIGIN + out)` is the wrong
    // model and it is why an earlier version of this test passed while
    // safeReturnPath was handing back "//evil.com": pasted after the origin
    // that string reads as a path, but every real consumer (a Location header,
    // an <a href>, redirect()) RESOLVES it, and resolved it is another site.
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
      "/venue/..//evil.com",
      "/%2e%2e//evil.com",
      "/a/../\\/evil.com",
    ];
    for (const raw of inputs) {
      const out = safeReturnPath(raw);
      expect(new URL(out, ORIGIN).origin, `input ${JSON.stringify(raw)}`).toBe(
        ORIGIN,
      );
    }
  });

  // 🧨 The normalisation that manufactures a leading "//" also promotes what
  // follows it into an AUTHORITY, and an invalid authority makes the URL
  // constructor throw rather than return a comparable origin. Uncaught that is
  // a 500 on /sign-in and /auth/callback, both public and both reachable by
  // URL alone: a hardening fix turning into a one-URL outage.
  it.each([
    "/a/..//[", // unterminated IPv6 literal
    "/a/..//x:99999", // port out of range
    "/a/..//a b", // forbidden host code point
    "/a/..//%5B",
    "/venue/../..//[",
  ])("falls back rather than throwing on %j", (raw) => {
    expect(() => safeReturnPath(raw)).not.toThrow();
    expect(safeReturnPath(raw)).toBe("/explore");
  });

  it("normalises an accepted path rather than echoing the raw string", () => {
    // Pins that the return value is the parsed form. Without this, mutating
    // the function to `return raw` leaves the rest of the file green.
    expect(safeReturnPath("/venue/./x")).toBe("/venue/x");
    expect(safeReturnPath("/venue/a/../x")).toBe("/venue/x");
  });
});
