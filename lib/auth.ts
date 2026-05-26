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
