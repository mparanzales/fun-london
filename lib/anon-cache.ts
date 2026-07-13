// Pure helpers for the anon ISR rewrite — kept out of the middleware so
// the routing decision is unit-testable offline.
//
// The split: cookie-less requests to a detail page are rewritten to its
// /anon twin (ISR-cached, renders signedIn=false, never reads cookies);
// requests carrying a Supabase auth cookie stay on the dynamic route.
// Moat safety is BY PATH: a signed-in request is never rewritten, so the
// CDN-cached anon page can never be built from (or served instead of) a
// signed-in render, and vice versa.

// Exact detail paths only. Deeper segments MUST pass through — e.g.
// /venue/<slug>/opengraph-image is a real route on the primary folder;
// rewriting it to /anon/... would 404 every OG image.
const ANON_CACHEABLE_RE = /^\/(venue|event)\/[^/]+$/;

export function anonCachePath(pathname: string): string | null {
  if (pathname.startsWith("/anon/")) return null; // never double-rewrite
  return ANON_CACHEABLE_RE.test(pathname) ? `/anon${pathname}` : null;
}

// Supabase SSR session cookies are named `sb-<project-ref>-auth-token`,
// chunked as `...-auth-token.0`, `...-auth-token.1` when large. Presence of
// ANY of them means "possibly signed in" → stay on the dynamic route (an
// expired cookie just renders the anon state uncached — correct, only
// slower). Absence means there is no session to refresh at all.
export function hasSupabaseAuthCookie(cookieNames: string[]): boolean {
  return cookieNames.some(
    (n) => n.startsWith("sb-") && n.includes("-auth-token"),
  );
}
