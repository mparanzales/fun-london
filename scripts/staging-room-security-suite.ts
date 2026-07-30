/**
 * LIVE staging verification for the Plan Together security track.
 *
 * Real accounts, real JWTs, real PostgREST calls, real Realtime WebSockets —
 * no unit test standing in for database behaviour.
 *
 *   STAGING_PROJECT_REF=<ref> \
 *   STAGING_SUPABASE_URL=https://<ref>.supabase.co \
 *   STAGING_ANON_KEY=… STAGING_SERVICE_ROLE_KEY=… \
 *   pnpm staging:room-security
 *
 * Against a local `supabase start` stack, point STAGING_SUPABASE_URL at
 * http://127.0.0.1:54321 and set STAGING_PROJECT_REF=local. The CLI's demo
 * service key carries no `ref` claim, so the loopback host is what proves the
 * target is not hosted — see isLoopback().
 *
 * 🧨 PRODUCTION GUARD: refuses unless STAGING_PROJECT_REF is set, is not a
 * known production ref, and matches the URL. No client is constructed before
 * that check. Never prints a key, JWT, password, email or full room code.
 *
 * 🧨 The second guard tests IDENTITY, not volume. It used to refuse only when
 * the target held 25+ accounts; production was then measured and holds 16, so
 * the guard could never have fired on the database it existed to protect. Any
 * account that is not one of this suite's own fixtures now aborts the run.
 *
 * 🧨 DESIGN RULE, learned the hard way in review: **a check may never pass
 * because something was broken.** This suite therefore
 *   · runs POSITIVE CONTROLS first and hard-gates the denial checks on them —
 *     if a legitimate member cannot subscribe, "the outsider was denied" is
 *     not evidence of anything;
 *   · treats a timeout / closed socket as INCONCLUSIVE, never as a denial;
 *   · asserts `error === null` on reads that are supposed to succeed-but-
 *     return-nothing, so "0 rows" cannot be a 404, a dead JWT or a missing
 *     table wearing a green tick;
 *   · asserts the SHAPE of expected errors, not merely that some error came back.
 *
 * Exit 0 only when every check is PASS. INCONCLUSIVE fails the run.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { RealtimeChannel } from "@supabase/supabase-js";

import {
  PRODUCTION_REFS,
  FIXTURE_EMAIL,
  isLoopback,
  refFromKey,
} from "./staging-guard";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

type Result = "PASS" | "FAIL" | "INCONCLUSIVE" | "SKIP";
type Check = {
  id: string;
  area: string;
  expectation: string;
  result: Result;
  detail: string;
};

const checks: Check[] = [];
function record(
  id: string,
  area: string,
  expectation: string,
  result: Result,
  detail = "",
) {
  checks.push({ id, area, expectation, result, detail });
  const mark = { PASS: "✅", FAIL: "❌", INCONCLUSIVE: "⚠️ ", SKIP: "○" }[
    result
  ];
  console.log(`${mark} [${id}] ${expectation}${detail ? ` — ${detail}` : ""}`);
}
const verdict = (ok: boolean): Result => (ok ? "PASS" : "FAIL");

const randomCode = () =>
  Array.from(
    { length: 6 },
    () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)],
  ).join("");
const redact = (code: string) => `${code.slice(0, 2)}····`;
/**
 * Database errors can quote data — a unique-violation on plan_rooms_code_key
 * prints `Key (code)=(ABC123) already exists`, i.e. somebody's live room code.
 * Never print a raw message: strip parenthesised values and truncate.
 */
const safeErr = (e: { code?: string; message?: string } | null | undefined) =>
  e
    ? `${e.code ?? "?"}: ${(e.message ?? "").replace(/\([^)]*\)/g, "(…)").slice(0, 60)}`
    : "";

