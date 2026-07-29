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

import { createServiceClient } from "@/lib/supabase/admin";
import { hashRoomCode } from "@/lib/room-code";

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
  const expected = Number(process.env.EXPECT_STAGE ?? "0");
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
  check(
    stage < 3 || clientPolicies.length === 0,
    "no unscoped policy of ANY name remains on realtime.messages",
    clientPolicies.map((p) => `${p.policyname}:${p.cmd}`).join(", "),
  );

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
