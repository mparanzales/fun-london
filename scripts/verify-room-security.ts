/**
 * Live verification for the Plan Together security track.
 *
 * READ-ONLY against whatever database SUPABASE_* points at. It creates no
 * rooms, joins nothing and deletes nothing — it inspects catalog state and
 * reports. Run it:
 *
 *   · after 0001  → tables/functions/grants exist, policies unchanged
 *   · after 0002  → the membership-scoped policies are live alongside the old
 *                   broad ones (this is the dual-run checkpoint)
 *   · after 0003  → the broad plan-% policies are GONE and only the scoped
 *                   ones remain  ← the gate for calling the exposure closed
 *
 *   pnpm tsx scripts/verify-room-security.ts
 *
 * Exit code is 1 when a REQUIRED invariant for the detected stage fails, so
 * it can gate a deploy step. Stage is detected, not assumed.
 *
 * 🧨 Never prints a room code. Room identifiers are shown hashed.
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { hashRoomCode } from "@/lib/room-code";
import { isLoopback, refFromKey } from "./staging-guard";

/**
 * Deliberately NOT `@/lib/supabase/admin`.
 *
 * That module opens with `import "server-only"`, which Next resolves during a
 * build but which is not an installed package — so importing it here made this
 * script die with MODULE_NOT_FOUND before its first line ran. The header above
 * has always told you to run it with `pnpm tsx`; until this was found (during
 * the local staging run, 2026-07-29) that was impossible, which means the
 * documented production gate could never have gated anything.
 *
 * The service client is four lines, so build it here and leave admin.ts's
 * mechanical client-bundle guard intact for application code.
 */
function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type PolicyRow = {
  policyname: string;
  cmd: string;
  qual: string | null;
  with_check: string | null;
};

const OK = "✅";
const BAD = "❌";
const INFO = "· ";

