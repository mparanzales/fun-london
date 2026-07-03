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

// Attempt an anonymous join of a plan-* topic, either as a private channel
// (RLS-gated) or a public one (the bypass the "Allow public access" toggle
// closes). Both must be rejected once the room is locked down.
function anonJoin(
  topic: string,
  isPrivate: boolean,
): Promise<{ status: string; err?: string }> {
  const client = createClient(SUPABASE_URL, ANON); // no session → role `anon`
  const ch = client.channel(topic, { config: { private: isPrivate } });
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

  const priv = await anonJoin("plan-VERIFYPRIV", true);
  const pub = await anonJoin("plan-VERIFYPUB", false);
  const okPriv = priv.status !== "SUBSCRIBED";
  const okPub = pub.status !== "SUBSCRIBED";
  const ok = okPriv && okPub;

  console.log(
    `  ${okPriv ? "PASS" : "FAIL"}  anon rejected from a PRIVATE plan-* channel (RLS)`,
  );
  console.log(`      → ${priv.status}${priv.err ? ` (${priv.err})` : ""}`);
  console.log(
    `  ${okPub ? "PASS" : "FAIL"}  anon rejected from a PUBLIC plan-* channel (public access off)`,
  );
  console.log(`      → ${pub.status}${pub.err ? ` (${pub.err})` : ""}`);
  console.log(
    ok
      ? "\nBoth paths blocked — anon eavesdroppers can no longer read the room.\n"
      : okPriv
        ? "\nPRIVATE is locked but PUBLIC still joins — 'Allow public access' is still ON.\n"
        : "\nAnon was NOT blocked — check the RLS policies / private channel config.\n",
  );
  process.exit(ok ? 0 : 1);
}

main();
