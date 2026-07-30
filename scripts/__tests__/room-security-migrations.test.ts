import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PRODUCTION_REFS, FIXTURE_EMAIL, isLoopback } from "../staging-guard";

const suite = readFileSync(
  join(process.cwd(), "scripts", "staging-room-security-suite.ts"),
  "utf8",
);
const verify = readFileSync(
  join(process.cwd(), "scripts", "verify-room-security.ts"),
  "utf8",
);

// Guard tests for the group-room security migrations, in the house style of
// color-tokens.test.ts / dependency-pins.test.ts: pin the decisions that are
// expensive to get wrong and easy to undo by accident.

const DIR = join(process.cwd(), "supabase", "migrations");
const MANUAL = join(process.cwd(), "supabase", "manual");
// 0002/0003 live OUTSIDE migrations/ on purpose: they need owner-level
// execution, so leaving them in the numbered chain would abort any
// `supabase db push` / `db reset` partway through — including the bootstrap of
// a fresh staging project.
const read = (f: string) =>
  readFileSync(join(f.startsWith("0001") ? DIR : MANUAL, f), "utf8");
/** The file with SQL line comments removed — i.e. only what actually runs. */
const executable = (f: string) =>
  read(f)
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");

const M1 = "0001_plan_rooms.sql";
const M2 = "0002_realtime_membership_policies.sql";
const M3 = "0003_drop_broad_realtime_policies.sql";

describe("migration sequence", () => {
  it("only runner-applicable migrations sit in migrations/", () => {
    // The invariant is NOT "exactly one file" — it is that nothing needing
    // owner-level execution is in the runner's numbered chain, because a
    // `db push` that aborts partway through is worse than a manual step.
    const inChain = readdirSync(DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    expect(inChain).toEqual(["0001_plan_rooms.sql", "0004_server_side_room_codes.sql"]);
    for (const f of inChain) {
      const sql = readFileSync(join(DIR, f), "utf8")
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("--"))
        .join("\n");
      expect(sql, `${f} must not touch realtime.messages`).not.toContain(
        "realtime.messages",
      );
    }
  });

  it("the owner-level files sit in supabase/manual/, out of the runner's chain", () => {
    expect(
      readdirSync(MANUAL)
        .filter((f) => f.endsWith(".sql"))
        .sort(),
    ).toEqual([M2, M3]);
  });

  it("each owner-level file names its OWN exact EXPECT_STAGE", () => {
    // `EXPECT_STAGE=<2|3>` invited the wrong paste: running the verifier with
    // 2 after applying 0003 passes without ever asserting the broad policies
    // are gone (the check is `stage >= expected`).
    expect(read(M2)).toContain("EXPECT_STAGE=2");
    expect(read(M3)).toContain("EXPECT_STAGE=3");
    expect(read(M2)).not.toContain("EXPECT_STAGE=<");
    expect(read(M3)).not.toContain("EXPECT_STAGE=<");
  });

  it("the owner-level remedy ships an ownership probe and demands it be re-run", () => {
    // This used to assert the label "UNVERIFIED REMEDY". The route was then
    // actually exercised against production (2026-07-29) and it worked, so that
    // label became false and asserting it would have forced the docs to lie.
    // What must NOT be lost is the probe itself and the instruction to re-prove
    // the route every time — the privilege is Supabase platform behaviour that
    // stock PostgreSQL semantics do not explain, so it could change under us.
    for (const f of [M2, M3]) {
      const sql = read(f);
      expect(sql).toContain("zz_probe_delete_me");
      expect(sql).toMatch(/re-prove it every time|re-run this/i);
      expect(sql).toMatch(/If it ever 42501s, STOP|If it 42501s, STOP/);
    }
  });

  it("0001 is additive only — it must not touch existing policies or tables", () => {
    const sql = executable(M1).toLowerCase();
    // 0001 may drop ONLY its own policies, on its own tables, for idempotency.
    // Anything else — and in particular anything on realtime.messages, which is
    // where the live exposure lives — must stay out of this file: it is applied
    // by the normal runner, and the runner must never be able to change
    // Realtime access.
    const allowedDrops = [
      'drop policy if exists "plan_rooms member read" on public.plan_rooms;',
      'drop policy if exists "plan_room_members member read" on public.plan_room_members;',
    ];
    const drops = sql
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("drop policy"));
    expect(drops.sort()).toEqual(allowedDrops.sort());
    expect(sql).not.toContain("realtime.messages");
    expect(sql).not.toContain("drop table");
    expect(sql).not.toContain("alter table public.venues");
    expect(sql).not.toContain("alter table public.plans");
    // 🧨 The saved_venues CASCADE trap lives next door; this track must not
    // go near any pre-existing table.
    expect(sql).not.toContain("saved_venues");
  });
});

