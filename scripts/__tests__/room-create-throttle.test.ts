import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Guards for 0005 — the DB-side throttle on room CREATION.
//
// 🧨 THE DEFECT. `create_plan_room` is granted EXECUTE to `authenticated`, so
// it is reachable directly at /rest/v1/rpc/create_plan_room. Its only limit was
// the Upstash counter in the server action, which a caller hitting PostgREST
// skips entirely. 0001 already made this argument for the JOIN path and acted
// on it; create never got the same treatment.
//
// These pin the parts that are expensive to get wrong and silent when they are:
// the throttle running BEFORE any write, the two layers agreeing on a number,
// and the failure reaching the user as something true.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** SQL with line comments stripped — i.e. only what actually runs. */
const sql = (p: string) =>
  read(p)
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");

/** TS with comments stripped, for the same reason: prose must not pass a test. */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//"))
    .join("\n");

const M5 = sql("supabase/migrations/0005_create_room_throttle.sql");
const M1 = sql("supabase/migrations/0001_plan_rooms.sql");
const ACTION = code("lib/room-action.ts");
const ERRORS = read("lib/room-errors.ts");

/**
 * Just ONE function's body, bounded at its `$$;` terminator.
 *
 * Slicing to end-of-file instead is how the first version of this file quietly
 * tested the wrong thing: "the create function must not mention
 * plan_room_join_attempts" swept up the purge function further down, which
 * mentions it legitimately, and failed for a reason that was not the invariant.
 */
function body(migration: string, name: string): string {
  const start = migration.indexOf(`create or replace function public.${name}`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  const end = migration.indexOf("$$;", start);
  expect(end, `${name} has no terminator`).toBeGreaterThan(start);
  return migration.slice(start, end);
}

const CREATE_FN = body(M5, "create_plan_room");
const PURGE_FN = body(M5, "purge_expired_plan_rooms");

describe("0005 — creation is throttled in the database", () => {
  it("keeps a counter table that no client role can touch", () => {
    expect(M5).toMatch(
      /create table if not exists public\.plan_room_create_attempts/,
    );
    expect(M5).toMatch(
      /alter table public\.plan_room_create_attempts enable row level security/,
    );
    // Revoked outright rather than left to RLS: the table is written only by a
    // SECURITY DEFINER function, so no client role needs any grant on it, and
    // a readable counter tells an attacker exactly how much budget is left.
    expect(M5).toMatch(
      /revoke all on public\.plan_room_create_attempts from public, anon, authenticated/,
    );
  });

  it("🧨 counts the attempt BEFORE it writes a room", () => {
    // Ordering is the whole guarantee. Increment after the insert and the
    // limit is advisory: every attempt still creates its room and only the
    // NEXT one is refused, so the attacker is always one ahead.
    const fn = CREATE_FN;
    const counted = fn.indexOf("plan_room_create_attempts");
    const raised = fn.indexOf("53400");
    const inserted = fn.indexOf("insert into public.plan_rooms");
    expect(counted).toBeGreaterThan(-1);
    expect(raised).toBeGreaterThan(counted); // check follows the increment
    expect(inserted).toBeGreaterThan(raised); // and the write follows the check
  });

  it("🧨 reads the counter via RETURNING, not a second select", () => {
    // Losing the `returning` line is a TOTAL CREATE OUTAGE with green CI, and
    // nothing pinned it: v_attempts would stay NULL, the fail-closed
    // `is null` branch would fire on the FIRST attempt, and every user would
    // get "That's a lot of rooms" forever. The limit test only matches
    // `/v_attempts is null or v_attempts > (\d+)/` and the ordering test only
    // compares positions, so both stay green.
    expect(CREATE_FN).toContain("returning attempts into v_attempts");
    expect(CREATE_FN).toContain("v_attempts is null or v_attempts >");
    // And the variable must actually be declared, or the function will not
    // even compile at CREATE time.
    expect(CREATE_FN).toMatch(/v_attempts\s+int;/);
    // The old shape must not come back alongside it: a second select is the
    // fail-OPEN version this replaced.
    expect(CREATE_FN).not.toMatch(
      /select attempts from public\.plan_room_create_attempts/,
    );
  });

  it("raises the same SQLSTATE the join throttle uses", () => {
    // One code for both, so the server action has one thing to recognise.
    expect(M5).toMatch(
      /raise exception 'too many room creations' using errcode = '53400'/,
    );
    expect(M1).toContain("errcode = '53400'"); // the join path, unchanged
  });

  it("uses its OWN window, not the join table", () => {
    // 🧨 Sharing one counter would make a burst of failed joins eat the create
    // budget and vice versa — two limits that exist for different reasons,
    // coupled by accident. A create writes two rows and mints a code; a failed
    // join reads one row.
    expect(CREATE_FN).not.toContain("plan_room_join_attempts");
    expect(M5).toContain("interval '1 hour'");
  });

  it("🧨 the DB limit matches the app limit and the copy the user sees", () => {
    // Three places state this number. If they drift, the DB silently becomes
    // the real limit while the app and the copy both describe a different one,
    // and the user is refused for a reason the screen contradicts.
    const dbLimit = M5.match(/v_attempts is null or v_attempts > (\d+)/);
    expect(dbLimit, "could not find the DB limit").toBeTruthy();

    const upstash = ACTION.match(
      /rateLimit\(`room:create:\$\{user\.id\}`,\s*(\d+),\s*([^)]+)\)/,
    );
    expect(upstash, "could not find the Upstash create limit").toBeTruthy();

    expect(Number(dbLimit![1])).toBe(Number(upstash![1]));
    // ...and both are per hour.
    expect(upstash![2].replace(/\s/g, "")).toBe("60*60*1000");
    expect(M5).toContain("interval '1 hour'");
    // The copy says "in the last hour". If the window moves, this line moves.
    expect(ERRORS).toMatch(/"too-many-rooms":[\s\S]{0,300}last hour/);
  });

  it("still pins search_path on every definer function it defines", () => {
    const definers = M5.split("security definer").slice(1);
    expect(definers.length).toBeGreaterThan(0); // positive control
    for (const d of definers) {
      expect(d.slice(0, 200)).toMatch(/set search_path = ''/);
    }
  });

  it("grants execute to authenticated and nobody else", () => {
    expect(M5).toMatch(
      /revoke all on function public\.create_plan_room\(\) from public, anon, authenticated/,
    );
    expect(M5).toMatch(
      /grant execute on function public\.create_plan_room\(\) to authenticated/,
    );
  });
});

