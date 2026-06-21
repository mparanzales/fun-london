// Single source of truth for the city the app is branded around.
// Swap this constant to "Madrid", "Paris", etc. to re-target the build —
// every user-facing "London" in display copy should import from here so
// the rename is a one-line change.

export const CITY = "London";

// One source of truth for the taglines so the masthead, landing and share (OG)
// images never drift apart.
//   LEAD_TAGLINE — a short positioning line.
//   TAGLINE — the deeper mission line; used as a quieter secondary / OG line.
export const LEAD_TAGLINE = "a curated guide to going out in london.";
export const TAGLINE = "The London worth leaving the house for.";

// Absolute base URL of the production site. Used for canonical/OG URLs,
// sitemap and robots. Reads NEXT_PUBLIC_SITE_URL (set on Vercel + in
// .env.local) and falls back to the live domain.
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.funldn.com"
).replace(/\/$/, "");
