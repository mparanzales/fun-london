// Stub that vitest.config.ts aliases "server-only" to, so importing a
// server-only module (e.g. lib/supabase/admin.ts) in a Node test does not
// throw. Real client-bundle protection is enforced by Next at build time.
export {};
