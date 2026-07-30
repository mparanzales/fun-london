import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Guard tests for the room-hygiene follow-up, in the house style: pin the
// decisions that are expensive to get wrong and easy to undo by accident.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
/**
 * A TS/JS file with comments stripped — i.e. only what executes.
 * These files explain the defects they fix, so asserting against raw text
 * makes the prose fail the test rather than the code.
 */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//"))
    .join("\n");
const M4 = read("supabase/migrations/0004_server_side_room_codes.sql");
/** The migration with SQL line comments stripped — i.e. only what runs. */
const M4_SQL = M4.split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n");
const pkg = JSON.parse(read("package.json")) as {
  scripts: Record<string, string>;
};

describe("0004 — the room-code existence oracle is closed", () => {
  it("the server mints the code; no caller-supplied code is honoured", () => {
    // ONE signature with a defaulted, ignored parameter — not two overloads.
    // PostgREST resolves overloads by payload keys, and routing should not be
    // a subtlety anyone has to reason about mid-cutover.
    expect(M4_SQL).toMatch(
      /create or replace function public\.create_plan_room\(p_code text default null\)/,
    );
    expect(
      (
        M4_SQL.match(/create or replace function public\.create_plan_room/g) ??
        []
      ).length,
    ).toBe(1);
    expect(M4_SQL).toContain("public.new_plan_room_code()");
  });

  it("🧨 a collision is swallowed — surfacing 23505 IS the oracle", () => {
    const fn = M4_SQL.slice(
      M4_SQL.indexOf("function public.create_plan_room("),
    );
    expect(fn).toContain("exception when unique_violation");
    // and the generic failure must not echo a code back
    expect(fn).toMatch(/raise exception 'could not create room'/);
    expect(fn).not.toMatch(/raise exception[^;]*v_code/);
  });

  it("the retained parameter is IGNORED rather than honoured", () => {
    const fn = M4_SQL.slice(
      M4_SQL.indexOf("function public.create_plan_room("),
    );
    // It must never insert or look a room up using the caller's value.
    expect(fn).not.toMatch(/values\s*\(\s*p_code/);
    expect(fn).not.toMatch(/where\s+code\s*=\s*p_code/);
    // The insert uses the server-minted code.
    expect(fn).toMatch(/values\s*\(v_code,/);
  });

  it("codes come from a CSPRNG, not random()", () => {
    // A predictable PRNG would let a room be guessed rather than brute-forced.
    expect(M4_SQL).toContain("extensions.gen_random_bytes");
    expect(M4_SQL).not.toMatch(/\brandom\(\)/);
  });

  it("the generator is not handed to client roles", () => {
    expect(M4_SQL).toMatch(
      /revoke all on function public\.new_plan_room_code\(\)\s+from public, anon, authenticated/,
    );
    expect(M4_SQL).not.toMatch(
      /grant execute on function public\.new_plan_room_code\(\)\s+to (anon|authenticated)/,
    );
  });

  it("every definer function in 0004 pins search_path", () => {
    const definers = M4_SQL.split("security definer").slice(1);
    expect(definers.length).toBeGreaterThan(0);
    for (const d of definers)
      expect(d.slice(0, 120)).toContain("set search_path = ''");
  });

  it("0004 is additive — it drops nothing and touches no other table", () => {
    expect(M4_SQL).not.toMatch(/drop (table|policy|function)/i);
    expect(M4_SQL).not.toContain("realtime.messages");
    for (const other of [
      "public.venues",
      "public.events",
      "public.plans",
      "saved_venues",
    ]) {
      expect(M4_SQL).not.toContain(other);
    }
  });

  it("the client no longer mints or sends a room code", () => {
    const action = code("lib/room-action.ts");
    // join_plan_room legitimately takes the code the user typed; only the
    // CREATE path must stop sending one.
    expect(action).not.toMatch(/rpc\(\s*["']create_plan_room["']\s*,/);
    expect(action).toMatch(/rpc\(\s*["']create_plan_room["']\s*\)/);
    expect(action).not.toContain("randomRoomCode");
    // and it must not have kept a client-side 23505 retry, which only made
    // sense while the caller owned the code
    expect(action).not.toContain("23505");
  });
});

describe("verification scripts run again, without a SQL-execution RPC", () => {
  it("🧨 no exec_sql_readonly-style runner was reintroduced anywhere", () => {
    const dir = join(process.cwd(), "scripts");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
      const src = readFileSync(join(dir, f), "utf8");
      // Referencing it in a comment (explaining why it is rejected) is fine;
      // calling it is not.
      expect(src).not.toMatch(/\.rpc\(\s*["']exec_sql/);
    }
    for (const sql of readdirSync(
      join(process.cwd(), "supabase", "migrations"),
    )) {
      expect(read(join("supabase/migrations", sql))).not.toContain(
        "function public.exec_sql",
      );
    }
  });

  it("the security gate reads the catalog over a READ-ONLY connection", () => {
    const src = read("scripts/verify-room-security.ts");
    expect(src).toContain("connectReadOnly");
    expect(src).not.toMatch(/\.rpc\(/);
    // 🧨 Against EXECUTABLE code, not raw text: pg-readonly.ts explains the
    // guarantee in its header, so a raw match stayed green even if the actual
    // `set session` line were deleted.
    const pg = code("scripts/pg-readonly.ts");
    expect(pg).toContain("set session default_transaction_read_only = on");
    // …and the pin must be VERIFIED, because a transaction-mode pooler
    // silently discards `set session`.
    expect(pg).toContain("current_setting('default_transaction_read_only')");
  });

  it("the gate still names the database it certifies, and refuses stray loopback", () => {
    const src = read("scripts/verify-room-security.ts");
    expect(src).toContain("Target: ${targetHost}");
    expect(src).toContain("ALLOW_LOCAL");
  });

  it("🧨 every script reaching the server-only admin client runs with the scripts tsconfig", () => {
    // `lib/supabase/admin.ts` opens with `import "server-only"`, which plain
    // Node cannot resolve, so such a script dies at import unless it is run
    // with the alias. Assert the EXACT set rather than iterating whatever the
    // filter happens to find — an empty filter would otherwise pass vacuously,
    // and a third script picking up the import must fail here rather than
    // silently join the club.
    const dir = join(process.cwd(), "scripts");
    const importers = readdirSync(dir)
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => /supabase\/admin/.test(readFileSync(join(dir, f), "utf8")))
      .sort();
    expect(importers).toEqual(["verify-feed-rank.ts", "verify-plan.ts"]);
    for (const f of importers) {
      const entry = Object.entries(pkg.scripts).find(([, cmd]) =>
        cmd.includes(f),
      );
      expect(entry, `${f} has no package.json script entry`).toBeTruthy();
      expect(entry![1], `${f} must run with tsconfig.scripts.json`).toContain(
        "--tsconfig tsconfig.scripts.json",
      );
    }
  });

  it("🧨 the server-only alias exists ONLY in the scripts tsconfig", () => {
    // Parse it. The previous version matched raw text, and the file's own
    // comment block says "server-only" five times — so deleting the actual
    // paths entry left this green while both scripts died at MODULE_NOT_FOUND,
    // the exact bug this branch exists to fix.
    const parse = (p: string) =>
      JSON.parse(
        read(p)
          .split("\n")
          .filter((l) => !l.trimStart().startsWith("//"))
          .join("\n"),
      ) as { compilerOptions?: { paths?: Record<string, string[]> } };

    const scripts = parse("tsconfig.scripts.json");
    expect(scripts.compilerOptions?.paths?.["server-only"]).toEqual([
      "./test/server-only-stub.ts",
    ]);

    // Putting it in tsconfig.json would let Next read it and could silently
    // disable the client-bundle guard for the whole app.
    const app = parse("tsconfig.json");
    expect(app.compilerOptions?.paths?.["server-only"]).toBeUndefined();

    // The other two doors into the app's TS config.
    expect(read("next.config.js")).not.toContain("tsconfigPath");
    expect(pkg.scripts.typecheck).toBe("tsc --noEmit");
  });
});

describe("the purge is scheduled, bounded and privacy-conscious", () => {
  const wf = read(".github/workflows/maintenance.yml");
  const script = read("scripts/purge-plan-rooms.ts");
  const scriptCode = code("scripts/purge-plan-rooms.ts");

  it("🧨 runs in its OWN job, decoupled from the Places-dependent chain", () => {
    // As a trailing step of refresh-venues it would be skipped whenever an
    // earlier Places step failed — and the Google credits have been exhausted
    // since 2026-07-23, so that is the likely case. Retention must not depend
    // on a metered third-party API's health.
    const wfJobs = wf.slice(wf.indexOf("jobs:"));
    expect(wfJobs).toContain("purge-plan-rooms:");
    const job = wfJobs.slice(wfJobs.indexOf("purge-plan-rooms:"));
    expect(job).toMatch(
      /run: \|\n\s+set -o pipefail\n\s+pnpm purge-plan-rooms /,
    );
    // and it must not need the metered key or the object store
    expect(job).not.toContain("GOOGLE_PLACES_API_KEY");
    expect(job).not.toContain("R2_ACCESS_KEY_ID");
    expect(wf).toContain('cron: "0 3 * * *"');
  });

  it("🧨 the purge job carries its own failure alerting", () => {
    // Job-level alerting does not span jobs. Retention failing silently is
    // exactly what this is guarding against.
    const job = wf.slice(wf.indexOf("purge-plan-rooms:"));
    expect(job).toContain("Alert on failure");
    expect(job).toContain("if: failure() || cancelled()");
    expect(job).toContain("retention did NOT run");
  });

  it("🧨 the script performs NO deletes — every write lives in the SQL", () => {
    // An earlier draft swept the throttle ledger here with a JavaScript date,
    // which put the retention window in two editable places and made this
    // script destructive. Both deletes now live in the definer function.
    expect(scriptCode).toContain('rpc("purge_expired_plan_rooms")');
    expect(scriptCode).not.toMatch(/\.delete\(\)/);
    // and the function owns BOTH sweeps
    expect(M4_SQL).toContain("delete from public.plan_rooms");
    expect(M4_SQL).toContain("delete from public.plan_room_join_attempts");
  });

  it("🧨 it never reads or logs a room code, topic, user id or email", () => {
    // Actions logs outlive the rows they describe.
    expect(scriptCode).not.toMatch(/select\(["'][^"']*\bcode\b/);
    expect(scriptCode).not.toMatch(/select\(["'][^"']*\btopic\b/);
    expect(scriptCode).not.toMatch(/select\(["'][^"']*user_id/);
    expect(scriptCode).not.toMatch(/\bemail\b/);
  });

  it("🧨 it fails loudly when it purges nothing despite eligible rows", () => {
    // "Ask what changed, not whether it ran" — a silently no-op cron is how
    // this project has lost weeks before.
    expect(scriptCode).toContain("purged === 0");
    expect(scriptCode).toContain("FATAL");
  });

  it("offers a dry run that writes nothing", () => {
    expect(pkg.scripts["purge-plan-rooms:dry"]).toContain("--dry-run");
    expect(scriptCode).toContain("if (!DRY_RUN)");
  });
});
