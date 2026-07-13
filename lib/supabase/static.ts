import { createClient } from "@supabase/supabase-js";

// Cookie-free anon-key Supabase client for PUBLIC, card-level reads that must
// NOT opt a route into dynamic rendering.
//
// The normal server client (lib/supabase/server.ts) calls next/headers
// cookies() to plumb the session — and reading cookies() forces Next into
// dynamic rendering, which SILENTLY disables `export const revalidate` on the
// ISR detail twins (/anon/venue, /anon/event). This client reads no cookies:
// it authenticates as the `anon` PostgREST role, so RLS row policies +
// column grants gate exactly what the preview fetchers already expose (the
// card columns). It is therefore safe to call inside a statically-cacheable
// render, and it removes a redundant cookie round-trip on the OG-image routes
// too.
//
// NOT for user-scoped or moat reads — those need the cookie client (session
// identity) or, server-side and admin-gated, createServiceClient().
// persistSession/autoRefresh off: this is a stateless request-scoped reader,
// there is no session to keep.
let cached: ReturnType<typeof createClient> | null = null;

export function createStaticAnonClient() {
  if (cached) return cached;
  cached = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return cached;
}
