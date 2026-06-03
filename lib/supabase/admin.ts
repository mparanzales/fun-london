import { createClient } from "@supabase/supabase-js";

// Service-role Supabase client for admin-gated SERVER code that must read or
// write the internal tables locked to service_role by RLS (partner_prospects,
// pending_candidates). It bypasses RLS, so:
//   • NEVER import this into a Client Component.
//   • ALWAYS gate the caller behind getAdminUser()/isAdminEmail first.
// Returns null if SUPABASE_SERVICE_ROLE_KEY isn't configured, so callers can
// degrade gracefully instead of throwing.
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
