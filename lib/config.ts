// Single source of truth for the city the app is branded around.
// Swap this constant to "Madrid", "Paris", etc. to re-target the build —
// every user-facing "London" in display copy should import from here so
// the rename is a one-line change.

export const CITY = "London";

// One source of truth for the hero tagline so onboarding, the Explore
// masthead and the share (OG) images can never drift apart.
export const TAGLINE = "The independent London worth leaving the house for.";

// Absolute base URL of the production site. Used for canonical/OG URLs,
// sitemap and robots. Reads NEXT_PUBLIC_SITE_URL (set on Vercel + in
// .env.local) and falls back to the live domain.
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.funldn.com"
).replace(/\/$/, "");
