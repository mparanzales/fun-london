// ─────────────────────────────────────────────────────────────────────────
// Server-side auth helper.
//
// Wraps Supabase's auth.getClaims() into a single import path so Server
// Components don't need to spin up their own supabase server client just
// to check who's signed in. Returns null when anonymous (auth-optional).
//
// Why getClaims() and not getUser():
//   The middleware (lib/supabase/middleware.ts) ALREADY calls getUser() on
//   every request — that round-trip validates AND refreshes the session
//   cookie and must stay. Each page then calling getUser() AGAIN paid a
//   second, redundant network round-trip to Supabase Auth just to read the
//   signed-in identity. getClaims() reads that identity from the (already
//   refreshed) JWT instead. With asymmetric JWT signing keys enabled in the
//   Supabase dashboard, getClaims() verifies the token LOCALLY — zero network
//   — so the win is fully realized only once that toggle is on. On legacy
//   symmetric keys it may still call the server to verify, but it is correct
//   either way. The cookie refresh is unaffected (it lives in middleware).
//
// Identity shape: every caller of getAuthUser()/getAdminUser() reads only
// `.id` and/or `.email` (audited), both of which live in the JWT claims
// (`sub`, `email`). We therefore return a minimal AuthUser; no other User
// field is dropped silently. If a caller ever needs a non-claim field
// (user_metadata, created_at, …) add a separate getFullUser() on getUser().
//
// Always call from a Server Component / Route Handler / Server Action —
// it reads cookies via lib/supabase/server.ts.
// ─────────────────────────────────────────────────────────────────────────

import { createClient } from "@/lib/supabase/server";

/** Minimal signed-in identity, sourced from JWT claims (sub, email). */
export type AuthUser = { id: string; email?: string };

export async function getAuthUser(): Promise<AuthUser | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  return { id: claims.sub, email: claims.email };
}

// ─────────────────────────────────────────────────────────────────────────
// Admin allowlist — gates internal routes like /admin/candidates.
//
// Keep this list tiny and explicit. Anyone whose Supabase user email is
// not in this set sees a "not authorised" branch on admin pages. No DB
// table, no role column — the simplest thing that works for a one-PM
// product, easy to audit, and easy to extend (env var) when the team
// grows past one.
// ─────────────────────────────────────────────────────────────────────────

// Fail CLOSED: if FL_ADMIN_EMAILS is unset, nobody is an admin (an env
// misconfiguration can't silently grant access). FL_ADMIN_EMAILS is set in the
// host env (Production + Preview); for local /admin access, set it in your
// .env.local (see .env.example). Comma-separated list of admin emails.
const RAW_ADMIN_EMAILS = process.env.FL_ADMIN_EMAILS ?? "";

const ADMIN_EMAILS = new Set(
  RAW_ADMIN_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.has(email.trim().toLowerCase());
}

export async function getAdminUser(): Promise<AuthUser | null> {
  const user = await getAuthUser();
  if (!user) return null;
  return isAdminEmail(user.email) ? user : null;
}
