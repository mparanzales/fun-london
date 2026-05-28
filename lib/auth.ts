// ─────────────────────────────────────────────────────────────────────────
// Server-side auth helper.
//
// Wraps Supabase's auth.getUser() into a single import path so Server
// Components don't need to spin up their own supabase server client just
// to check who's signed in. Returns null when anonymous (auth-optional).
//
// Always call from a Server Component / Route Handler / Server Action —
// it reads cookies via lib/supabase/server.ts.
// ─────────────────────────────────────────────────────────────────────────

import { createClient } from "@/lib/supabase/server";
import type { User } from "@supabase/supabase-js";

export async function getAuthUser(): Promise<User | null> {
  const supabase = createClient();
  const { data } = await supabase.auth.getUser();
  return data.user;
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

const ADMIN_EMAILS = new Set(
  (process.env.FL_ADMIN_EMAILS ?? "mp.aranzales@gmail.com")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.has(email.trim().toLowerCase());
}

export async function getAdminUser(): Promise<User | null> {
  const user = await getAuthUser();
  if (!user) return null;
  return isAdminEmail(user.email) ? user : null;
}