describe("0005 — p_code is gone", () => {
  it("the new signature takes no parameters", () => {
    expect(M5).toMatch(
      /create or replace function public\.create_plan_room\(\)/,
    );
    // And the accepted-and-ignored parameter is not quietly still there.
    expect(M5).not.toMatch(
      /create or replace function public\.create_plan_room\(p_code/,
    );
  });

  it("🧨 drops the old signature BEFORE creating the new one", () => {
    // This test used to assert the OPPOSITE, with a confident comment saying
    // drop-first "would leave a window with no callable create_plan_room".
    // Both were wrong, and verified wrong against Postgres 17.10:
    //
    //   `create or replace function create_plan_room()` does NOT replace
    //   `create_plan_room(p_code text default null)` -- a function is
    //   identified by (name, argument types), so that ADDS a second signature.
    //   With both present:
    //       select public.create_plan_room()
    //       ERROR 42725: function public.create_plan_room() is not unique
    //
    // PostgREST turns that into HTTP 300 / PGRST203, which room-action.ts has
    // no branch for, so every room creation would surface as "You're not in
    // this room". Drop-first makes the two-signature state unreachable, and if
    // the file is ever split it fails LOUDLY (function not found) instead.
    const dropped = M5.indexOf(
      "drop function if exists public.create_plan_room(text)",
    );
    const created = M5.indexOf(
      "create or replace function public.create_plan_room()",
    );
    expect(dropped).toBeGreaterThan(-1);
    expect(created).toBeGreaterThan(-1);
    expect(dropped).toBeLessThan(created);
  });

  it("never leaves two signatures reachable at once", () => {
    // The property behind the ordering, stated directly: the file must contain
    // exactly one `create ... create_plan_room` and must drop the other shape.
    const creates = M5.match(
      /create or replace function public\.create_plan_room/g,
    );
    expect(creates).toHaveLength(1);
    expect(M5).toContain(
      "drop function if exists public.create_plan_room(text)",
    );
  });

  it("takes the now-pointless log with it", () => {
    // The `raise log` in 0004 was the only signal for when p_code could go,
    // and nothing watches Postgres logs. Removing the parameter removes the
    // question rather than leaving a signal nobody reads.
    expect(M5).not.toContain("caller still sends p_code");
  });

  it("the single call site still passes no arguments", () => {
    // A no-arg .rpc() resolves against BOTH the old defaulted signature and
    // the new one, which is what makes the swap invisible to a live deploy.
    expect(ACTION).toMatch(/rpc\(\s*["']create_plan_room["']\s*\)/);
    expect(ACTION).not.toMatch(/rpc\(\s*["']create_plan_room["']\s*,/);
  });
});

describe("0005 — the counter cannot accumulate forever", () => {
  it("🧨 the purge sweeps the new table too", () => {
    // These rows are keyed by USER, not by room, so deleting a room cascades
    // nothing here. 0004 added exactly this for the join table and said why;
    // a new table with no sweep is a slow leak of bare user ids.
    const purge = PURGE_FN;
    expect(purge).toMatch(/delete from public\.plan_room_create_attempts/);
    // And it must not have lost the ones that were already there.
    expect(purge).toMatch(/delete from public\.plan_rooms/);
    expect(purge).toMatch(/delete from public\.plan_room_join_attempts/);
  });

  it("keeps the purge's retention longer than the throttle window", () => {
    // Otherwise the purge would delete a LIVE throttle row and hand the
    // attacker a fresh budget. 7 days vs 1 hour.
    expect(PURGE_FN).toMatch(
      /delete from public\.plan_room_create_attempts\s*\n?\s*where window_start < now\(\) - interval '7 days'/,
    );
  });
});

describe("the throttle reaches the user as something true", () => {
  it("🧨 a throttled CREATE is not reported as 'you're not in this room'", () => {
    // Every RPC error used to collapse to reason:"error", which falls through
    // failureFromJoin's default to "denied" — whose copy is "You're not in
    // this room", with action: null. On the CREATE path that is about a room
    // the user was trying to START, and it is a dead end.
    expect(ACTION).toContain("isThrottled");
    const create = ACTION.slice(
      ACTION.indexOf("export async function createRoom"),
      ACTION.indexOf("export async function joinRoom"),
    );
    const throttled = create.indexOf("isThrottled(error)");
    const generic = create.indexOf('reason: "error"');
    expect(throttled).toBeGreaterThan(-1);
    // The specific branch must come FIRST, or the generic one swallows it.
    expect(throttled).toBeLessThan(generic);
  });

  it("recognises the SQLSTATE the migration actually raises", () => {
    // Tied to the migration rather than hard-coded twice: a changed errcode
    // in the SQL with a stale constant here is a throttle that reports as a
    // crash, and nothing else would notice.
    // 🧨 Anchored to the throttle's OWN raise. A bare /errcode = '(\d+)'/
    // matches the FIRST code in the file, which is 42501 (auth required) --
    // so this test would have been asserting that room-action.ts contains the
    // auth code, and passed or failed for reasons unrelated to the throttle.
    const raised = CREATE_FN.match(
      /too many room creations' using errcode = '(\d+)'/,
    );
    expect(raised, "the throttle raise was not found").toBeTruthy();
    expect(raised![1]).toBe("53400");
    expect(ACTION).toContain(`"${raised![1]}"`);
  });

  it("maps a throttled create to too-many-rooms, not denied", () => {
    // failureFromJoin already branches on mode for "rate-limited"; this pins
    // that the create path reaches it with that reason rather than "error".
    const errors = code("lib/room-errors.ts");
    expect(errors).toMatch(
      /rate-limited[\s\S]{0,120}mode === "create" \? "too-many-rooms" : "denied"/,
    );
  });

  it("applies the same recognition to join", () => {
    const joinFn = ACTION.slice(
      ACTION.indexOf("export async function joinRoom"),
    );
    expect(joinFn).toContain("isThrottled(error)");
  });
});