let failures = 0;
function check(pass: boolean, label: string, detail = "") {
  if (!pass) failures++;
  console.log(`${pass ? OK : BAD} ${label}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const supabase = createServiceClient();
  if (!supabase) {
    console.error(
      "No service-role client. Set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (see lib/supabase/admin.ts).",
    );
    process.exit(1);
  }

  // 🧨 NAME THE DATABASE, ALWAYS.
  //
  // This script loads .env.local, which means it certifies whatever that file
  // happens to point at. During the staging run that file pointed at a loopback
  // stack — so `EXPECT_STAGE=3 … → "All required invariants hold." → exit 0`
  // could have authorised closing the PRODUCTION exposure while describing a
  // local database, with nothing in the output to give it away. A gate that
  // does not say what it inspected is not a gate.
  const targetUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  let targetHost = "(unparseable)";
  try {
    targetHost = new URL(targetUrl).host;
  } catch {
    /* leave as unparseable */
  }
  const keyRef = refFromKey(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "");
  console.log(
    `Target: ${targetHost}${keyRef ? ` (key names project ${keyRef})` : " (key names no project)"}`,
  );
  if (keyRef && targetHost !== "(unparseable)" && !targetHost.includes(keyRef)) {
    console.error(
      "REFUSING: the service key belongs to a different project than the URL.",
    );
    process.exit(1);
  }
  // A staged run against a local stack must opt in explicitly, so that a
  // forgotten .env.local can never be mistaken for the production cutover.
  if (isLoopback(targetUrl) && process.env.EXPECT_STAGE) {
    if (process.env.ALLOW_LOCAL !== "1") {
      console.error(
        "REFUSING: EXPECT_STAGE is set but the target is loopback. Set ALLOW_LOCAL=1 to verify a local stack on purpose.",
      );
      process.exit(1);
    }
    console.log("(local stack, ALLOW_LOCAL=1)");
  }

  // Catalog reads go through a SQL helper because PostgREST cannot select
  // from pg_policies directly.
  const q = async <T>(sql: string): Promise<T[]> => {
    const { data, error } = await supabase.rpc("exec_sql_readonly", { q: sql });
    if (error)
      throw new Error(
        `${error.message} (add the read-only SQL helper or run this SQL by hand)`,
      );
    return (data ?? []) as T[];
  };

  console.log("\n── Plan Together security verification ──\n");

  // ── 1. Schema ─────────────────────────────────────────────────────────
  const tables = await q<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema='public' and table_name in ('plan_rooms','plan_room_members')`,
  );
  const names = tables.map((t) => t.table_name).sort();
  const stage1 = names.length === 2;
  check(
    stage1,
    "0001 applied: plan_rooms + plan_room_members exist",
    names.join(", ") || "none",
  );

  if (!stage1) {
    console.log("\nStage: PRE-0001. Nothing else to verify yet.\n");
    process.exit(failures > 0 ? 1 : 0);
  }

  const fns = await q<{
    proname: string;
    prosecdef: boolean;
    proconfig: string | null;
  }>(
    `select p.proname, p.prosecdef, array_to_string(p.proconfig, ',') as proconfig
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname like '%plan_room%'`,
  );
  check(
    fns.some((f) => f.proname === "is_plan_room_member" && f.prosecdef),
    "membership predicate is SECURITY DEFINER",
  );
  const unpinned = fns.filter(
    (f) => f.prosecdef && !(f.proconfig ?? "").includes("search_path"),
  );
  check(
    unpinned.length === 0,
    "every definer function pins search_path",
    unpinned.map((f) => f.proname).join(", "),
  );

  // ── 2. RLS on the new tables ─────────────────────────────────────────
  const rls = await q<{ relname: string; relrowsecurity: boolean }>(
    `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in ('plan_rooms','plan_room_members')`,
  );
  check(
    rls.every((r) => r.relrowsecurity),
    "RLS enabled on both room tables",
  );

  const writePolicies = await q<PolicyRow>(
    `select policyname, cmd, qual, with_check from pg_policies
      where schemaname='public' and tablename in ('plan_rooms','plan_room_members')
        and cmd in ('INSERT','UPDATE','DELETE')`,
  );
  check(
    writePolicies.length === 0,
    "no client write policies on room tables (writes go via definer functions only)",
    writePolicies.map((p) => `${p.policyname}:${p.cmd}`).join(", "),
  );

  // ── 3. Realtime policies — the staged part ───────────────────────────
  const rt = await q<PolicyRow>(
    `select policyname, cmd, qual, with_check from pg_policies
      where schemaname='realtime' and tablename='messages'`,
  );
  const scoped = rt.filter((p) =>
    `${p.qual ?? ""}${p.with_check ?? ""}`.includes("is_plan_room_member"),
  );
  const broad = rt.filter(
    (p) =>
      `${p.qual ?? ""}${p.with_check ?? ""}`.includes("plan-%") &&
      !`${p.qual ?? ""}${p.with_check ?? ""}`.includes("is_plan_room_member"),
  );

  console.log(
    `${INFO}realtime.messages policies: ${rt.length} total · ${scoped.length} membership-scoped · ${broad.length} broad plan-%`,
  );

  // 🧨 The expected stage comes from the OPERATOR, not from the data. Deriving
  // it from `broad.length` (as this script first did) made the stage-3
  // assertion a tautology: "stage 3 means no broad policies" then "assert no
  // broad policies" can never fail, so a silently no-op DROP in 0003 would
  // have reported success with the exposure fully open.
  // 🧨 A deploy gate that disables itself on a malformed value is the same
  // family as "the CI secret was an empty string so `??` never fired". If the
  // variable is set at all, it must name a real stage.
  const rawExpected = process.env.EXPECT_STAGE;
  if (
    rawExpected !== undefined &&
    !["1", "2", "3"].includes(rawExpected.trim())
  ) {
    console.error(
      `EXPECT_STAGE=${rawExpected} is not 1, 2 or 3. Refusing to run ungated.`,
    );
    process.exit(1);
  }
  const expected = Number(rawExpected ?? "0");
  const stage = scoped.length === 0 ? 1 : broad.length > 0 ? 2 : 3;
  if (expected) {
    check(
      stage >= expected,
      `reached the expected stage (EXPECT_STAGE=${expected})`,
      `detected stage ${stage}`,
    );
  } else {
    console.log(`${INFO}no EXPECT_STAGE set: reporting only, not gating.`);
  }

  // Any OTHER permissive policy on realtime.messages for anon/authenticated is
  // an unscoped door, whatever its name. 0003 drops by name, and names drift.
  const clientPolicies = rt.filter(
    (p) =>
      !`${p.qual ?? ""}${p.with_check ?? ""}`.includes("is_plan_room_member"),
  );
  // The label has to tell the truth at EVERY stage. Before 0003 these policies
  // are supposed to still be there, and printing a green "none remain" next to
  // a list of the ones that do remain is how a reader — or a reviewer reading
  // the evidence file — concludes the exposure is closed when it is wide open.
  const unscopedNames = clientPolicies
    .map((p) => `${p.policyname}:${p.cmd}`)
    .join(", ");
  if (stage < 3) {
    console.log(
      `${INFO}${clientPolicies.length} unscoped policy(ies) still present — EXPECTED before 0003, not yet gated${unscopedNames ? ` — ${unscopedNames}` : ""}`,
    );
  } else {
    check(
      clientPolicies.length === 0,
      "no unscoped policy of ANY name remains on realtime.messages",
      unscopedNames,
    );
  }

  // Grants are load-bearing twice over: the membership predicate must be
  // EXECUTE-able by authenticated (a permission error inside a policy fails
  // the whole query), and purge must NOT be reachable by anon/authenticated.
  const grants = await q<{ fn: string; anon: boolean; auth: boolean }>(
    `select p.proname as fn,
            has_function_privilege('anon', p.oid, 'execute') as anon,
            has_function_privilege('authenticated', p.oid, 'execute') as auth
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname like '%plan_room%'`,
  );
  const purge = grants.find((g) => g.fn === "purge_expired_plan_rooms");
  check(
    !purge || (!purge.anon && !purge.auth),
    "purge_expired_plan_rooms is NOT executable by anon/authenticated",
    purge ? `anon=${purge.anon} auth=${purge.auth}` : "absent",
  );
  // 🧨 THE ANON MOAT. Production hands every new public table `anon = SELECT`
  // by default (pg_default_acl gives anon `rm` on tables created by postgres),
  // and 0001's `revoke all ... from anon` is the ONLY thing that removes it.
  // No behavioural test can see this: both RLS policies are `to authenticated`,
  // so a signed-out caller reads zero rows whether the grant is there or not.
  // It has to be asserted from the catalog.
  const tableGrants = await q<{ tbl: string; anon: boolean; auth: boolean }>(
    `select c.relname as tbl,
            has_table_privilege('anon', c.oid, 'select') as anon,
            has_table_privilege('authenticated', c.oid, 'select') as auth
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname='public'
        and c.relname in ('plan_rooms','plan_room_members','plan_room_join_attempts')`,
  );
  const anonReadable = tableGrants.filter((g) => g.anon).map((g) => g.tbl);
  check(
    tableGrants.length === 3 && anonReadable.length === 0,
    "anon holds NO select grant on any room table (0001's revoke actually applied)",
    tableGrants.length !== 3
      ? `only found ${tableGrants.length}/3 tables`
      : anonReadable.join(", "),
  );
  const attempts = tableGrants.find((g) => g.tbl === "plan_room_join_attempts");
  check(
    !!attempts && !attempts.auth,
    "authenticated cannot read plan_room_join_attempts (the throttle ledger)",
    attempts ? `auth=${attempts.auth}` : "absent",
  );

  const predicate = grants.find((g) => g.fn === "is_plan_room_member");
  check(
    !!predicate?.auth,
    "authenticated can EXECUTE is_plan_room_member (policies fail without it)",
  );
  const anonExecutable = grants.filter((g) => g.anon).map((g) => g.fn);
  check(
    anonExecutable.length === 0,
    "no room function is executable by anon",
    anonExecutable.join(", "),
  );
  console.log(
    `${INFO}detected stage: ${stage} (${stage === 1 ? "pre-0002" : stage === 2 ? "DUAL-RUN (0002 applied)" : "FINAL (0003 applied)"})\n`,
  );

  if (stage >= 2) {
    check(
      scoped.length >= 2,
      "membership-scoped read + write policies are live",
    );
  }
  if (stage === 3) {
    check(
      broad.length === 0,
      "🧨 broad plan-% policies are GONE — exposure closed",
    );
  } else if (stage === 2) {
    console.log(
      `${INFO}dual-run is expected here; run 0003 once the app is verified on the new path.`,
    );
  }

  // ── 4. Data health (aggregates only — never a code) ──────────────────
  const rooms = await q<{
    total: number;
    live: number;
    expired: number;
    closed: number;
  }>(
    `select count(*)::int as total,
            count(*) filter (where closed_at is null and expires_at > now())::int as live,
            count(*) filter (where expires_at <= now())::int as expired,
            count(*) filter (where closed_at is not null)::int as closed
       from public.plan_rooms`,
  );
  const r = rooms[0] ?? { total: 0, live: 0, expired: 0, closed: 0 };
  console.log(
    `${INFO}rooms: ${r.total} total · ${r.live} live · ${r.expired} expired · ${r.closed} closed`,
  );

  const orphans = await q<{ n: number }>(
    `select count(*)::int as n from public.plan_room_members m
      left join public.plan_rooms rr on rr.id = m.room_id where rr.id is null`,
  );
  check((orphans[0]?.n ?? 0) === 0, "no orphaned membership rows");

  // Sample one live room, hashed, so an operator can correlate with analytics.
  const sample = await q<{ code: string; members: number }>(
    `select r.code, (select count(*) from public.plan_room_members m where m.room_id = r.id)::int as members
       from public.plan_rooms r where r.closed_at is null and r.expires_at > now()
      order by r.created_at desc limit 1`,
  );
  if (sample[0]) {
    console.log(
      `${INFO}newest live room: ${hashRoomCode(sample[0].code)} (hashed) · ${sample[0].members} member(s)`,
    );
  }

  console.log(
    `\n${failures === 0 ? "All required invariants hold." : `${failures} FAILED.`}\n`,
  );
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("verification error:", e instanceof Error ? e.message : e);
  process.exit(1);
});
