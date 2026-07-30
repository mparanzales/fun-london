// Purge expired Plan Together rooms, nightly, from .github/workflows/maintenance.yml.
//
// WHY THIS EXISTS. `purge_expired_plan_rooms()` shipped with 0001 and had no
// caller at all — no cron, no route, nothing. That is a retention problem
// rather than a storage one: `plan_room_members` is a social graph. Every row
// records that two particular accounts planned a night together, and when.
// Left uncalled it accumulates forever, long after the rooms are dead.
//
// WHAT IT DELETES. Only what the database function decides: rooms more than
// SEVEN DAYS past their expiry. Rooms expire ~6 hours after creation, so a
// room survives about a week after it stops working — long enough to
// investigate a support question, short enough not to be an archive.
// `plan_room_members` follows by ON DELETE CASCADE, and the throttle ledger is
// swept inside the same function.
//
// 🧨 THIS SCRIPT PERFORMS NO DELETES. Every write lives in
// `purge_expired_plan_rooms()`, which refuses any caller but the service role.
// An earlier draft swept the throttle ledger here using a JavaScript date,
// which put the retention window in two editable places and made the script
// destructive; the cutoff below is now used ONLY to count and to preview.
//
// 🧨 PRIVACY. This script must never print a room code, a topic, a user id or
// an email. Rooms are short-lived shared secrets and the membership table is a
// social graph — a CI log is a bad place for either, and Actions logs outlive
// the rows they describe. It prints COUNTS only. There is one deliberate
// exception: `--dry-run` prints hashed room ids so a human can correlate two
// runs without ever seeing a code.
//
// Run:
//   pnpm purge-plan-rooms:dry   # count what would go, write nothing
//   pnpm purge-plan-rooms       # delete (service role required)
//
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const DRY_RUN = process.argv.includes("--dry-run");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
  );
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Opaque, stable, non-reversible handle for a room id. Never a code. */
const handle = (id: string) =>
  createHash("sha256").update(id).digest("hex").slice(0, 8);

async function main() {
  console.log(`Plan Together room purge${DRY_RUN ? " (dry run)" : ""}\n`);

  // Count the population BEFORE, so the summary can state what changed rather
  // than merely that the job ran. "It ran" is not evidence that it did
  // anything — a silently no-op cron is how this project has lost weeks before.
  const before = await counts();
  console.log(
    `rooms ${before.rooms} · members ${before.members} · throttle rows ${before.attempts}`,
  );

  // Mirrors the function's window purely to COUNT and to preview. Nothing is
  // deleted from here; if this drifts from the SQL the only symptom is a
  // slightly wrong preview, never wrong retention.
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: doomed, error: listErr } = await sb
    .from("plan_rooms")
    .select("id")
    .lt("expires_at", cutoff);
  if (listErr) {
    console.error(`could not read plan_rooms: ${listErr.code ?? "?"}`);
    process.exit(1);
  }
  const n = doomed?.length ?? 0;
  // The function returns a ROOM count, so a ledger sweep that silently stopped
  // working would print `throttle N -> N` and still exit 0. Count what should
  // go so the summary can be checked against what did.
  const { count: staleLedger, error: ledgerErr } = await sb
    .from("plan_room_join_attempts")
    .select("*", { head: true, count: "exact" })
    .lt("window_start", cutoff);
  if (ledgerErr) {
    // Swallowing this would make the FATAL below unreachable: a failed read
    // returns a null count, which reads as "nothing was eligible".
    console.error(
      `could not count the throttle ledger: ${ledgerErr.code ?? "?"}`,
    );
    process.exit(1);
  }
  console.log(
    `\n${n} room(s) and ${staleLedger ?? 0} throttle row(s) are more than 7 days past their window.`,
  );
  if (DRY_RUN && n) {
    console.log(`hashed ids: ${doomed!.map((r) => handle(r.id)).join(", ")}`);
  }

  let purged = 0;
  if (!DRY_RUN) {
    // Delegate to the SECURITY DEFINER function: it owns the retention rule
    // and refuses any caller that is not the service role.
    // The function owns the retention rule AND the throttle-ledger sweep.
    const { data, error } = await sb.rpc("purge_expired_plan_rooms");
    if (error) {
      // Code only. A Postgres error message can quote row values, and this
      // log is a public-ish CI artefact.
      console.error(`purge failed: ${error.code ?? "?"}`);
      process.exit(1);
    }
    if (typeof data !== "number") {
      // Guards a signature change: `returns void` would otherwise make every
      // run with eligible rows report a permanent false FATAL below.
      console.error(
        `purge returned ${typeof data}, expected a row count — check the function signature.`,
      );
      process.exit(1);
    }
    purged = data;
  }

  // If this read fails the purge has ALREADY happened; reporting FATAL here
  // would tell the operator the delete did not land when it did.
  const after = await counts().catch(() => null);

  console.log("\n─────────── SUMMARY ───────────");
  console.log(
    `${DRY_RUN ? "Would purge" : "Purged"}: ${DRY_RUN ? n : purged} room(s)`,
  );
  if (after) {
    console.log(`rooms      ${before.rooms} -> ${after.rooms}`);
    console.log(`members    ${before.members} -> ${after.members}`);
    console.log(`throttle   ${before.attempts} -> ${after.attempts}`);
  } else {
    console.log("(post-purge counts unavailable; the purge itself succeeded)");
  }

  // 🧨 Fail loudly on a purge that claims success while changing nothing.
  // "Ask what changed, not whether it ran."
  if (!DRY_RUN && n > 0 && purged === 0) {
    console.error(
      `\nFATAL: ${n} room(s) were past the cutoff but the function purged 0. ` +
        `Check the service-role grant on purge_expired_plan_rooms.`,
    );
    process.exit(1);
  }
  // Same rule for the ledger, which the return value cannot speak for.
  if (!DRY_RUN && (staleLedger ?? 0) > 0) {
    // Re-count the STALE rows rather than comparing totals: a join arriving
    // between the two counts would otherwise false-FATAL a nightly job, and a
    // noisy alert is an alert that gets muted.
    const { count: stillStale, error: recountErr } = await sb
      .from("plan_room_join_attempts")
      .select("*", { head: true, count: "exact" })
      .lt("window_start", cutoff);
    if (recountErr) {
      console.error(
        `could not re-count the throttle ledger: ${recountErr.code ?? "?"}`,
      );
      process.exit(1);
    }
    if ((stillStale ?? 0) > 0) {
      console.error(
        `\nFATAL: ${stillStale} throttle row(s) are still past the cutoff after the purge. ` +
          `The sweep inside purge_expired_plan_rooms may have stopped working.`,
      );
      process.exit(1);
    }
  }
  console.log(`\n${DRY_RUN ? "Dry run complete." : "Purge complete."}`);
}

async function counts() {
  const one = async (table: string) => {
    const { count, error } = await sb
      .from(table)
      .select("*", { head: true, count: "exact" });
    if (error) throw new Error(`${table}: ${error.code ?? "?"}`);
    return count ?? 0;
  };
  return {
    rooms: await one("plan_rooms"),
    members: await one("plan_room_members"),
    attempts: await one("plan_room_join_attempts"),
  };
}

main().catch((e) => {
  console.error("\nFATAL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
