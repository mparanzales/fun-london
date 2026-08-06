// Single source of truth for the city the app is branded around.
// Swap this constant to "Madrid", "Paris", etc. to re-target the build —
// every user-facing "London" in display copy should import from here so
// the rename is a one-line change.

export const CITY = "London";

// The night line: the one-sentence proposition, shared by every metadata and
// OG surface so the tagline cannot drift into four diverging copies (it was
// already two casings and two phrasings when this constant was created).
//
// 🧨 It must only claim what the product can deliver on every surface it
// reaches. The earlier tail "with the table ready to book in a couple of taps"
// was cut before this shipped: there is NO live-availability feed (see the
// note in venue-detail.tsx about never surfacing "tables free"), only one of
// the four booking states is taps-to-book, and booking links are moat fields
// an anonymous visitor never sees -- yet OG/Twitter is exactly where anonymous
// visitors meet us first. What IS true on every surface is the handoff.
//
// Sentence case here is deliberate and is NOT a bug to "fix": display copy is
// lowercase, metadata is sentence case, because a lowercase opening in a
// Google snippet reads as an error to a partnerships reader.
export const NIGHT_LINE = `Fun ${CITY} builds you a night out: two or three spots, a short walk apart, in the order you'd do them. Booking happens on the venue's own platform.`;

// TAGLINE — the mission line; used as the masthead and OG secondary line.
// (A second constant, LEAD_TAGLINE, was deleted here: it had zero consumers
// repo-wide, its comment described a landing page that no longer exists, and
// it asserted "a curated guide" over a catalogue that is ~2,145 auto-discovered
// against ~46 curated. Dead copy carrying a claim we cannot back.)
export const TAGLINE = "plan the night, not the place.";

// Absolute base URL of the production site. Used for canonical/OG URLs,
// sitemap and robots. Reads NEXT_PUBLIC_SITE_URL (set on Vercel + in
// .env.local) and falls back to the live domain.
// `||` not `??`: a blank env var must fall back too, or every canonical URL in
// the sitemap goes relative. See scripts/__tests__/ci-env-fallbacks.test.ts.
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://www.funldn.com"
).replace(/\/$/, "");
