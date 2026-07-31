/**
 * Live verification for the Plan Together security track.
 *
 * READ-ONLY by construction: it opens a direct Postgres connection with the
 * session pinned `default_transaction_read_only`, so the SERVER refuses any
 * write from this path — including one reached through a volatile function.
 * It creates no rooms, joins nothing and deletes nothing. Run it:
 *
 *   · after 0001  → tables/functions/grants exist, policies unchanged
 *   · after 0002  → the membership-scoped policies are live alongside the old
 *                   broad ones (this is the dual-run checkpoint)
 *   · after 0003  → the broad plan-% policies are GONE and only the scoped
 *                   ones remain  ← the gate for calling the exposure closed
 *
 *   SUPABASE_DB_URL=postgresql://… pnpm verify-room-security
 *
 * It reads pg_policies / pg_proc / the grant catalogs, which PostgREST cannot
 * expose, so it needs a database URL rather than the anon or service key.
 * Prefer a read-only role. It does NOT use, and must never reintroduce, an
 * exec_sql_readonly-style SQL-execution RPC — see
 * docs/funldn-group-security-staging-evidence/REJECTED-exec_sql_readonly.sql.
 *
 * Exit code is 1 when a REQUIRED invariant for the detected stage fails, so
 * it can gate a deploy step. Stage is detected, not assumed.
 *
 * 🧨 Never prints a room code. Room identifiers are shown hashed.
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { isLoopback } from "./staging-guard";
import { connectReadOnly, MISSING_DB_URL } from "./pg-readonly";

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
  // 🧨 A deploy gate that disables itself on a malformed value is the same
  // family as "the CI secret was an empty string so `??` never fired". If the
  // variable is set at all it must name a real stage — and this has to run
  // BEFORE any query, or the script dies on something else first and the guard
  // never gets a turn.
  // Same strictness for EXPECT_0004: `true`, `yes` or a trailing space would
  // otherwise disarm the 0004 assertion silently and still exit 0.
  const raw0004 = process.env.EXPECT_0004;
  if (raw0004 !== undefined && raw0004.trim() !== "1") {
    console.error(
      `EXPECT_0004=${raw0004} is not 1. Refusing to run with a gate that would silently do nothing.`,
    );
    process.exit(1);
  }
  const require0004 = raw0004?.trim() === "1";

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

  const dbUrl = process.env.SUPABASE_DB_URL ?? "";
  // 🧨 NAME THE DATABASE, ALWAYS. A gate that does not say what it inspected
  // is not a gate: this script used to load .env.local and certify whatever
  // that happened to point at, with nothing in the output to reveal it.
  let targetHost = "(unparseable)";
  try {
    targetHost = new URL(dbUrl).host;
  } catch {
    /* leave as unparseable */
  }
  console.log(`Target: ${targetHost}`);
  if (isLoopback(dbUrl) && rawExpected && process.env.ALLOW_LOCAL !== "1") {
    console.error(
      "REFUSING: EXPECT_STAGE is set but the target is loopback. Set ALLOW_LOCAL=1 to verify a local stack on purpose.",
    );
    process.exit(1);
  }

  const db = await connectReadOnly();
  if (!db) {
    console.error(MISSING_DB_URL);
    process.exit(1);
  }

  // Fixed, named catalog queries over a session pinned
  // `default_transaction_read_only`. Postgres refuses any write reached from
  // here, including one smuggled through a volatile function — which is the
  // exact case the rejected exec_sql_readonly helper could not stop.
  const q = async <T>(sql: string): Promise<T[]> => {
    const { rows } = await db.query(sql);
    return rows as T[];
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
    await db.end();
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
        and c.relname in ('plan_rooms','plan_room_members',
                          'plan_room_join_attempts','plan_room_create_attempts')`,
  );
  // 0005 adds a FOURTH table, and it needs this check more than any of the
  // others: plan_room_create_attempts has no RLS policies at all, so anon
  // reads nothing from it whether or not the grant was revoked. There is no
  // behavioural symptom to notice. The catalog is the only witness.
  const EXPECTED_ROOM_TABLES = 4;
  const anonReadable = tableGrants.filter((g) => g.anon).map((g) => g.tbl);
  check(
    tableGrants.length === EXPECTED_ROOM_TABLES && anonReadable.length === 0,
    "anon holds NO select grant on any room table (the revokes actually applied)",
    tableGrants.length !== EXPECTED_ROOM_TABLES
      ? `only found ${tableGrants.length}/${EXPECTED_ROOM_TABLES} tables: ${tableGrants.map((g) => g.tbl).join(", ") || "none"}`
      : anonReadable.join(", "),
  );
  for (const ledger of [
    "plan_room_join_attempts",
    "plan_room_create_attempts",
  ]) {
    const attempts = tableGrants.find((g) => g.tbl === ledger);
    check(
      !!attempts && !attempts.auth,
      `authenticated cannot read ${ledger} (a throttle ledger)`,
      attempts ? `auth=${attempts.auth}` : "absent",
    );
  }

  const predicate = grants.find((g) => g.fn === "is_plan_room_member");
  check(
    !!predicate?.auth,
    "authenticated can EXECUTE is_plan_room_member (policies fail without it)",
  );
  // 0004 invariants. Without these the gate cannot tell you whether the
  // migration that closes the room-code oracle is actually applied — which is
  // the check that would catch a client deployed ahead of its migration.
  const createFn = await q<{ args: string }>(
    `select pg_get_function_arguments(p.oid) as args
       from pg_proc p where p.pronamespace = 'public'::regnamespace
        and p.proname = 'create_plan_room'`,
  );
  // Report, but only FAIL when 0004 is actually expected. Otherwise this gate
  // exits 1 on every pre-0004 database and "the exposure regressed" becomes
  // indistinguishable from "the hygiene migration has not landed yet".
  //
  // 🧨 THE INVARIANT IS "ONE SIGNATURE THE CLIENT CANNOT FEED A CODE TO", NOT
  // "a DEFAULTed parameter". This tested for the word "default", which was the
  // 0004 shape; 0005 DROPS the parameter entirely, so on a fully-migrated
  // database the old test either failed outright (with EXPECT_0004=1) or
  // printed "0004 not applied yet" about a database that is a migration AHEAD.
  // A gate that reports a newer schema as an older one is worse than no gate:
  // it is the "green tick over a broken thing" this repo keeps paying for.
  //
  // Both shapes close the oracle. What must NEVER be true is a signature the
  // caller can pass a code to and have it HONOURED, or two overloads at once
  // (PostgREST resolves by payload keys, so ambiguity is a routing bug).
  const args = createFn.map((f) => f.args || "(no args)").join(" | ");
  const one = createFn.length === 1;
  const noParam = one && createFn[0].args.trim() === "";
  const defaulted = one && createFn[0].args.toLowerCase().includes("default");
  const oracleClosed = noParam || defaulted;
  if (oracleClosed || require0004) {
    check(
      oracleClosed,
      noParam
        ? "0005 applied: exactly one create_plan_room, taking no arguments"
        : "0004 applied: exactly one create_plan_room, with a DEFAULTed parameter",
      args || "absent",
    );
  } else {
    console.log(
      `${INFO}0004/0005 not applied yet (create_plan_room: ${args || "absent"}). Set EXPECT_0004=1 to require it.`,
    );
  }
  const codeGen = await q<{ anon: boolean; auth: boolean }>(
    `select has_function_privilege('anon', p.oid, 'execute') as anon,
            has_function_privilege('authenticated', p.oid, 'execute') as auth
       from pg_proc p where p.pronamespace = 'public'::regnamespace
        and p.proname = 'new_plan_room_code'`,
  );
  check(
    require0004
      ? codeGen.length === 1 && !codeGen[0].anon && !codeGen[0].auth
      : codeGen.length === 0 || (!codeGen[0].anon && !codeGen[0].auth),
    "the room-code generator is not executable by anon or authenticated",
    codeGen.length
      ? `anon=${codeGen[0].anon} auth=${codeGen[0].auth}`
      : require0004
        ? "ABSENT — but EXPECT_0004=1 requires it"
        : "absent (pre-0004)",
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
  const sample = await q<{ id_hash: string; members: number }>(
    `select encode(sha256(r.id::text::bytea), 'hex') as id_hash,
            (select count(*) from public.plan_room_members m where m.room_id = r.id)::int as members
       from public.plan_rooms r where r.closed_at is null and r.expires_at > now()
      order by r.created_at desc limit 1`,
  );
  if (sample[0]) {
    // 🧨 The room's UUID, hashed — NOT hashRoomCode(). That helper is
    // rainbow-reversible over the 32^6 code space with a salt that ships in the
    // bundle (lib/room-code.ts says so), and this line describes a LIVE room
    // whose code is a bearer secret. Gate output from this track gets committed
    // to a public repo. Same standard as scripts/purge-plan-rooms.ts.
    console.log(
      `${INFO}newest live room: ${sample[0].id_hash.slice(0, 8)} (id hash) · ${sample[0].members} member(s)`,
    );
  }

  console.log(
    `\n${failures === 0 ? "All required invariants hold." : `${failures} FAILED.`}\n`,
  );
  await db.end();
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("verification error:", e instanceof Error ? e.message : e);
  process.exit(1);
});
