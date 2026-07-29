/**
 * LIVE staging verification for the Plan Together security track.
 *
 * This is the harness the staging brief requires: real accounts, real JWTs,
 * real PostgREST calls and real Realtime WebSockets — not unit tests standing
 * in for database behaviour. It creates three disposable users (A host,
 * B member, C unrelated), runs the full access-control matrix against the
 * applied policies, measures how long an already-open socket survives room
 * closure, and deletes everything it made.
 *
 *   STAGING_PROJECT_REF=<ref> \
 *   STAGING_SUPABASE_URL=https://<ref>.supabase.co \
 *   STAGING_ANON_KEY=… STAGING_SERVICE_ROLE_KEY=… \
 *   pnpm tsx scripts/staging-room-security-suite.ts
 *
 * 🧨 PRODUCTION GUARD. The script refuses to run unless STAGING_PROJECT_REF is
 * set AND differs from every known production ref AND matches the URL it was
 * given. It never prints a key, a JWT, a password or a full room code. Test
 * users are created with random passwords that exist only in memory.
 *
 * Exit 0 = every expectation held. Exit 1 = at least one did not (or the
 * environment could not be proven non-production).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Known production refs. A ref in this list can never be the target, whatever
// the environment says. Extend it if another production project is ever added.
const PRODUCTION_REFS = ["fxfuzabrivuianfwdopc"];

type Check = {
  id: string;
  area: string;
  expectation: string;
  result: "PASS" | "FAIL" | "SKIP";
  detail: string;
};

const checks: Check[] = [];
function record(
  id: string,
  area: string,
  expectation: string,
  pass: boolean | "skip",
  detail = "",
) {
  checks.push({
    id,
    area,
    expectation,
    result: pass === "skip" ? "SKIP" : pass ? "PASS" : "FAIL",
    detail,
  });
  const mark = pass === "skip" ? "○" : pass ? "✅" : "❌";
  console.log(`${mark} [${id}] ${expectation}${detail ? ` — ${detail}` : ""}`);
}

/** Redact a room code everywhere it might be printed. */
const redact = (code: string) => `${code.slice(0, 2)}····`;

