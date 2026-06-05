// Single source of truth for the city the app is branded around.
// Swap this constant to "Madrid", "Paris", etc. to re-target the build —
// every user-facing "London" in display copy should import from here so
// the rename is a one-line change.

export const CITY = "London";

// One source of truth for the taglines so the masthead, landing and share (OG)
// images never drift apart.
//   LEAD_TAGLINE — the punchy positioning line; names the villain (chains), the
//     integrity (no paid slots) and the method (cross-checked). Lead with this.
//   TAGLINE — the deeper mission line; used as a quieter secondary / OG line.
// Both are lowercase + period-terminated on purpose (editorial voice). No dashes.
export const LEAD_TAGLINE = "no chains. no sponsored slots. checked twice.";
export const TAGLINE = "The independent London worth leaving the house for.";

// Absolute base URL of the production site. Used for canonical/OG URLs,
// sitemap and robots. Reads NEXT_PUBLIC_SITE_URL (set on Vercel + in
// .env.local) and falls back to the live domain.
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.funldn.com"
).replace(/\/$/, "");
