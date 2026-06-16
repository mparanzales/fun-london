// Feed page size, shared by the server (page.tsx / feedPage) and the client
// ExploreFeed. It lives in its OWN neutral module on purpose — NOT in the
// "use client" ExploreFeed — because importing a value from a client module
// into a Server Component resolves to `undefined` at runtime, which silently
// emptied the signed-in feed (limit: undefined -> slice(0, NaN) -> []).
export const FEED_PAGE_SIZE = 24;
