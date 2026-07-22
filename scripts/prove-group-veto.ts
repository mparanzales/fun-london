// Proof harness: drive FOUR independent Supabase Realtime clients (a host + three
// others) over the app's real Realtime — the same channel/events the app uses —
// to prove that group react/veto actually syncs between devices: a member's veto
// reaches the others, a majority makes the host swap the stop, the swap lands on
// everyone, and a member who leaves stops counting. No UI / no auth needed, so
// this exercises the exact transport four phones use.
//
// ⚠️ DIVERGENCE, and it is the point. The app subscribes with `private: true`
// (lib/realtime/room.ts) and hands Realtime the signed-in access token; this
// harness subscribes WITHOUT it, on the anon key. That this still works means
// the channel is not actually locked down: `private: true` only takes effect
// with a matching RLS policy on realtime.messages, and NO SUCH POLICY EXISTS
// IN THIS REPO. So today, anyone who guesses a 4-character room code can read
// the room, including the taste maps members broadcast into it.
//
// Until that policy is written and applied, do not claim room channels are
// private anywhere user-facing. When it IS applied, this harness will start
// failing to subscribe — that failure is the fix landing, not a regression;
// give it a signed-in token at that point.
//
// Run: pnpm tsx scripts/prove-group-veto.ts

import { readFileSync } from "fs";
import { createClient, type RealtimeChannel } from "@supabase/supabase-js";
import {
  vetoMajority,
  pruneReactions,
  countReactions,
} from "../lib/group-veto";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const envVar = (k: string) =>
  env
    .match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]
    ?.trim()
    .replace(/^["']|["']$/g, "");
const SUPABASE_URL = envVar("NEXT_PUBLIC_SUPABASE_URL")!;
const ANON_KEY = envVar("NEXT_PUBLIC_SUPABASE_ANON_KEY")!;

const CODE = "PROVE" + Math.random().toString(36).slice(2, 6).toUpperCase();
const TOPIC = `plan-${CODE}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type React = "keep" | "veto";
type Member = { id: string; name: string; color: string };

// A device: its own client + channel + the state it derives from what it receives
// (mirrors lib/realtime/room.ts — presence sync, react/swap handlers, pruning).
function makeDevice(member: Member, isHost: boolean) {
  const sb = createClient(SUPABASE_URL, ANON_KEY);
  const state = {
    members: [member] as Member[],
    reactions: {} as Record<number, Record<string, React>>,
    swaps: {} as Record<number, number>,
  };
  const ch: RealtimeChannel = sb.channel(TOPIC, {
    config: { presence: { key: member.id }, broadcast: { self: true } },
  });

  ch.on("presence", { event: "sync" }, () => {
    const ps = ch.presenceState() as Record<string, unknown[]>;
    const seen = new Set<string>();
    const list: Member[] = [];
    for (const k of Object.keys(ps))
      for (const p of ps[k]) {
        const m = p as Partial<Member>;
        if (m.id && m.name && m.color && !seen.has(m.id)) {
          seen.add(m.id);
          list.push(m as Member);
        }
      }
    if (list.length > 0) {
      state.members = list;
      state.reactions = pruneReactions(state.reactions, seen); // drop departed voters
    }
  });
  ch.on("broadcast", { event: "react" }, ({ payload }) => {
    const { memberId, stepIdx, value } = payload as {
      memberId: string;
      stepIdx: number;
      value: React | null;
    };
    const stop = { ...(state.reactions[stepIdx] ?? {}) };
    if (value) stop[memberId] = value;
    else delete stop[memberId];
    state.reactions[stepIdx] = stop;
  });
  ch.on("broadcast", { event: "swap" }, ({ payload }) => {
    const { stepIdx, altIdx } = payload as { stepIdx: number; altIdx: number };
    state.swaps[stepIdx] = altIdx;
    delete state.reactions[stepIdx]; // a swapped stop starts fresh
  });

  const sendReact = (stepIdx: number, value: React) =>
    ch.send({
      type: "broadcast",
      event: "react",
      payload: { memberId: member.id, stepIdx, value },
    });

  // Count only members still present (the real app's logic) — a lingering vote
  // from someone who left can never count.
  const vetoCount = (stepIdx: number) =>
    countReactions(
      state.reactions[stepIdx],
      "veto",
      new Set(state.members.map((m) => m.id)),
    );

  // What the HOST does: on any reaction, if a stop's vetoes are a live majority,
  // advance it for everyone (idempotent — same target index if it re-runs).
  const hostApplyMajority = () => {
    if (!isHost) return;
    for (const stepIdx of [0, 1, 2]) {
      if (
        state.swaps[stepIdx] == null &&
        vetoMajority(vetoCount(stepIdx), state.members.length)
      ) {
        ch.send({
          type: "broadcast",
          event: "swap",
          payload: { stepIdx, altIdx: 0 },
        });
      }
    }
  };

  return { sb, ch, state, member, sendReact, vetoCount, hostApplyMajority };
}

function subscribed(d: ReturnType<typeof makeDevice>) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("subscribe timeout")), 10_000);
    d.ch.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(t);
        void d.ch.track(d.member);
        resolve();
      }
    });
  });
}

let failed = false;
const check = (label: string, ok: boolean) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failed = true;
};

async function main() {
  console.log(`\nRoom ${CODE} on ${new URL(SUPABASE_URL).host}\n`);
  const A = makeDevice({ id: "A", name: "Ana", color: "hsl(1)" }, true); // host
  const B = makeDevice({ id: "B", name: "Ben", color: "hsl(2)" }, false);
  const C = makeDevice({ id: "C", name: "Cat", color: "hsl(3)" }, false);
  const D = makeDevice({ id: "D", name: "Dee", color: "hsl(4)" }, false);
  const all = [A, B, C, D];

  await Promise.all(all.map(subscribed));
  await sleep(3000); // let presence converge across all four clients
  console.log("Four devices joined the room (majority = 3).");
  check(
    "all devices see 4 members",
    all.every((d) => d.state.members.length === 4),
  );

  // Round 1 — Ben + Cat veto stop 0. Two of four is NOT a majority: no swap.
  console.log("\nBen and Cat swipe stop 0 to Change (veto) → 2 of 4…");
  await B.sendReact(0, "veto");
  await C.sendReact(0, "veto");
  await sleep(800);
  A.hostApplyMajority();
  await sleep(600);
  check(
    "every device received both vetoes",
    all.every((d) => d.vetoCount(0) === 2),
  );
  check(
    "2 of 4 is not a majority → stop 0 not swapped anywhere",
    all.every((d) => d.state.swaps[0] == null),
  );

  // Round 2 — Dee also vetoes stop 0. Now 3 of 4 = majority → host swaps.
  console.log("\nDee also swipes stop 0 to Change → 3 of 4 = majority…");
  await D.sendReact(0, "veto");
  await sleep(800);
  A.hostApplyMajority();
  await sleep(800);
  check(
    "majority veto → the swap propagated to Ben, Cat AND Dee",
    B.state.swaps[0] === 0 && C.state.swaps[0] === 0 && D.state.swaps[0] === 0,
  );
  check(
    "the swapped stop's votes reset on every device",
    all.every((d) => d.vetoCount(0) === 0),
  );

  // Round 3 — a departed voter's veto must stop counting. Ben + Cat veto stop 1
  // (2/4, no majority). Cat then LEAVES. Her vote must no longer count, so it
  // stays 1 live veto of 3 → still not a majority → stop 1 must NOT swap (a leave
  // can't silently swap a stop nobody living re-vetoed).
  console.log("\nBen + Cat veto stop 1 (2 of 4), then Cat leaves the room…");
  await B.sendReact(1, "veto");
  await C.sendReact(1, "veto");
  await sleep(800);
  A.hostApplyMajority();
  await sleep(400);
  check("2 of 4 on stop 1 → not yet swapped", A.state.swaps[1] == null);
  await C.ch.untrack();
  await C.sb.removeChannel(C.ch); // Cat leaves
  await sleep(5000); // presence leave detection → Cat no longer counted
  A.hostApplyMajority();
  await sleep(700);
  check("after Cat leaves, host sees 3 members", A.state.members.length === 3);
  check(
    "Cat's veto no longer counts → 1 live veto, not a majority of 3",
    A.vetoCount(1) === 1,
  );
  check(
    "a leave did NOT swap stop 1",
    A.state.swaps[1] == null && B.state.swaps[1] == null,
  );

  await Promise.all([A, B, D].map((d) => d.sb.removeChannel(d.ch)));
  console.log(`\n${failed ? "SOME CHECKS FAILED" : "ALL CHECKS PASSED"}\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error("proof harness error:", e);
  process.exit(1);
});