describe("room + membership schema", () => {
  const sql = read(M1);

  it("stores the room fields the security model needs", () => {
    for (const col of [
      "code",
      "topic",
      "host_user_id",
      "created_at",
      "expires_at",
      "closed_at",
      "host_seen_at",
    ]) {
      expect(sql).toContain(col);
    }
  });

  it("expires rooms after ~6 hours by default", () => {
    expect(sql).toMatch(
      /expires_at\s+timestamptz not null default now\(\) \+ interval '6 hours'/,
    );
  });

  it("ties membership to auth.users, not to a client-generated id", () => {
    expect(sql).toMatch(
      /user_id\s+uuid\s+not null references auth\.users \(id\)/,
    );
    expect(sql).toContain("primary key (room_id, user_id)");
  });

  it("derives identity from auth.uid() in every write function — none takes a user id", () => {
    const fns = sql.split(/create or replace function/).slice(1);
    expect(fns.length).toBeGreaterThanOrEqual(7);
    for (const fn of fns) {
      const signature = fn.slice(0, fn.indexOf(")") + 1);
      expect(signature.toLowerCase()).not.toMatch(
        /p_user_id|p_member_id|p_host/,
      );
    }
    expect(sql).toContain("auth.uid()");
  });

  it("pins search_path on every SECURITY DEFINER function", () => {
    const definers = sql.split("security definer").slice(1);
    expect(definers.length).toBeGreaterThanOrEqual(7);
    for (const body of definers) {
      expect(body.slice(0, 120)).toContain("set search_path = ''");
    }
  });

  it("keeps the purge function off client roles", () => {
    expect(sql).toContain(
      "grant execute on function public.purge_expired_plan_rooms()        to service_role;",
    );
    expect(sql).not.toMatch(
      /grant execute on function public\.purge_expired_plan_rooms\(\)\s+to authenticated/,
    );
  });
});

describe("membership predicate", () => {
  const sql = read(M1);

  it("requires membership AND not-departed AND not-closed AND not-expired", () => {
    const fn = sql.slice(sql.indexOf("function public.is_plan_room_member"));
    expect(fn).toContain("m.user_id = (select auth.uid())");
    expect(fn).toContain("m.left_at is null");
    expect(fn).toContain("r.closed_at is null");
    expect(fn).toContain("r.expires_at > now()");
  });
});

