// Security check for the Plan Together channel lockdown: an ANONYMOUS client
// must be rejected from a private plan-* Realtime channel (Realtime Authorization
// RLS on realtime.messages). Reads the target project from .env.local. Read-only,
// no side effects. Run: pnpm tsx scripts/verify-room-lockdown.ts

import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

// realtime-js is noisy tearing channels down in Node; we exit explicitly.
process.on("uncaughtException", () => {});
process.on("unhandledRejection", () => {});

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const envVar = (k: string) =>
  env
    .match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]
    ?.trim()
    .replace(/^["']|["']$/g, "");
const SUPABASE_URL = envVar("NEXT_PUBLIC_SUPABASE_URL")!;
const ANON = envVar("NEXT_PUBLIC_SUPABASE_ANON_KEY")!;

function anonJoinPrivate(
  topic: string,
): Promise<{ status: string; err?: string }> {
  const client = createClient(SUPABASE_URL, ANON); // no session → role `anon`
  const ch = client.channel(topic, { config: { private: true } });
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: { status: string; err?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      resolve(r);
    };
    const t = setTimeout(() => done({ status: "TIMEOUT" }), 8000);
    ch.subscribe((status, err) => {
      if (status === "SUBSCRIBED") done({ status });
      else if (status === "CHANNEL_ERROR" || status === "CLOSED")
        done({ status, err: err?.message });
    });
  });
}

async function main() {
  console.log(`\nChannel lockdown check on ${new URL(SUPABASE_URL).host}\n`);
  const r = await anonJoinPrivate("plan-VERIFYANON");
  const ok = r.status !== "SUBSCRIBED";
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  anonymous is rejected from a private plan-* channel`,
  );
  console.log(`      anon join → ${r.status}${r.err ? ` (${r.err})` : ""}`);
  console.log(
    ok
      ? "\nAnon eavesdroppers are blocked at the Realtime RLS layer.\n"
      : "\nAnon was NOT blocked — check the RLS policies / private channel config.\n",
  );
  process.exit(ok ? 0 : 1);
}

main();
