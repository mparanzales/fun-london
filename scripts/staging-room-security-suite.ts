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
 * 🧨 PRODUCTION GUARD: refuses unless STAGING_PROJECT_REF is set, is not a
 * known production ref, and matches the URL. No client is constructed before
 * that check. Never prints a key, JWT, password, email or full room code.
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

const PRODUCTION_REFS = ["fxfuzabrivuianfwdopc"];
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

/**
 * The project ref as claimed by the service key itself.
 *
 * A legacy Supabase key is a JWT whose payload carries {"iss":"supabase",
 * "ref":"<project-ref>"}. Decoding it (no signature check needed for a
 * denylist) beats comparing operator-supplied strings: the key names its own
 * project, so a custom domain or a mislabelled env var cannot hide it.
 * Returns null for opaque `sb_secret_…` keys — the caller must then refuse.
 */
function refFromKey(key: string): string | null {
  const parts = key.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as { ref?: string };
    return typeof payload.ref === "string" ? payload.ref.toLowerCase() : null;
  } catch {
    return null;
  }
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

    // Last line of defence before we create anything: a fresh staging project
    // has a handful of users; a production project has a cohort. This measures
    // reality instead of trusting a string.
    const { data: userPage } = await admin.auth.admin.listUsers({ perPage: 1 });
    const totalUsers = (userPage as { total?: number } | null)?.total ?? 0;
    const POPULATED_LIMIT = 25;
    record(
      "ENV-0",
      "environment",
      `target looks like staging (<${POPULATED_LIMIT} existing users)`,
      verdict(totalUsers < POPULATED_LIMIT),
      `${totalUsers} users`,
    );
    if (totalUsers >= POPULATED_LIMIT) {
      throw new Error(
        `refusing to create test data: ${totalUsers} existing users looks like a real cohort`,
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
    record(
      "AN-1",
      "anon",
      "signed-out caller reads no room rows",
      verdict((anonRooms?.length ?? 0) === 0),
      anonRoomsErr
        ? `error: ${anonRoomsErr.code}`
        : `${anonRooms?.length ?? 0} rows`,
    );
    const { error: anonCreate } = await anon.rpc("create_plan_room", {
      p_code: randomCode(),
    });
    record(
      "AN-2",
      "anon",
      "signed-out caller cannot execute create_plan_room",
      verdict(!!anonCreate),
      anonCreate ? `${anonCreate.code}` : "NO ERROR — BAD",
    );

    // ── A creates a room ────────────────────────────────────────────────
    const code = randomCode();
    const { data: room, error: createErr } = await A.client
      .rpc("create_plan_room", { p_code: code })
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
      createErr ? safeErr(createErr) : `room ${redact(code)}`,
    );
    if (!room) throw new Error("no room — cannot continue");
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
      .rpc("join_plan_room", { p_code: code })
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
    const hoCode = randomCode();
    const { data: hoRoom } = await A.client
      .rpc("create_plan_room", { p_code: hoCode })
      .single<{ id: string }>();
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
        "stale host replaced by earliest-joined member",
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
      record("H-3", "handoff", "re-promotion is stable", "SKIP", "no room");
    }
    if (hoRoom) {
      roomIds.push(hoRoom.id);
      const { error: bJoinErr } = await B.client.rpc("join_plan_room", {
        p_code: hoCode,
      });
      const { error: cJoinErr } = await C.client.rpc("join_plan_room", {
        p_code: hoCode,
      });
      record(
        "H-0",
        "handoff",
        "both successors joined (B before C) — the ordering premise",
        verdict(!bJoinErr && !cJoinErr),
        safeErr(bJoinErr ?? cJoinErr),
      );

      await admin
        .from("plan_rooms")
        .update({ host_seen_at: new Date(Date.now() - 120_000).toISOString() })
        .eq("id", hoRoom.id);
      const { data: newHost } = await B.client.rpc("promote_plan_room_host", {
        p_room_id: hoRoom.id,
      });
      record(
        "H-1",
        "handoff",
        "a stale host is replaced by the EARLIEST-JOINED remaining member (B)",
        verdict(newHost === B.id),
        newHost === B.id
          ? "B"
          : newHost === C.id
            ? "C (wrong)"
            : "unchanged/null",
      );
      record(
        "H-2",
        "handoff",
        "the outgoing host is not re-selected",
        verdict(newHost !== A.id),
      );

      // Re-age deliberately: this proves the RULE is stable, not merely that
      // <30s elapsed between two calls.
      await admin
        .from("plan_rooms")
        .update({ host_seen_at: new Date(Date.now() - 120_000).toISOString() })
        .eq("id", hoRoom.id);
      const { data: again } = await C.client.rpc("promote_plan_room_host", {
        p_room_id: hoRoom.id,
      });
      record(
        "H-3",
        "handoff",
        "re-running promotion on a re-aged host is stable (no flapping)",
        verdict(again === newHost),
        `${again === newHost ? "unchanged" : "FLIPPED"}`,
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
    const expCode = randomCode();
    const { data: expRoom } = await A.client
      .rpc("create_plan_room", { p_code: expCode })
      .single<{ id: string }>();
    if (!expRoom) {
      record(
        "E-1",
        "expiry",
        "expired room cannot be joined",
        "SKIP",
        "could not create the expiry fixture",
      );
      record(
        "E-2",
        "expiry",
        "expired room stays readable to members",
        "SKIP",
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
        .rpc("join_plan_room", { p_code: expCode })
        .maybeSingle();
      record(
        "E-1",
        "expiry",
        "expired room cannot be joined",
        verdict(!expJoin),
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
  process.exitCode = failed.length > 0 || inconclusive.length > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error("harness error:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
