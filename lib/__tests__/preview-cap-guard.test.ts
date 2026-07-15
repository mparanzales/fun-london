import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PREVIEW_COUNT,
  ANON_BROWSE_MAX,
  FEED_PAGE_SIZE,
} from "@/lib/feed-constants";
import {
  fetchVenueCategoryPreview,
  fetchEventCategoryPreview,
} from "@/lib/queries";

// Guard for the anonymous metered preview. PREVIEW_COUNT was once exported
// from the "use client" feed modules; imported into the Server Components it
// arrived as `undefined`, `.limit(undefined)` silently dropped, and the anon
// /explore RSC payload shipped the ENTIRE catalogue (1,953 venues, 1.88 MB —
// the "app is super slow" bug). These tests pin all three layers of the fix.
describe("anonymous preview cap", () => {
  it("PREVIEW_COUNT is a small positive number from the neutral module", () => {
    expect(Number.isFinite(PREVIEW_COUNT)).toBe(true);
    expect(PREVIEW_COUNT).toBeGreaterThan(0);
    // "A taste, not the catalogue" — and never wider than a signed-in page.
    expect(PREVIEW_COUNT).toBeLessThanOrEqual(FEED_PAGE_SIZE);
  });

  it("ANON_BROWSE_MAX (the Just-looking cap) is bounded, never the catalogue", () => {
    // The anon browse set widens the VISIBLE LIST (card-level only; moat fields
    // are still stripped by mapVenuePreview). It must stay a BOUNDED look-around
    // so an anon session can't enumerate the whole catalogue — anti-scraping.
    expect(Number.isFinite(ANON_BROWSE_MAX)).toBe(true);
    expect(ANON_BROWSE_MAX).toBeGreaterThanOrEqual(PREVIEW_COUNT);
    // Hard ceiling: a few rows per category, not thousands of venues.
    expect(ANON_BROWSE_MAX).toBeLessThanOrEqual(50);
  });

  it("category-preview fetchers fail loudly on a broken cap, never open", async () => {
    // "4" documents that a stringly cap (e.g. read off a query param) also
    // throws — Number.isFinite rejects non-numbers.
    for (const bad of [
      undefined,
      NaN,
      0,
      -1,
      Infinity,
      "4",
    ] as unknown[] as number[]) {
      await expect(fetchVenueCategoryPreview(bad)).rejects.toThrow(
        /perCategory must be a positive number/,
      );
      await expect(fetchEventCategoryPreview(bad)).rejects.toThrow(
        /perCategory must be a positive number/,
      );
    }
  });

  it("no Server Component imports the anon cap across the client boundary", () => {
    const root = join(__dirname, "..", "..");
    // The two feed client modules must NOT export the cap...
    for (const clientModule of [
      "app/(main)/explore/explore-feed.tsx",
      "app/(main)/events/events-feed.tsx",
    ]) {
      const src = readFileSync(join(root, clientModule), "utf8");
      expect(src, `${clientModule} must not export PREVIEW_COUNT`).not.toMatch(
        /export\s+const\s+PREVIEW_COUNT/,
      );
    }
    // ...and the two server pages must import it from the neutral module only.
    for (const serverPage of [
      "app/(main)/explore/page.tsx",
      "app/(main)/events/page.tsx",
    ]) {
      const src = readFileSync(join(root, serverPage), "utf8");
      // Positive: any specifier ENDING in feed-constants (alias or relative).
      expect(
        src,
        `${serverPage} must import the cap from feed-constants`,
      ).toMatch(
        /import\s+\{[^}]*(PREVIEW_COUNT|ANON_BROWSE_MAX)[^}]*\}\s+from\s+"[^"]*feed-constants"/,
      );
      // Negative: any specifier ending in -feed (relative, alias, or app path).
      expect(
        src,
        `${serverPage} must not import the anon cap from a "use client" feed module`,
      ).not.toMatch(
        /import\s+\{[^}]*(PREVIEW_COUNT|ANON_BROWSE_MAX)[^}]*\}\s+from\s+"[^"]*-feed"/,
      );
    }
  });
});
