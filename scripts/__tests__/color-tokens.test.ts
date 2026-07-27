import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "node:url";

// Guard: every theme colour in tailwind.config.ts must be able to carry an
// `/opacity` modifier.
//
// WHY THIS EXISTS. A colour declared as a bare `var(--fl-x)` silently breaks
// every opacity variant of itself. Tailwind v3 parses the colour to inject an
// alpha channel; `parseColor("var(--fl-x)")` returns null, the utility is
// dropped, and nothing is emitted — no warning, no error, no failing build.
//
// Measured, not assumed (2026-07-27): with bare `var()` tokens, **98
// occurrences across 27 files** produced no CSS at all — `bg-primary/10`,
// `border-fg/15`, `text-muted-fg/70` and friends. Real consequences on the
// live app: the auth wall's icon tile had no tint, and the divider hairlines
// either side of "OR" on /sign-in were completely invisible. Verified in the
// built CSS with a positive control: `.text-muted-fg` was emitted while
// `.text-muted-fg\/70` was absent, though 13 unrelated opacity classes (on
// real colour literals like `white`) were emitted fine.
//
// The fix wraps each token in color-mix, which keeps `--fl-*` as real colour
// values so the 18 places that use `var(--fl-…)` directly (gradients, the
// auth-wall backdrop, the body colour) keep working. A channel-triplet
// migration would have broken every one of them.
//
// If this test fails, someone "simplified" a token back to a bare `var()`.
// Restore the color-mix wrapper — do NOT delete this test, and do NOT strip
// the `/opacity` modifiers from the call sites instead.

const CONFIG = readFileSync(
  fileURLToPath(new URL("../../tailwind.config.ts", import.meta.url)),
  "utf8",
);

// The theme colour names that must support an alpha modifier.
const TOKENS = [
  "bg",
  "fg",
  "muted",
  "muted-fg",
  "card",
  "border",
  "primary",
  "primary-fg",
  "accent",
  "accent-fg",
  "heading",
];

describe("theme colour tokens support opacity modifiers", () => {
  it("declares every token", () => {
    // Sanity check: if the config stops listing these, the test below would
    // pass vacuously.
    for (const t of TOKENS) {
      expect(CONFIG, `token "${t}" missing from tailwind.config.ts`).toContain(
        `--fl-${t}`,
      );
    }
  });

  it("never declares a colour as a bare var() — that kills /opacity silently", () => {
    // A bare `"name": "var(--fl-x)"` mapping is the broken shape.
    const bare = [...CONFIG.matchAll(/"[a-z-]+"\s*:\s*"var\(--fl-[a-z-]+\)"/g)]
      .map((m) => m[0])
      .filter(Boolean);
    expect(
      bare,
      `These colours are declared as a bare var(), so Tailwind will silently ` +
        `drop every /opacity utility built from them (98 such classes existed ` +
        `across 27 files before this was fixed). Wrap them in color-mix with ` +
        `<alpha-value>.`,
    ).toEqual([]);
  });

  it("routes tokens through color-mix with <alpha-value>", () => {
    expect(CONFIG).toContain("<alpha-value>");
    expect(CONFIG).toContain("color-mix(in srgb");
  });
});
