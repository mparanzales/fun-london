// One-off helper: copy the public CATALOGUE (venues + events) from PROD → DEV
// Supabase, so the dev database isn't empty for a teammate.
//
// Copies ONLY catalogue tables. It never touches user data (profiles, bookings,
// saved_venues, feedback) — those stay in prod and never reach dev.
//
// Env (in .env.local):
//   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY   → your existing PROD values
//   DEV_SUPABASE_URL=https://rcecrnflwfshjpygfskx.supabase.co
//   DEV_SUPABASE_SERVICE_ROLE_KEY=<dev project's service_role key, from its dashboard>
//
// Run:  pnpm exec tsx scripts/seed-dev-from-prod.ts
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const PROD_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PROD_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DEV_URL = process.env.DEV_SUPABASE_URL;
const DEV_KEY = process.env.DEV_SUPABASE_SERVICE_ROLE_KEY;

if (!PROD_URL || !PROD_KEY || !DEV_URL || !DEV_KEY) {
  console.error(
    "Missing env. Need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (prod) " +
      "and DEV_SUPABASE_URL + DEV_SUPABASE_SERVICE_ROLE_KEY (dev) in .env.local.",
  );
  process.exit(1);
}

// 🧨 The only genuinely dangerous mistake here is pointing DEV at PROD: this
// writes with a service-role key, so it would bypass RLS and upsert straight
// over the live catalogue. Refuse rather than trust the operator's env file.
if (new URL(DEV_URL).host === new URL(PROD_URL).host) {
  console.error(
    `Refusing to run: DEV_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_URL are the ` +
      `same project (${new URL(DEV_URL).host}). This script upserts with a ` +
      `service-role key, so that would overwrite the live catalogue.`,
  );
  process.exit(1);
}

const prod = createClient(PROD_URL, PROD_KEY, {
  auth: { persistSession: false },
});
const dev = createClient(DEV_URL, DEV_KEY, { auth: { persistSession: false } });

async function copyTable(table: string) {
  const { data, error } = await prod.from(table).select("*");
  if (error) throw new Error(`read ${table}: ${error.message}`);
  const rows = data ?? [];
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const { error: e2 } = await dev
      .from(table)
      .upsert(batch, { onConflict: "id" });
    if (e2) throw new Error(`write ${table} (batch ${i}): ${e2.message}`);
  }
  console.log(`  ✅ ${table}: copied ${rows.length} rows`);
}

(async () => {
  console.log(`Copying catalogue PROD → DEV (${DEV_URL}) ...`);
  await copyTable("venues"); // venues first — events.venue_id references them
  await copyTable("events");
  console.log("Done. Dev now mirrors the prod catalogue.");
})().catch((e) => {
  console.error("Seed failed:", e.message);
  process.exit(1);
});