describe("realtime policies", () => {
  it("0002 scopes both read and write to room membership", () => {
    const sql = read(M2);
    expect(sql).toContain("for select");
    expect(sql).toContain("for insert");
    // Two calls: one in USING (select), one in WITH CHECK (insert).
    expect(sql.match(/public\.is_plan_room_member/g)?.length).toBe(2);
    // Presence must stay in scope or the lobby breaks.
    expect(sql).toContain("extension in ('broadcast', 'presence')");
  });

  it("0002 does NOT remove anything (dual-run: old policies still OR in)", () => {
    // Executable SQL only: both files now carry an owner-level banner whose
    // PROSE explains that CREATE/DROP POLICY need ownership. A comment
    // removes nothing, so scanning raw text would flag the documentation.
    expect(executable(M2).toLowerCase()).not.toContain("drop policy");
  });

  it("both realtime migrations declare the owner-level requirement", () => {
    // Measured 2026-07-29: the migration role is `postgres`, realtime.messages
    // is owned by supabase_realtime_admin, and postgres is NOT a member — so
    // these two files cannot be applied by the CLI/CI path. If that banner is
    // ever dropped, someone will wire them into an automated migration and it
    // will fail in production at exactly the wrong moment.
    for (const f of [M2, M3]) {
      expect(read(f)).toContain("OWNER-LEVEL EXECUTION REQUIRED");
      expect(read(f)).toContain("supabase_realtime_admin");
    }
  });

  it("🧨 0003 removes BOTH broad plan-% policies — the actual exposure fix", () => {
    const sql = read(M3);
    expect(sql).toContain(
      'drop policy if exists "authenticated can read plan-together rooms"  on realtime.messages;',
    );
    expect(sql).toContain(
      'drop policy if exists "authenticated can write plan-together rooms" on realtime.messages;',
    );
  });

  it("after the final migration no un-scoped plan-% grant remains in the tree", () => {
    // Any file that still CREATES a plan-% policy must also gate it on
    // membership. (The commented-out record in realtime-policies.sql is the
    // documented pre-change state and is excluded by the create check.)
    for (const f of [M1, M2, M3]) {
      // Strip SQL line comments first: 0003 documents the pre-change policies
      // verbatim in its rollback note, and a commented policy grants nothing.
      const sql = read(f)
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("--"))
        .join("\n");
      const creates = sql
        .split("create policy")
        .slice(1)
        .filter((p) => p.includes("realtime.messages"));
      for (const p of creates) {
        expect(p).toContain("is_plan_room_member");
      }
    }
  });
});

describe("post-review hardening (findings from supabase-guardian, 2026-07-29)", () => {
  const sql = read(M1);

  it("revokes from public AND anon AND authenticated, not just public", () => {
    // `revoke ... from public` does NOT remove the default role grants
    // Supabase hands new public objects — the house convention (schema.sql)
    // revokes all three explicitly.
    const revokes = sql.match(/revoke all on function[^;]+;/g) ?? [];
    expect(revokes.length).toBeGreaterThanOrEqual(7);
    for (const r of revokes)
      expect(r).toContain("from public, anon, authenticated");
  });

  it("🧨 purge is protected by the GRANT — the in-body role check was theatre", () => {
    // This used to also assert `current_user not in ('service_role', ...)` in
    // the body, calling it "belt AND braces". It is neither: inside a SECURITY
    // DEFINER function `current_user` is the function OWNER, not the caller, so
    // that condition is unconditionally satisfied however the function is
    // reached. Our own REJECTED-exec_sql_readonly.sql notes exactly this. A
    // test pinning a check that cannot fire is worse than no test, so it now
    // pins the control that actually refuses callers: the grant.
    expect(sql).toMatch(
      /grant execute on function public\.purge_expired_plan_rooms\(\)\s+to service_role;/,
    );
    expect(sql).toMatch(
      /revoke all on function public\.purge_expired_plan_rooms\(\)\s+from public, anon, authenticated;/,
    );
    // and 0004, which replaces the body, must not reinstate the theatre
    const m4 = readFileSync(
      join(process.cwd(), "supabase/migrations/0004_server_side_room_codes.sql"),
      "utf8",
    )
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n");
    expect(m4).not.toContain("current_user not in");
  });

  it("the join throttle lives in the DATABASE (the RPC is directly reachable)", () => {
    expect(sql).toContain("plan_room_join_attempts");
    const fn = sql.slice(
      sql.indexOf("function public.join_plan_room"),
      sql.indexOf("function public.close_plan_room"),
    );
    expect(fn).toContain("too many join attempts");
  });

  it("the host-staleness window is clamped server-side, not caller-chosen", () => {
    const fn = sql.slice(sql.indexOf("function public.promote_plan_room_host"));
    expect(fn).toContain("greatest(coalesce(p_stale_seconds, 30), 30)");
    expect(fn).not.toMatch(/secs => p_stale_seconds/);
  });

  it("host handoff EXCLUDES the outgoing host (or it can never hand off)", () => {
    const fn = sql.slice(sql.indexOf("function public.promote_plan_room_host"));
    expect(fn).toContain("is distinct from (");
    expect(fn).toContain("host_user_id from public.plan_rooms");
  });

  it("🧨 host handoff ROTATES FORWARD — the measured oscillation must not come back", () => {
    // Measured on a live database 2026-07-29: excluding only the CURRENT host
    // and taking earliest-joined made a 3-member room ping-pong B → A → B → A,
    // handing the room back to the absent original host forever.
    //
    // This test exists because the previous version of it could not catch that.
    // It asserted `is distinct from (` and `host_user_id from public.plan_rooms`
    // — BOTH of which the broken rule also contained, and both of which still
    // live in the wrap branch — so a revert stayed green.
    const fn = sql.slice(sql.indexOf("function public.promote_plan_room_host"));
    const forwardScan = fn.indexOf("(m.joined_at, m.user_id) >");
    const wrapBranch = fn.indexOf("is distinct from (");
    expect(forwardScan).toBeGreaterThan(-1);
    expect(wrapBranch).toBeGreaterThan(-1);
    // The ring step must come FIRST; the exclusion is only the wrap fallback.
    expect(forwardScan).toBeLessThan(wrapBranch);
    // and it must compare against the CURRENT HOST's position in the roster
    expect(fn).toMatch(/r\.host_user_id\s*=\s*h\.user_id/);
  });

  it("table reads use the participant predicate so closed/expired stays READABLE", () => {
    // Otherwise a member loses SELECT the instant a room closes and can never
    // be told WHY it stopped.
    expect(sql).toContain("function public.is_plan_room_participant");
    const policy = sql.slice(
      sql.indexOf('create policy "plan_rooms member read"'),
    );
    expect(policy.slice(0, 300)).toContain("is_plan_room_participant");
  });

  it("room codes are shape-pinned, so a direct RPC cannot mint a 4-char room", () => {
    expect(sql).toMatch(
      /code ~ '\^\[ABCDEFGHJKLMNPQRSTUVWXYZ23456789\]\{6\}\$'/,
    );
  });
});

