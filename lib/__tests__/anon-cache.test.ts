import { describe, expect, it } from "vitest";
import { anonCachePath, hasSupabaseAuthCookie } from "@/lib/anon-cache";

describe("anonCachePath (ISR rewrite targeting)", () => {
  it("rewrites exact venue/event detail paths", () => {
    expect(anonCachePath("/venue/padella")).toBe("/anon/venue/padella");
    expect(anonCachePath("/event/6dcc2236-b00c")).toBe(
      "/anon/event/6dcc2236-b00c",
    );
  });

  it("passes deeper segments through (OG images would 404 otherwise)", () => {
    expect(anonCachePath("/venue/padella/opengraph-image")).toBeNull();
    expect(anonCachePath("/event/abc/opengraph-image")).toBeNull();
  });

  it("passes everything else through", () => {
    expect(anonCachePath("/")).toBeNull();
    expect(anonCachePath("/explore")).toBeNull();
    expect(anonCachePath("/venue/")).toBeNull();
    expect(anonCachePath("/venues/padella")).toBeNull();
    expect(anonCachePath("/sign-in")).toBeNull();
  });

  it("never double-rewrites an /anon path", () => {
    expect(anonCachePath("/anon/venue/padella")).toBeNull();
  });

  it("normalizes a single trailing slash so it still rewrites", () => {
    expect(anonCachePath("/venue/padella/")).toBe("/anon/venue/padella");
    expect(anonCachePath("/event/abc/")).toBe("/anon/event/abc");
    // trailing slash must not turn a deeper segment into a match
    expect(anonCachePath("/venue/padella/opengraph-image/")).toBeNull();
  });
});

describe("hasSupabaseAuthCookie", () => {
  it("detects plain and chunked supabase auth cookies", () => {
    expect(hasSupabaseAuthCookie(["sb-fxfuzabr-auth-token"])).toBe(true);
    expect(hasSupabaseAuthCookie(["sb-fxfuzabr-auth-token.0"])).toBe(true);
    expect(hasSupabaseAuthCookie(["sb-fxfuzabr-auth-token.1", "other"])).toBe(
      true,
    );
  });

  it("ignores unrelated cookies (consent, analytics, none)", () => {
    expect(hasSupabaseAuthCookie([])).toBe(false);
    expect(hasSupabaseAuthCookie(["fl-consent", "ph_phc_x"])).toBe(false);
  });

  it("treats the PKCE verifier cookie as 'has cookie' (safe over-detection)", () => {
    // Supabase's real mid-OAuth cookie is `sb-<ref>-auth-token-code-verifier`,
    // which contains `-auth-token` and so matches → routes to the DYNAMIC path.
    // That is the SAFE direction: the matcher must always fail toward "has
    // cookie" (dynamic, never cached), never toward serving the anon cache to
    // someone who might be mid-auth. Do NOT "optimize" by excluding verifier
    // names.
    expect(
      hasSupabaseAuthCookie(["sb-fxfuzabr-auth-token-code-verifier"]),
    ).toBe(true);
  });
});
