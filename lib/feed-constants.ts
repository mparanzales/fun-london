// Feed page size, shared by the server (page.tsx / feedPage) and the client
// ExploreFeed. It lives in its OWN neutral module on purpose — NOT in the
// "use client" ExploreFeed — because importing a value from a client module
// into a Server Component resolves to `undefined` at runtime, which silently
// emptied the signed-in feed (limit: undefined -> slice(0, NaN) -> []).
export const FEED_PAGE_SIZE = 24;

// How many cards a signed-out visitor sees per category before the sign-up
// wall — a taste, not the catalogue. Lives HERE for the same reason as
// FEED_PAGE_SIZE: when this was exported from the "use client" feed modules,
// the Server Components received `undefined`, `.limit(undefined)` silently
// dropped, and the anonymous /explore RSC payload shipped the ENTIRE
// catalogue (1,953 venues, 1.88 MB — the "app is super slow" bug).
export const PREVIEW_COUNT = 4;