function env(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name}. See the header of this file.`);
    process.exit(1);
  }
  return v;
}

function assertStaging(): { ref: string; url: string } {
  const ref = env("STAGING_PROJECT_REF");
  const url = env("STAGING_SUPABASE_URL");
  const refLower = ref.toLowerCase();
  const urlLower = url.toLowerCase();
  for (const prod of PRODUCTION_REFS) {
    if (refLower === prod || urlLower.includes(prod)) {
      console.error(`REFUSING TO RUN: ${prod} is a PRODUCTION project.`);
      process.exit(1);
    }
  }
  // Local CLI stack: its demo service key carries no `ref` claim, so the
  // key-derived checks below cannot apply. The loopback host is the proof
  // instead — nothing hosted answers on 127.0.0.1.
  if (isLoopback(url)) {
    console.log(`Target: ${url} (local CLI stack, loopback-verified) ✓\n`);
    return { ref, url };
  }
  if (!urlLower.includes(refLower)) {
    console.error(
      "REFUSING TO RUN: STAGING_SUPABASE_URL and STAGING_PROJECT_REF describe different projects.",
    );
    process.exit(1);
  }
  // Strongest check: what does the KEY say it belongs to?
  const keyRef = refFromKey(process.env.STAGING_SERVICE_ROLE_KEY ?? "");
  if (keyRef === null) {
    console.error(
      "REFUSING TO RUN: the service key does not name a project (opaque sb_secret_… key). Use a key whose ref can be verified, or run the checks by hand.",
    );
    process.exit(1);
  }
  if (PRODUCTION_REFS.includes(keyRef)) {
    console.error(
      "REFUSING TO RUN: the SERVICE KEY belongs to a production project, whatever the URL says.",
    );
    process.exit(1);
  }
  if (keyRef !== refLower) {
    console.error(
      "REFUSING TO RUN: the service key belongs to a different project than STAGING_PROJECT_REF.",
    );
    process.exit(1);
  }
  console.log(
    `Target: ${ref.slice(0, 6)}…${ref.slice(-4)} (non-production, key-verified) ✓\n`,
  );
  return { ref, url };
}

type Actor = {
  label: string;
  id: string;
  client: SupabaseClient;
  jwt: string;
};

async function makeActor(
  label: string,
  url: string,
  anonKey: string,
  admin: SupabaseClient,
  registry: Actor[],
): Promise<Actor> {
  const email = `fl-staging-${label.toLowerCase()}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.invalid`;
  // In memory only. Never logged, never persisted.
  const password = `T!${crypto.randomUUID()}${crypto.randomUUID().slice(0, 8)}`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // no mail is ever sent; .invalid is unroutable by RFC 2606
  });
  if (error || !created.user) {
    throw new Error(`create user ${label}: ${error?.message}`);
  }
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const actor: Actor = { label, id: created.user.id, client, jwt: "" };
  // Register BEFORE sign-in so a later failure still tears this user down.
  registry.push(actor);
  const { data: session, error: signInErr } =
    await client.auth.signInWithPassword({ email, password });
  if (signInErr || !session.session) {
    throw new Error(`sign in ${label}: ${signInErr?.message}`);
  }
  actor.jwt = session.session.access_token;
  return actor;
}

/**
 * Subscribe outcome as a TRI-STATE.
 *
 * `denied` requires an explicit CHANNEL_ERROR (how Realtime reports an RLS
 * refusal). A timeout or a closed socket is `inconclusive` — it may mean the
 * service is unreachable, which must never be scored as "the policy worked".
 */
type SubOutcome = {
  state: "allowed" | "denied" | "inconclusive";
  status: string;
  channel: RealtimeChannel;
};

async function trySubscribe(
  actor: Actor,
  code: string,
  timeoutMs = 15_000,
): Promise<SubOutcome> {
  await actor.client.realtime.setAuth(actor.jwt);
  const channel = actor.client.channel(`plan-${code}`, {
    config: {
      presence: { key: actor.id },
      // ack:true makes send() wait for the SERVER's reply instead of resolving
      // as soon as the message is queued locally (see X-4).
      broadcast: { self: true, ack: true },
      private: true,
    },
  });
  const status = await new Promise<string>((resolve) => {
    const t = setTimeout(() => resolve("NO_TERMINAL_STATUS"), timeoutMs);
    try {
      channel.subscribe((s) => {
        if (
          ["SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(s)
        ) {
          clearTimeout(t);
          resolve(s);
        }
      });
    } catch (e) {
      clearTimeout(t);
      resolve(`THREW:${e instanceof Error ? e.message.slice(0, 40) : "?"}`);
    }
  });
  const state: SubOutcome["state"] =
    status === "SUBSCRIBED"
      ? "allowed"
      : status === "CHANNEL_ERROR"
        ? "denied"
        : "inconclusive";
  return { state, status, channel };
}

/** Score a denial check, honouring the inconclusive tri-state. */
function recordDenial(
  id: string,
  area: string,
  expectation: string,
  out: SubOutcome,
) {
  record(
    id,
    area,
    expectation,
    out.state === "denied"
      ? "PASS"
      : out.state === "allowed"
        ? "FAIL"
        : "INCONCLUSIVE",
    `status ${out.status}`,
  );
}

async function main() {
  const { ref, url } = assertStaging();
  const anonKey = env("STAGING_ANON_KEY");
  const admin = createClient(url, env("STAGING_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const actors: Actor[] = [];
  const roomIds: string[] = [];
  let fatal: string | null = null;

  try {
    // ── ENV: prove the schema is actually there before trusting any "0 rows"
    const { error: roomsErr } = await admin
      .from("plan_rooms")
      .select("id", { head: true, count: "exact" });
    const { error: membersErr } = await admin
      .from("plan_room_members")
      .select("user_id", { head: true, count: "exact" });
    record(
      "ENV-1",
      "environment",
      "0001 applied: plan_rooms AND plan_room_members exist",
      verdict(!roomsErr && !membersErr),
      safeErr(roomsErr ?? membersErr),
    );
    if (roomsErr || membersErr)
      throw new Error("0001 is not applied — stopping");

    // Last line of defence before we create anything: does this database hold
    // anybody REAL?
    //
    // The earlier form of this check compared the user count to a threshold of
    // 25. Production was then measured and holds 16 — so the guard could never
    // have fired on the one database it existed to refuse. A count cannot tell
    // a small real cohort from a fresh stack; identity can. Every account this
    // suite creates matches FIXTURE_EMAIL, so ANY other account means the
    // target belongs to real people and we must not touch it.
    const PAGE = 50;
    const { data: userPage, error: usersErr } =
      await admin.auth.admin.listUsers({ perPage: PAGE });
    if (usersErr) {
      throw new Error(`cannot enumerate users: ${usersErr.message}`);
    }
    const existing = userPage?.users ?? [];
    const strangers = existing.filter(
      (u) => !FIXTURE_EMAIL.test(u.email ?? ""),
    );
    const clean = strangers.length === 0 && existing.length < PAGE;
    record(
      "ENV-0",
      "environment",
      "target holds no real user accounts",
      verdict(clean),
      `${existing.length} account(s), ${strangers.length} not test fixtures`,
    );
    if (!clean) {
      throw new Error(
        `refusing to create test data: ${strangers.length} non-fixture account(s) present — this database belongs to real users`,
      );
    }

    const A = await makeActor("A", url, anonKey, admin, actors);
    const B = await makeActor("B", url, anonKey, admin, actors);
    const C = await makeActor("C", url, anonKey, admin, actors);
    const D = await makeActor("D", url, anonKey, admin, actors); // throttle victim
    record("ENV-2", "accounts", "four disposable accounts signed in", "PASS");

    // ── ANON: the moat everyone forgets. A signed-OUT caller must get nothing.
    const anon = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: anonRooms, error: anonRoomsErr } = await anon
      .from("plan_rooms")
      .select("id");
    // 🧨 "Zero rows" is NOT evidence that anon lost its grant.
    //
    // Production hands every new public table `anon = SELECT` by default
    // (measured: pg_default_acl gives anon `rm` on tables created by postgres).
    // 0001's `revoke all ... from anon` is the only thing that removes it. But
    // both RLS policies on these tables are `to authenticated`, so a signed-out
    // caller reads zero rows whether the revoke applied or not — the old
    // assertion passed identically on a database with anon SELECT still live,
    // i.e. it could not fail on the exact regression it exists to catch.
    // Require the PERMISSION error: 42501 is the grant being absent.
    record(
      "AN-1",
      "anon",
      "signed-out caller is refused plan_rooms by GRANT (42501), not merely filtered to 0 rows",
      verdict(anonRoomsErr?.code === "42501"),
      anonRoomsErr
        ? `error: ${anonRoomsErr.code}`
        : `NO ERROR — anon still holds a table grant (${anonRooms?.length ?? 0} rows)`,
    );
    const { data: anonMembers, error: anonMembersErr } = await anon
      .from("plan_room_members")
      .select("user_id");
    record(
      "AN-3",
      "anon",
      "signed-out caller is refused plan_room_members by GRANT (42501)",
      verdict(anonMembersErr?.code === "42501"),
      anonMembersErr
        ? `error: ${anonMembersErr.code}`
        : `NO ERROR — anon still holds a table grant (${anonMembers?.length ?? 0} rows)`,
    );
    const { data: anonAttempts, error: anonAttemptsErr } = await anon
      .from("plan_room_join_attempts")
      .select("user_id");
    record(
      "AN-4",
      "anon",
      "signed-out caller is refused plan_room_join_attempts by GRANT (42501)",
      verdict(anonAttemptsErr?.code === "42501"),
      anonAttemptsErr
        ? `error: ${anonAttemptsErr.code}`
        : `NO ERROR — anon still holds a table grant (${anonAttempts?.length ?? 0} rows)`,
    );
    const { error: anonCreate } = await anon.rpc("create_plan_room", {
      p_code: randomCode(),
    });
    record(
      "AN-2",
      "anon",
      "signed-out caller cannot execute create_plan_room",
      verdict(anonCreate?.code === "42501"),
      anonCreate ? `${anonCreate.code}` : "NO ERROR — BAD",
    );

    // ── A creates a room ────────────────────────────────────────────────
    // 🧨 No argument: 0004 mints the code server-side, and the code it returns
    // is the ONLY valid one. Passing our own and then joining with it — which
    // this suite used to do — silently breaks the moment 0004 lands, because
    // join_plan_room returns NULL *without an error* for an unknown code.
    const { data: room, error: createErr } = await A.client
      .rpc("create_plan_room")
      .single<{
        id: string;
        code: string;
        host_user_id: string;
        expires_at: string;
      }>();
    record(
      "R-1",
      "room create",
      "host creates a room via RPC",
      verdict(!createErr && !!room),
      createErr ? safeErr(createErr) : `room ${redact(room?.code ?? "")}`,
    );
    if (!room) throw new Error("no room — cannot continue");
    const code = room.code;
    roomIds.push(room.id);
    record(
      "R-2",
      "room create",
      "code is six characters",
      verdict(room.code.length === 6),
    );
    record(
      "R-3",
      "room create",
      "creator recorded as host",
      verdict(room.host_user_id === A.id),
    );
    const hrs = (Date.parse(room.expires_at) - Date.now()) / 3_600_000;
    record(
      "R-4",
      "room create",
      "expiry is ~6 hours",
      verdict(hrs > 5.5 && hrs < 6.5),
      `${hrs.toFixed(2)}h`,
    );

    const { data: joined, error: joinErr } = await B.client
      .rpc("join_plan_room", { p_code: room.code })
      .maybeSingle<{ id: string }>();
    record(
      "R-5",
      "room join",
      "invited member joins with the code",
      verdict(!joinErr && !!joined),
      safeErr(joinErr),
    );

    // ── POSITIVE CONTROLS FIRST. Every denial below is gated on these.
    const aSub = await trySubscribe(A, code);
    record(
      "M-1",
      "realtime",
      "host CAN subscribe (positive control)",
      verdict(aSub.state === "allowed"),
      `status ${aSub.status}`,
    );
    const bSub = await trySubscribe(B, code);
    record(
      "M-2",
      "realtime",
      "member CAN subscribe (positive control)",
      verdict(bSub.state === "allowed"),
      `status ${bSub.status}`,
    );
    const realtimeProven = aSub.state === "allowed" && bSub.state === "allowed";
    if (!realtimeProven) {
      record(
        "GATE-1",
        "realtime",
        "Realtime reachable — denial checks are meaningful",
        "FAIL",
        "positive control failed; every denial below is INCONCLUSIVE",
      );
    }

    // Positive control for the table reads, for the same reason.
    const { data: bRoomRead, error: bRoomErr } = await B.client
      .from("plan_rooms")
      .select("id")
      .eq("id", room.id)
      .maybeSingle();
    record(
      "M-3",
      "table read",
      "member CAN read their own room (positive control)",
      verdict(!bRoomErr && !!bRoomRead),
      safeErr(bRoomErr),
    );

    // ── C: unauthorised paths ───────────────────────────────────────────
    const { data: cRooms, error: cRoomsErr } = await C.client
      .from("plan_rooms")
      .select("id");
    record(
      "C-1",
      "table read",
      "unrelated account reads NO room rows (and the query itself succeeded)",
      cRoomsErr ? "INCONCLUSIVE" : verdict((cRooms?.length ?? 0) === 0),
      cRoomsErr
        ? `query errored: ${cRoomsErr.code}`
        : `${cRooms?.length ?? 0} rows`,
    );
    const { data: cMembers, error: cMembersErr } = await C.client
      .from("plan_room_members")
      .select("user_id");
    record(
      "C-2",
      "table read",
      "unrelated account reads NO membership rows (and the query itself succeeded)",
      cMembersErr ? "INCONCLUSIVE" : verdict((cMembers?.length ?? 0) === 0),
      cMembersErr
        ? `query errored: ${cMembersErr.code}`
        : `${cMembers?.length ?? 0} rows`,
    );

    const cSub = await trySubscribe(C, code);
    if (realtimeProven) {
      recordDenial(
        "C-3",
        "realtime",
        "unrelated account CANNOT subscribe",
        cSub,
      );
    } else {
      record(
        "C-3",
        "realtime",
        "unrelated account CANNOT subscribe",
        "INCONCLUSIVE",
        "positive control failed",
      );
    }
    await C.client.removeChannel(cSub.channel);

    // Host theft with a caller-chosen window, by a NON-member and by a member.
    await C.client.rpc("promote_plan_room_host", {
      p_room_id: room.id,
      p_stale_seconds: 0,
    });
    const { data: hostAfterC } = await admin
      .from("plan_rooms")
      .select("host_user_id")
      .eq("id", room.id)
      .single<{ host_user_id: string }>();
    record(
      "C-4",
      "host theft",
      "non-member cannot promote (host unchanged, asserted from the DB)",
      verdict(hostAfterC?.host_user_id === A.id),
    );

    // The host's own client pings this every tick; without it a slow preceding
    // probe could push host_seen_at past the window and make a LEGITIMATE
    // promotion look like a clamp failure.
    await A.client.rpc("touch_plan_room_host", { p_room_id: room.id });
    await B.client.rpc("promote_plan_room_host", {
      p_room_id: room.id,
      p_stale_seconds: 0,
    });
    const { data: hostAfterB } = await admin
      .from("plan_rooms")
      .select("host_user_id")
      .eq("id", room.id)
      .single<{ host_user_id: string }>();
    record(
      "C-5",
      "host theft",
      "member cannot steal host from a LIVE host via stale=0 (clamp holds)",
      verdict(hostAfterB?.host_user_id === A.id),
    );

    await C.client.rpc("close_plan_room", { p_room_id: room.id });
    const { data: afterClose } = await admin
      .from("plan_rooms")
      .select("closed_at")
      .eq("id", room.id)
      .single<{ closed_at: string | null }>();
    record(
      "C-6",
      "closure",
      "non-member cannot close the room (asserted from the DB)",
      verdict(afterClose?.closed_at === null),
    );

    const { error: cPurge } = await C.client.rpc("purge_expired_plan_rooms");
    const purgeDenied =
      !!cPurge &&
      /permission|denied|service role|42501/i.test(
        `${cPurge.message} ${cPurge.code}`,
      );
    record(
      "C-7",
      "purge",
      "unrelated account is DENIED purge (by permission, not by a missing function)",
      cPurge ? verdict(purgeDenied) : "FAIL",
      cPurge ? safeErr(cPurge) : "NO ERROR — BAD",
    );

    // ── HOST HANDOFF (before the throttle test, which burns an account) ──
    const { data: hoRoom } = await A.client
      .rpc("create_plan_room")
      .single<{ id: string; code: string }>();
    if (!hoRoom) {
      record(
        "H-0",
        "handoff",
        "handoff room created",
        "FAIL",
        "could not create the room",
      );
      record(
        "H-1",
        "handoff",
        "stale host replaced by the next member in the ring",
        "SKIP",
        "no room",
      );
      record(
        "H-2",
        "handoff",
        "outgoing host not re-selected",
        "SKIP",
        "no room",
      );
      record("H-3", "handoff", "promotion is not reentrant", "SKIP", "no room");
      record(
        "H-4",
        "handoff",
        "handoffs rotate, never two-cycle",
        "SKIP",
        "no room",
      );
    }
    if (hoRoom) {
      roomIds.push(hoRoom.id);
      const { error: bJoinErr } = await B.client.rpc("join_plan_room", {
        p_code: hoRoom.code,
      });
      const { error: cJoinErr } = await C.client.rpc("join_plan_room", {
        p_code: hoRoom.code,
      });
      // `join_plan_room` returns NULL *without an error* for an unknown, closed
      // or expired code, so "no error" is not evidence that anybody joined —
      // the same false-pass that E-1 was just fixed for. Everything below rests
      // on B and C actually being members, so assert the rows.
      const { count: hoMembers, error: hoMembersErr } = await admin
        .from("plan_room_members")
        .select("user_id", { head: true, count: "exact" })
        .eq("room_id", hoRoom.id)
        .in("user_id", [B.id, C.id]);
      // The premise H-1 and H-4 rest on is the ORDER, not merely the count, so
      // assert it rather than naming it in a label.
      const { data: hoOrder } = await admin
        .from("plan_room_members")
        .select("user_id, joined_at")
        .eq("room_id", hoRoom.id)
        .order("joined_at", { ascending: true });
      const order = (hoOrder ?? []).map((r) => (r as { user_id: string }).user_id);
      const bBeforeC =
        order.indexOf(B.id) > -1 &&
        order.indexOf(C.id) > -1 &&
        order.indexOf(B.id) < order.indexOf(C.id);
      const joinedBoth = hoMembers === 2 && bBeforeC;
      record(
        "H-0",
        "handoff",
        "both successors joined (B before C) — the ordering premise",
        hoMembersErr || hoMembers === null
          ? "INCONCLUSIVE"
          : verdict(!bJoinErr && !cJoinErr && joinedBoth),
        hoMembersErr
          ? `count query errored: ${hoMembersErr.code}`
          : `${hoMembers ?? "unknown"} of 2 membership rows, B before C: ${bBeforeC}${safeErr(bJoinErr ?? cJoinErr) ? ` — ${safeErr(bJoinErr ?? cJoinErr)}` : ""}`,
      );

      await admin
        .from("plan_rooms")
        .update({ host_seen_at: new Date(Date.now() - 120_000).toISOString() })
        .eq("id", hoRoom.id);
      const { data: newHost, error: promoteErr } = await B.client.rpc(
        "promote_plan_room_host",
        { p_room_id: hoRoom.id },
      );
      // H-1 does NOT discriminate the rotation fix from the rule it replaced —
      // B is the answer under both. Only H-4 is evidence for the fix. H-1's job
      // is to establish that promotion works at all, so H-3/H-4 mean something.
      const handoffProven = !promoteErr && newHost === B.id && joinedBoth;
      record(
        "H-1",
        "handoff",
        "a stale host is replaced by the next member in the ring (B)",
        promoteErr ? "INCONCLUSIVE" : verdict(newHost === B.id),
        promoteErr
          ? safeErr(promoteErr)
          : newHost === B.id
            ? "B"
            : newHost === C.id
              ? "C (wrong)"
              : "unchanged/null",
      );
      record(
        "H-2",
        "handoff",
        "the outgoing host is not re-selected",
        promoteErr ? "INCONCLUSIVE" : verdict(newHost !== A.id),
      );

      // H-3 and H-4 are gated on H-1 for the same reason the realtime denials
      // are gated on the positive controls: if promotion never worked, "the
      // host did not move" and "no two-cycle" are both trivially true.
      // H-3 — NOT reentrant. A promotion sets host_seen_at = now(), so calling
      // again immediately must be a no-op. This is the guarantee that stops a
      // roomful of retrying devices from trading the host role around.
      const { data: immediate, error: immediateErr } = await C.client.rpc(
        "promote_plan_room_host",
        { p_room_id: hoRoom.id },
      );
      record(
        "H-3",
        "handoff",
        "promotion is not reentrant — an immediate re-run cannot move the host",
        !handoffProven || immediateErr || immediate == null
          ? "INCONCLUSIVE"
          : verdict(immediate === newHost),
        !handoffProven
          ? "H-1 did not establish a working handoff"
          : immediateErr
            ? safeErr(immediateErr)
            : immediate == null
              ? "RPC returned no host"
              : immediate === newHost
                ? "unchanged"
                : "MOVED without the host going stale",
      );

      // H-4 — when the NEW host also goes stale, handoff must ROTATE, never
      // two-cycle. The original code excluded only the current host, so the
      // earliest-joined member — the absent host we had just replaced — was
      // immediately eligible again and the room ping-ponged A→B→A→B forever,
      // never reaching a device that was actually present. Measured on a live
      // database 2026-07-29; fixed in 0001 by rotating forward.
      //
      // 🧨 This is the ONLY check that proves the defect this migration exists
      // to fix, so it must not be able to go green having measured nothing.
      // The first version discarded the RPC error and skipped nulls, so three
      // failed calls produced [B, null, null, null] and scored PASS. Every
      // round's error is now captured, any missing answer is INCONCLUSIVE, and
      // the assertion is POSITIVE — all three members appear and no two
      // consecutive rounds repeat — rather than merely "nothing repeated at a
      // distance of two", which [B, B, C, C] would have satisfied.
      const sequence: (string | null)[] = [newHost as string | null];
      let roundProblem = "";
      for (let round = 0; round < 3 && !roundProblem; round++) {
        const { error: ageErr } = await admin
          .from("plan_rooms")
          .update({
            host_seen_at: new Date(Date.now() - 120_000).toISOString(),
          })
          .eq("id", hoRoom.id);
        if (ageErr) {
          roundProblem = `could not age the host in round ${round + 1}: ${safeErr(ageErr)}`;
          break;
        }
        const caller = round % 2 === 0 ? C : B;
        const { data: next, error: nextErr } = await caller.client.rpc(
          "promote_plan_room_host",
          { p_room_id: hoRoom.id },
        );
        if (nextErr || next == null) {
          roundProblem = `round ${round + 1} returned no host${nextErr ? `: ${safeErr(nextErr)}` : ""}`;
          break;
        }
        sequence.push(next as string);
      }
      const label = (h: string | null) =>
        h === A.id ? "A" : h === B.id ? "B" : h === C.id ? "C" : "?";
      const complete = !roundProblem && sequence.length === 4;
      const distinct = new Set(sequence).size === 3;
      const adjacentDiffer = sequence.every(
        (h, i) => i === 0 || h !== sequence[i - 1],
      );
      record(
        "H-4",
        "handoff",
        "repeated handoffs ROTATE through the roster — they never two-cycle",
        !handoffProven || !complete
          ? "INCONCLUSIVE"
          : verdict(distinct && adjacentDiffer),
        !handoffProven
          ? "H-1 did not establish a working handoff"
          : roundProblem
            ? roundProblem
            : `${sequence.map(label).join(" → ")}${distinct ? "" : " — did NOT reach all three"}`,
      );
    }

    // ── EXISTING SOCKET AFTER CLOSURE — the mandatory measurement ────────
    // Runs on B's ORIGINAL channel, before any re-subscribe touches that topic.
    const { data: closedOk } = await A.client.rpc("close_plan_room", {
      p_room_id: room.id,
    });
    record(
      "X-1",
      "closure",
      "host can close the room",
      verdict(closedOk === true),
    );

    if (bSub.state === "allowed") {
      const start = Date.now();
      let lastAck = -1;
      let sawEcho = false;
      bSub.channel.on("broadcast", { event: "probe" }, () => {
        sawEcho = true;
      });
      for (let i = 0; i < 12; i++) {
        if (bSub.channel.state !== "joined") break; // never let the HTTP fallback answer for the socket
        sawEcho = false;
        const res = await bSub.channel.send({
          type: "broadcast",
          event: "probe",
          payload: { i },
        });
        await new Promise((r) => setTimeout(r, 500));
        // ack:true means 'ok' is the SERVER's reply; the echo is the second,
        // independent confirmation that the message actually round-tripped.
        if (res === "ok" && sawEcho) lastAck = Date.now() - start;
        else break;
        await new Promise((r) => setTimeout(r, 4500));
      }
      record(
        "X-2",
        "existing socket",
        "MEASURED: how long an already-open socket keeps broadcasting after closure",
        "PASS",
        lastAck < 0
          ? "rejected immediately (0s)"
          : `still accepted at ≥${(lastAck / 1000).toFixed(0)}s`,
      );
    } else {
      record(
        "X-2",
        "existing socket",
        "existing-socket measurement",
        "SKIP",
        "member never subscribed",
      );
    }
    await A.client.removeChannel(aSub.channel);
    await B.client.removeChannel(bSub.channel);

    // Fresh clients for post-closure subscribes (never re-subscribe a topic on
    // a client that still holds that channel).
    const bFresh: Actor = {
      ...B,
      client: createClient(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      }),
    };
    const cFresh: Actor = {
      ...C,
      client: createClient(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      }),
    };
    const bAfter = await trySubscribe(bFresh, code, 10_000);
    if (realtimeProven)
      recordDenial(
        "X-3",
        "closure",
        "member's NEW subscribe is denied after closure",
        bAfter,
      );
    else
      record(
        "X-3",
        "closure",
        "member's NEW subscribe is denied after closure",
        "INCONCLUSIVE",
        "positive control failed",
      );
    await bFresh.client.removeChannel(bAfter.channel);
    const cAfter = await trySubscribe(cFresh, code, 10_000);
    if (realtimeProven)
      recordDenial(
        "X-4",
        "closure",
        "unrelated account still denied after closure",
        cAfter,
      );
    else
      record(
        "X-4",
        "closure",
        "unrelated account still denied after closure",
        "INCONCLUSIVE",
        "positive control failed",
      );
    await cFresh.client.removeChannel(cAfter.channel);
    await bFresh.client.realtime.disconnect();
    await cFresh.client.realtime.disconnect();

    // ── EXPIRY ──────────────────────────────────────────────────────────
    const { data: expRoom } = await A.client
      .rpc("create_plan_room")
      .single<{ id: string; code: string }>();
    if (!expRoom) {
      // An unmet fixture precondition is INCONCLUSIVE, never SKIP. A SKIP does
      // not affect the exit code, so recording one here meant the expiry
      // invariants could go unexecuted and the suite would still exit 0.
      record(
        "E-1",
        "expiry",
        "expired room cannot be joined",
        "INCONCLUSIVE",
        "could not create the expiry fixture",
      );
      record(
        "E-2",
        "expiry",
        "expired room stays readable to members",
        "INCONCLUSIVE",
        "could not create the expiry fixture",
      );
    }
    if (expRoom) {
      roomIds.push(expRoom.id);
      await admin
        .from("plan_rooms")
        .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
        .eq("id", expRoom.id);
      const { data: expJoin } = await B.client
        .rpc("join_plan_room", { p_code: expRoom.code })
        .maybeSingle();
      // Assert the EFFECT, not the payload. A plpgsql function declared
      // `returns public.plan_rooms` that returns NULL comes back over PostgREST
      // as an object with every column null — truthy in JS. Testing `!expJoin`
      // therefore failed against a database that had correctly refused the
      // join (proven directly in SQL: 0 membership rows). What matters is
      // whether a membership row appeared, so measure that.
      const { count: expMembers, error: expMembersErr } = await admin
        .from("plan_room_members")
        .select("user_id", { head: true, count: "exact" })
        .eq("room_id", expRoom.id)
        .eq("user_id", B.id);
      record(
        "E-1",
        "expiry",
        "expired room cannot be joined (no membership row is created)",
        expMembersErr || expMembers === null
          ? "INCONCLUSIVE"
          : verdict(
              expMembers === 0 && !(expJoin as { id?: string } | null)?.id,
            ),
        expMembersErr
          ? `count query errored: ${expMembersErr.code}`
          : `${expMembers ?? 0} membership rows`,
      );
      const { data: stillReadable, error: readErr } = await A.client
        .from("plan_rooms")
        .select("id, expires_at")
        .eq("id", expRoom.id)
        .maybeSingle();
      record(
        "E-2",
        "expiry",
        "a member can STILL READ an expired room, so the UI can say why",
        verdict(!readErr && !!stillReadable),
        safeErr(readErr),
      );
    }

    // ── JOIN THROTTLE (last: it permanently burns actor D for 10 minutes) ─
    let trippedAt = -1;
    for (let i = 1; i <= 25; i++) {
      const { error } = await D.client.rpc("join_plan_room", {
        p_code: randomCode(),
      });
      if (error && /too many join attempts/i.test(error.message)) {
        trippedAt = i;
        break;
      }
    }
    record(
      "T-1",
      "throttle",
      "direct RPC join is throttled SERVER-SIDE (no UI in the path)",
      verdict(trippedAt > 0 && trippedAt <= 21),
      trippedAt > 0
        ? `tripped at attempt ${trippedAt}`
        : "25 attempts, never tripped",
    );
  } catch (e) {
    fatal = e instanceof Error ? e.message : String(e);
    record("FATAL", "harness", "suite ran to completion", "FAIL", fatal);
  } finally {
    // ── Teardown ────────────────────────────────────────────────────────
    for (const a of actors) {
      try {
        await a.client.removeAllChannels();
        await a.client.realtime.disconnect();
      } catch {
        /* best effort */
      }
    }
    for (const id of roomIds) {
      await admin.from("plan_rooms").delete().eq("id", id);
    }
    let userDeleteFailures = 0;
    for (const a of actors) {
      const { error } = await admin.auth.admin.deleteUser(a.id);
      if (error) userDeleteFailures++;
    }
    const { data: leftoverRooms } = await admin
      .from("plan_rooms")
      .select("id")
      .in(
        "id",
        roomIds.length ? roomIds : ["00000000-0000-0000-0000-000000000000"],
      );
    // Verify the users are really gone rather than trusting the delete call.
    let leftoverUsers = 0;
    for (const a of actors) {
      const { data } = await admin.auth.admin.getUserById(a.id);
      if (data?.user) leftoverUsers++;
    }
    record(
      "CLEAN-1",
      "cleanup",
      "every temporary room AND account verified removed",
      verdict(
        (leftoverRooms?.length ?? 0) === 0 &&
          leftoverUsers === 0 &&
          userDeleteFailures === 0,
      ),
      `rooms left ${leftoverRooms?.length ?? 0}, users left ${leftoverUsers}, delete errors ${userDeleteFailures}`,
    );
  }

  const failed = checks.filter((c) => c.result === "FAIL");
  const inconclusive = checks.filter((c) => c.result === "INCONCLUSIVE");
  console.log(
    `\n${checks.filter((c) => c.result === "PASS").length} passed · ${failed.length} failed · ${inconclusive.length} inconclusive · ${checks.filter((c) => c.result === "SKIP").length} skipped`,
  );
  if (inconclusive.length)
    console.log(
      "INCONCLUSIVE checks are NOT passes: re-run once the cause is fixed.",
    );
  console.log(JSON.stringify({ ref: `${ref.slice(0, 6)}…`, checks }, null, 2));
  // Let stdout drain naturally — process.exit() truncates a piped evidence file.
  const skipped = checks.filter((c) => c.result === "SKIP");
  // The header promises "Exit 0 only when every check is PASS". A SKIP used to
  // slip through that, so a block whose fixture never got built could leave its
  // invariants unexecuted behind a green exit code.
  process.exitCode =
    failed.length > 0 || inconclusive.length > 0 || skipped.length > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error("harness error:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