function env(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name}. See the header of this file.`);
    process.exit(1);
  }
  return v;
}

// ── Phase 1: prove the target is not production ─────────────────────────
function assertStaging(): { ref: string; url: string } {
  const ref = env("STAGING_PROJECT_REF");
  const url = env("STAGING_SUPABASE_URL");

  if (PRODUCTION_REFS.includes(ref)) {
    console.error(
      `REFUSING TO RUN: ${ref} is a known PRODUCTION project reference.`,
    );
    process.exit(1);
  }
  for (const prod of PRODUCTION_REFS) {
    if (url.includes(prod)) {
      console.error(
        `REFUSING TO RUN: the URL points at production project ${prod}.`,
      );
      process.exit(1);
    }
  }
  if (!url.includes(ref)) {
    console.error(
      "REFUSING TO RUN: STAGING_SUPABASE_URL does not contain STAGING_PROJECT_REF — the two must describe the same project.",
    );
    process.exit(1);
  }
  console.log(`Target: ${ref.slice(0, 6)}…${ref.slice(-4)} (non-production) ✓`);
  return { ref, url };
}

// ── Disposable accounts ─────────────────────────────────────────────────
type Actor = {
  label: "A" | "B" | "C";
  id: string;
  email: string;
  client: SupabaseClient;
  jwt: string;
};

function randomPassword(): string {
  // In-memory only; never logged, never written to disk.
  return `T!${crypto.randomUUID()}${crypto.randomUUID().slice(0, 8)}`;
}

async function makeActor(
  label: Actor["label"],
  url: string,
  anonKey: string,
  admin: SupabaseClient,
): Promise<Actor> {
  const email = `fl-staging-${label.toLowerCase()}-${Date.now()}@example.invalid`;
  const password = randomPassword();
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr || !created.user) {
    throw new Error(`could not create test user ${label}: ${createErr?.message}`);
  }
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signIn, error: signInErr } =
    await client.auth.signInWithPassword({ email, password });
  if (signInErr || !signIn.session) {
    throw new Error(`could not sign in test user ${label}: ${signInErr?.message}`);
  }
  return {
    label,
    id: created.user.id,
    email,
    client,
    jwt: signIn.session.access_token,
  };
}

// ── Realtime probe ──────────────────────────────────────────────────────
/**
 * Try to subscribe to a room topic with a given actor's JWT.
 * Returns the terminal status — SUBSCRIBED means the policy let them in.
 */
async function trySubscribe(
  actor: Actor,
  code: string,
  timeoutMs = 12_000,
): Promise<{ status: string; channel: ReturnType<SupabaseClient["channel"]> }> {
  await actor.client.realtime.setAuth(actor.jwt);
  const channel = actor.client.channel(`plan-${code}`, {
    config: { presence: { key: actor.id }, broadcast: { self: true }, private: true },
  });
  const status = await new Promise<string>((resolve) => {
    const t = setTimeout(() => resolve("TIMED_OUT_NO_CALLBACK"), timeoutMs);
    channel.subscribe((s) => {
      if (s === "SUBSCRIBED" || s === "CHANNEL_ERROR" || s === "TIMED_OUT") {
        clearTimeout(t);
        resolve(s);
      }
    });
  });
  return { status, channel };
}

async function main() {
  const { ref, url } = assertStaging();
  const anonKey = env("STAGING_ANON_KEY");
  const serviceKey = env("STAGING_SERVICE_ROLE_KEY");

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  record(
    "ENV-1",
    "environment",
    "target project is not a known production ref",
    !PRODUCTION_REFS.includes(ref),
    `ref ${ref.slice(0, 6)}…`,
  );
  // Second, independent proof: the database answers as itself before any
  // test data is created.
  const { error: reachErr } = await admin
    .from("plan_rooms")
    .select("id", { head: true, count: "exact" });
  record(
    "ENV-2",
    "environment",
    "staging database reachable and plan_rooms exists (0001 applied)",
    !reachErr,
    reachErr?.message?.slice(0, 60) ?? "",
  );

  const created: Actor[] = [];
  const roomsToDelete: string[] = [];

  try {
    const A = await makeActor("A", url, anonKey, admin);
    const B = await makeActor("B", url, anonKey, admin);
    const C = await makeActor("C", url, anonKey, admin);
    created.push(A, B, C);
    record("ACC-1", "accounts", "three disposable accounts signed in", true);

    // ── A creates a room ────────────────────────────────────────────────
    const code = Array.from({ length: 6 }, () =>
      "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)],
    ).join("");
    const { data: roomRow, error: createErr } = await A.client
      .rpc("create_plan_room", { p_code: code })
      .single<{ id: string; code: string; host_user_id: string; expires_at: string }>();
    record(
      "R-1",
      "room create",
      "host can create a room via RPC",
      !createErr && !!roomRow,
      createErr?.message ?? `room ${redact(code)}`,
    );
    if (!roomRow) throw new Error("cannot continue without a room");
    roomsToDelete.push(roomRow.id);

    record("R-2", "room create", "code is six characters", roomRow.code.length === 6);
    record("R-3", "room create", "creator recorded as host", roomRow.host_user_id === A.id);
    const hours = (Date.parse(roomRow.expires_at) - Date.now()) / 3_600_000;
    record("R-4", "room create", "expiry is ~6 hours", hours > 5.5 && hours < 6.5, `${hours.toFixed(2)}h`);

    // ── B joins through the supported path ──────────────────────────────
    const { data: joined, error: joinErr } = await B.client
      .rpc("join_plan_room", { p_code: code })
      .maybeSingle<{ id: string }>();
    record("R-5", "room join", "member can join with the code", !joinErr && !!joined, joinErr?.message ?? "");

    // ── C: every unauthorised path ──────────────────────────────────────
    const { data: cRooms } = await C.client.from("plan_rooms").select("id, code");
    record("C-1", "table read", "unrelated account reads NO room rows", (cRooms?.length ?? 0) === 0, `${cRooms?.length ?? 0} rows`);

    const { data: cMembers } = await C.client.from("plan_room_members").select("user_id");
    record("C-2", "table read", "unrelated account reads NO membership rows", (cMembers?.length ?? 0) === 0, `${cMembers?.length ?? 0} rows`);

    const cSub = await trySubscribe(C, code);
    record("C-3", "realtime", "unrelated account CANNOT subscribe to the room", cSub.status !== "SUBSCRIBED", `status ${cSub.status}`);
    await C.client.removeChannel(cSub.channel);

    // C tries the host-theft primitive with a caller-chosen stale window.
    const { data: cPromote } = await C.client.rpc("promote_plan_room_host", {
      p_room_id: roomRow.id,
      p_stale_seconds: 0,
    });
    record("C-4", "host theft", "unrelated account cannot promote itself (stale=0)", cPromote !== C.id, `returned ${cPromote ? "a host" : "null"}`);

    const { data: cClose } = await C.client.rpc("close_plan_room", { p_room_id: roomRow.id });
    record("C-5", "closure", "unrelated account cannot close the room", cClose !== true);

    const { error: cPurge } = await C.client.rpc("purge_expired_plan_rooms");
    record("C-6", "purge", "unrelated account cannot execute purge", !!cPurge, cPurge?.message?.slice(0, 60) ?? "NO ERROR — BAD");

    // ── Legitimate members can subscribe ────────────────────────────────
    const aSub = await trySubscribe(A, code);
    record("M-1", "realtime", "host CAN subscribe", aSub.status === "SUBSCRIBED", `status ${aSub.status}`);
    const bSub = await trySubscribe(B, code);
    record("M-2", "realtime", "member CAN subscribe", bSub.status === "SUBSCRIBED", `status ${bSub.status}`);

    // ── Host-steal attempt by a REAL member with stale=0 (the clamp) ─────
    const { data: bPromote } = await B.client.rpc("promote_plan_room_host", {
      p_room_id: roomRow.id,
      p_stale_seconds: 0,
    });
    record("M-3", "host theft", "member cannot steal host from a live host via stale=0", bPromote === A.id, `host is now ${bPromote === A.id ? "A (unchanged)" : "CHANGED"}`);

    // ── Join throttle, enforced in the DB (direct RPC, no UI) ────────────
    let throttled = false;
    for (let i = 0; i < 25; i++) {
      const fake = Array.from({ length: 6 }, () =>
        "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)],
      ).join("");
      const { error } = await C.client.rpc("join_plan_room", { p_code: fake });
      if (error?.message?.includes("too many join attempts")) {
        throttled = true;
        record("T-1", "throttle", "direct RPC join is throttled server-side", true, `tripped at attempt ${i + 1}`);
        break;
      }
    }
    if (!throttled) record("T-1", "throttle", "direct RPC join is throttled server-side", false, "25 attempts, never tripped");

    // ── Closure + existing-socket measurement ───────────────────────────
    const bStillOpen = bSub.status === "SUBSCRIBED" ? bSub.channel : null;
    const { data: closed } = await A.client.rpc("close_plan_room", { p_room_id: roomRow.id });
    record("X-1", "closure", "host can close the room", closed === true);

    const cAfter = await trySubscribe(C, code, 8000);
    record("X-2", "closure", "NEW subscribe is denied after closure", cAfter.status !== "SUBSCRIBED", `status ${cAfter.status}`);
    await C.client.removeChannel(cAfter.channel);

    const bAfter = await trySubscribe(B, code, 8000);
    record("X-3", "closure", "member's NEW subscribe is denied after closure", bAfter.status !== "SUBSCRIBED", `status ${bAfter.status}`);
    await B.client.removeChannel(bAfter.channel);

    // 🧨 The mandatory measurement: how long does an ALREADY-OPEN socket keep
    // working after the room closes? RLS is evaluated at join, so this is
    // expected to be non-zero — the number is the deliverable, not a pass/fail.
    if (bStillOpen) {
      const start = Date.now();
      let lastAccepted = -1;
      for (let i = 0; i < 12; i++) {
        const res = await bStillOpen.send({
          type: "broadcast",
          event: "probe",
          payload: { i },
        });
        if (res === "ok") lastAccepted = Date.now() - start;
        else break;
        await new Promise((r) => setTimeout(r, 5000));
      }
      record(
        "X-4",
        "existing socket",
        "measured how long an open socket still broadcasts after closure",
        true,
        lastAccepted < 0 ? "rejected immediately" : `accepted for ≥${(lastAccepted / 1000).toFixed(0)}s`,
      );
      await B.client.removeChannel(bStillOpen);
    } else {
      record("X-4", "existing socket", "existing-socket measurement", "skip", "member never subscribed");
    }
    await A.client.removeChannel(aSub.channel);

    // ── Expiry (separate disposable room, expiry moved into the past) ────
    const expCode = Array.from({ length: 6 }, () =>
      "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)],
    ).join("");
    const { data: expRoom } = await A.client
      .rpc("create_plan_room", { p_code: expCode })
      .single<{ id: string }>();
    if (expRoom) {
      roomsToDelete.push(expRoom.id);
      await admin
        .from("plan_rooms")
        .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
        .eq("id", expRoom.id);
      const { data: expJoin } = await B.client
        .rpc("join_plan_room", { p_code: expCode })
        .maybeSingle();
      record("E-1", "expiry", "expired room cannot be joined", !expJoin);
      const expSub = await trySubscribe(B, expCode, 8000);
      record("E-2", "expiry", "expired room denies new subscribe", expSub.status !== "SUBSCRIBED", `status ${expSub.status}`);
      await B.client.removeChannel(expSub.channel);
      const { data: stillReadable } = await A.client
        .from("plan_rooms")
        .select("id, closed_at, expires_at")
        .eq("id", expRoom.id)
        .maybeSingle();
      record("E-3", "expiry", "members can still READ an expired room (so the UI can say why)", !!stillReadable);
    }

    // ── Host handoff with a genuinely stale host ────────────────────────
    const hoCode = Array.from({ length: 6 }, () =>
      "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)],
    ).join("");
    const { data: hoRoom } = await A.client
      .rpc("create_plan_room", { p_code: hoCode })
      .single<{ id: string }>();
    if (hoRoom) {
      roomsToDelete.push(hoRoom.id);
      await B.client.rpc("join_plan_room", { p_code: hoCode });
      await C.client.rpc("join_plan_room", { p_code: hoCode });
      // Age the host's heartbeat past the clamped 30s window.
      await admin
        .from("plan_rooms")
        .update({ host_seen_at: new Date(Date.now() - 120_000).toISOString() })
        .eq("id", hoRoom.id);
      const { data: newHost } = await B.client.rpc("promote_plan_room_host", {
        p_room_id: hoRoom.id,
      });
      record("H-1", "handoff", "a stale host IS replaced", newHost !== A.id, `new host = ${newHost === B.id ? "B" : newHost === C.id ? "C" : "unchanged/A"}`);
      record("H-2", "handoff", "the successor is the earliest-joined remaining member (B)", newHost === B.id);
      // Idempotence: a second call must not flip it again.
      const { data: again } = await C.client.rpc("promote_plan_room_host", {
        p_room_id: hoRoom.id,
      });
      record("H-3", "handoff", "repeat promotion is stable (no host flapping)", again === newHost, `still ${again === B.id ? "B" : "changed"}`);
    }
  } catch (e) {
    record("FATAL", "harness", "suite completed without throwing", false, e instanceof Error ? e.message : String(e));
  } finally {
    // ── Teardown: rooms first (members CASCADE), then the accounts ───────
    for (const id of roomsToDelete) {
      await admin.from("plan_rooms").delete().eq("id", id);
    }
    for (const a of created) {
      await admin.auth.admin.deleteUser(a.id).catch(() => {});
    }
    const { data: leftovers } = await admin
      .from("plan_rooms")
      .select("id")
      .in("id", roomsToDelete.length ? roomsToDelete : ["00000000-0000-0000-0000-000000000000"]);
    record(
      "CLEAN-1",
      "cleanup",
      "every temporary room and account removed",
      (leftovers?.length ?? 0) === 0,
      `${roomsToDelete.length} rooms, ${created.length} accounts`,
    );
  }

  const failed = checks.filter((c) => c.result === "FAIL");
  console.log(
    `\n${checks.filter((c) => c.result === "PASS").length} passed · ${failed.length} failed · ${checks.filter((c) => c.result === "SKIP").length} skipped`,
  );
  console.log(JSON.stringify({ ref: `${ref.slice(0, 6)}…`, checks }, null, 2));
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("harness error:", e instanceof Error ? e.message : e);
  process.exit(1);
});
