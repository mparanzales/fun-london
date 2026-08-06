// The scheme allowlist that keeps catalogue URLs out of executable hrefs.
//
// These are behavioural, not structural: they run the real helper over the
// values an attacker would actually store, including the obfuscations that
// defeat a naive string check. The companion file external-href-sink-guard
// .test.ts checks that the app's sinks are WIRED to this helper.

import { describe, it, expect } from "vitest";
import { parseExternalUrl, safeExternalHref } from "@/lib/safe-url";

// Every one of these, stored in a venue's website_url / menu_url, an event's
// source_url, or a booking link, would be a live XSS if it reached an href.
const HOSTILE = [
  "javascript:alert(1)",
  "javascript:alert(document.cookie)",
  // Scheme case is folded by the URL parser, so one allowlist covers all of
  // these spellings. A naive startsWith("javascript:") does not.
  "JavaScript:alert(1)",
  "JAVASCRIPT:alert(1)",
  "jAvAsCrIpT:alert(1)",
  // The parser strips leading whitespace and embedded tabs/newlines BEFORE
  // resolving the scheme, exactly as a browser does. A denylist run against
  // the raw string sees "java\nscript:" and lets it past.
  "  javascript:alert(1)",
  "\tjavascript:alert(1)",
  "java\nscript:alert(1)",
  "java\tscript:alert(1)",
  "java\rscript:alert(1)",
  // Non-javascript schemes that are still not ours to navigate to.
  "data:text/html,<script>alert(1)</script>",
  "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
  "vbscript:msgbox(1)",
  "file:///etc/passwd",
  "blob:https://funldn.com/8f2c",
  "about:blank",
  "chrome://settings",
  "intent://scan/#Intent;scheme=zxing;end",
];

const SAFE = [
  "https://example.com",
  "https://example.com/menu",
  "https://www.opentable.co.uk/r/somewhere?ref=x",
  "http://example.com",
  "https://example.com:8443/path?a=1#frag",
];

describe("parseExternalUrl", () => {
  it("accepts http and https only", () => {
    expect(parseExternalUrl("https://example.com")?.protocol).toBe("https:");
    expect(parseExternalUrl("http://example.com")?.protocol).toBe("http:");
  });

  it.each(HOSTILE)("rejects %j", (raw) => {
    expect(parseExternalUrl(raw)).toBeNull();
  });

  it("rejects empty and non-string input", () => {
    expect(parseExternalUrl(null)).toBeNull();
    expect(parseExternalUrl(undefined)).toBeNull();
    expect(parseExternalUrl("")).toBeNull();
  });

  it("rejects relative and bare-host values rather than guessing a scheme", () => {
    // These render as a same-origin link today (funldn.com/www.example.com),
    // which is already broken. Upgrading them to https would invent a
    // destination we were never given.
    expect(parseExternalUrl("/menu")).toBeNull();
    expect(parseExternalUrl("www.example.com")).toBeNull();
    expect(parseExternalUrl("example.com/menu")).toBeNull();
    expect(parseExternalUrl("//example.com")).toBeNull();
  });
});

describe("safeExternalHref", () => {
  it.each(HOSTILE)("never returns a value for %j", (raw) => {
    expect(safeExternalHref(raw)).toBeNull();
  });

  it.each(SAFE)("passes %j through", (raw) => {
    expect(safeExternalHref(raw)).not.toBeNull();
  });

  it("returns the parsed serialisation, not the caller's original string", () => {
    // What we validated must be what reaches the DOM: if the two could differ,
    // a re-parse in the browser could resolve to something we never checked.
    expect(safeExternalHref("  https://example.com/x  ")).toBe(
      "https://example.com/x",
    );
    expect(safeExternalHref("https://example.com")).toBe(
      "https://example.com/",
    );
  });

  it("no output ever begins with a non-web scheme", () => {
    // The invariant stated directly, over the whole corpus.
    for (const raw of [...HOSTILE, ...SAFE]) {
      const out = safeExternalHref(raw);
      if (out === null) continue;
      expect(out).toMatch(/^https?:\/\//);
    }
  });
});
