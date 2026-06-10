// The "one free peek" gate.
//
// Anonymous visitors get a single look at the metered /explore preview. The
// first time they land on /explore without a session, middleware sets this
// cookie; every visit after that (and the sign-in "skip" escape hatch) is
// walled — they must create an account. Server-side so it survives a reopened
// tab, unlike a localStorage flag.
export const PEEK_COOKIE = "fl_peeked";

// ~1 year. Long enough that the free peek is genuinely one-per-person on a
// device, short enough to eventually expire for a returning stranger.
export const PEEK_MAX_AGE = 60 * 60 * 24 * 365;
