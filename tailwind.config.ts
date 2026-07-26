import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // 🧨 Each colour is wrapped in color-mix so the `/opacity` modifier
      // actually works. A bare `var(--fl-x)` CANNOT carry one: Tailwind v3
      // parses the colour to inject an alpha channel, parseColor() returns
      // null for a `var()`, and the utility is then dropped SILENTLY — no
      // warning, no error, no CSS. Every `bg-primary/10`, `border-fg/15`,
      // `text-muted-fg/70` in this codebase (98 of them across 27 files) was
      // emitting nothing at all, so those tints, hairlines and muted greys
      // simply did not render. Proven in the built CSS with a positive
      // control: `.text-muted-fg` was emitted, `.text-muted-fg\/70` was not.
      //
      // color-mix keeps `--fl-*` as real colour values, so the 18 places that
      // use `var(--fl-…)` directly (gradients, the auth-wall backdrop, the
      // body colour) are untouched — unlike a channel-triplet migration,
      // which would have broken every one of them.
      //
      // Tailwind substitutes `1` for `<alpha-value>` when no modifier is
      // used, so `calc(1 * 100%)` = 100% and the plain utility is unchanged.
      // Do NOT "simplify" these back to bare `var()`; dependency-pins-style
      // guard: scripts/__tests__/color-tokens.test.ts.
      colors: Object.fromEntries(
        [
          ["bg", "--fl-bg"],
          ["fg", "--fl-fg"],
          ["muted", "--fl-muted"],
          ["muted-fg", "--fl-muted-fg"],
          ["card", "--fl-card"],
          ["border", "--fl-border"],
          ["primary", "--fl-primary"],
          ["primary-fg", "--fl-primary-fg"],
          ["accent", "--fl-accent"],
          ["accent-fg", "--fl-accent-fg"],
          ["heading", "--fl-heading"],
        ].map(([name, cssVar]) => [
          name,
          `color-mix(in srgb, var(${cssVar}) calc(<alpha-value> * 100%), transparent)`,
        ]),
      ),
      fontFamily: {
        sans: ["var(--font-jakarta)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        soft: "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)",
        card: "0 1px 3px rgba(0,0,0,0.06), 0 6px 20px rgba(0,0,0,0.06)",
        elev: "0 8px 28px rgba(0,0,0,0.12)",
      },
      borderRadius: {
        xl2: "1.25rem",
      },
      // Extend Tailwind's default spacing scale with half-step values
      // the codebase already uses (4.5, 5.5, 6.5). Without these,
      // classes like `bottom-4.5` and `pb-5.5` silently fail —
      // a real bug we caught when the Swipe step's question text
      // landed on top of the mood pill instead of at the card's
      // bottom edge.
      spacing: {
        "4.5": "1.125rem", // 18px
        "5.5": "1.375rem", // 22px
        "6.5": "1.625rem", // 26px
      },
    },
  },
  plugins: [],
};

export default config;