describe("blast radius", () => {
  it("no migration touches solo planning, the catalogue, or unrelated policies", () => {
    for (const f of [M1, M2, M3]) {
      const sql = executable(f).toLowerCase();
      for (const forbidden of [
        "public.plans",
        "public.venues",
        "public.events",
        "public.saved_venues",
        "public.bookings",
        "public.profiles",
      ]) {
        expect(sql).not.toContain(forbidden);
      }
    }
  });
});

describe("staging-harness guards (behaviour, not spelling)", () => {
  // These import the real predicates. The previous version of this block
  // grepped the harness source for the right strings — which pins the spelling
  // and not the behaviour, and silently stopped testing anything the moment the
  // code moved. A guard whose test cannot fail is the defect this whole track
  // keeps rediscovering.

  it("still refuses the production ref outright", () => {
    expect(PRODUCTION_REFS).toContain("fxfuzabrivuianfwdopc");
  });

  it("accepts a genuine loopback host", () => {
    for (const ok of [
      "http://127.0.0.1:54321",
      "http://localhost:54321",
      "http://[::1]:54321",
      "https://LOCALHOST:54321/rest/v1",
    ]) {
      expect(isLoopback(ok)).toBe(true);
    }
  });

  it("🧨 rejects hosts that merely LOOK like loopback", () => {
    for (const hostile of [
      "http://127.0.0.1.attacker.example/", // suffix trick
      "http://localhost.attacker.example/", // suffix trick
      "http://user@127.0.0.1@evil.com/", // userinfo trick — real host is evil.com
      "https://fxfuzabrivuianfwdopc.supabase.co",
      "not a url",
      "",
    ]) {
      expect(isLoopback(hostile)).toBe(false);
    }
  });

  it("the fixture pattern matches what the harness creates and nothing a person owns", () => {
    // Exactly the shape makeActor builds: fl-staging-<label>-<ts>-<rand>@example.invalid
    const label = "a";
    const generated = `fl-staging-${label}-${1769000000000}-${123456}@example.invalid`;
    expect(FIXTURE_EMAIL.test(generated)).toBe(true);
    for (const real of [
      "maria@funldn.com",
      "someone@gmail.com",
      "fl-staging-a-1-1@example.invalid.attacker.example", // suffix trick
      "x fl-staging-a-1-1@example.invalid", // prefix trick
      "fl-staging-a-1-1@example.invalidx",
    ]) {
      expect(FIXTURE_EMAIL.test(real)).toBe(false);
    }
  });

  it("🧨 the anon assertions demand a PERMISSION error, not merely zero rows", () => {
    // Both RLS policies on the room tables are `to authenticated`, so a
    // signed-out caller reads zero rows whether or not 0001's
    // `revoke ... from anon` applied. Asserting "0 rows" could never fail on
    // the regression it exists to catch; asserting 42501 can.
    for (const id of ["AN-1", "AN-3", "AN-4"]) {
      const block = suite.slice(suite.indexOf(`"${id}",`));
      expect(block.slice(0, 700)).toContain('?.code === "42501"');
    }
  });

  it("🧨 E-1 asserts the EFFECT (no membership row), not payload truthiness", () => {
    // PostgREST renders a NULL composite as an all-null OBJECT, which is truthy
    // in JS, so `!expJoin` failed against a database that correctly refused.
    const block = suite.slice(suite.lastIndexOf('"E-1",'));
    expect(block.slice(0, 900)).toContain("expMembers === 0");
    expect(suite).not.toContain("verdict(!expJoin)");
  });

  it("🧨 a SKIP cannot exit 0 — the header promises otherwise", () => {
    expect(suite).toContain("skipped.length > 0");
  });

  it("🧨 the guard does NOT gate on a user COUNT — production holds 16", () => {
    expect(suite).not.toMatch(/POPULATED_LIMIT\s*=/);
    expect(suite).not.toMatch(/totalUsers\s*>=/);
  });

  it("the verification gate asserts anon holds no table grant", () => {
    expect(verify).toContain("has_table_privilege('anon'");
    expect(verify).toContain("plan_room_join_attempts");
  });

  it("🧨 the suite still USES the shared guard module (not a re-inlined copy)", () => {
    // Extracting the predicates only helps if the harness keeps importing them.
    // Re-inlining a substring isLoopback in the suite would leave typecheck and
    // CI green while the tested module drifted out of the call path — the same
    // "guard whose test cannot fail" defect, moved up one level.
    expect(suite).toContain('from "./staging-guard"');
    expect(suite).not.toMatch(/^\s*function isLoopback/m);
    expect(suite).not.toMatch(/^\s*const FIXTURE_EMAIL\s*=/m);
    expect(suite).not.toMatch(/^\s*const PRODUCTION_REFS\s*=/m);
    expect(suite).not.toMatch(/^\s*function refFromKey/m);
  });

  it("🧨 the production gate NAMES the database it certifies and refuses stray loopback", () => {
    // It loads .env.local, so without this it would happily certify whatever
    // that file points at — and during the staging run it pointed at a local
    // stack. A gate that does not say what it inspected is not a gate.
    expect(verify).toContain("new URL(dbUrl).host");
    expect(verify).toMatch(/Target: \$\{targetHost\}/);
    expect(verify).toMatch(/isLoopback\(dbUrl\)\s*&&\s*rawExpected/);
    expect(verify).toContain("ALLOW_LOCAL");
  });

  it("the known-broken sibling scripts are exactly the two we expect", () => {
    // `lib/supabase/admin.ts` starts with `import "server-only"`, which is NOT
    // an installed package, so any script importing it dies with
    // MODULE_NOT_FOUND before its first line. vitest aliases `server-only` to a
    // stub, so tests stay green while the script is dead — which is exactly how
    // this went unnoticed until a live run. Adding `server-only` as a real
    // dependency does NOT fix it: that package throws by design under Node.
    const dir = join(process.cwd(), "scripts");
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith(".ts"))
      .filter((f) =>
        /^\s*import\b[^;]*["']@?\/?lib\/supabase\/admin["']/m.test(
          readFileSync(join(dir, f), "utf8"),
        ),
      );
    // Asserting the EXACT set, not just "the gate is clean": a THIRD script
    // picking up this import must fail here rather than pass silently.
    // verify-plan and verify-feed-rank are tracked as follow-up work.
    expect(offenders.sort()).toEqual([
      "verify-feed-rank.ts",
      "verify-plan.ts",
    ]);
  });
});
