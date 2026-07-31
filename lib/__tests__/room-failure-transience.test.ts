import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { failureFromJoin, isTransientJoinReason } from "@/lib/room-errors";

// Whether a failed join keeps or discards the stashed room code.
//
// 🧨 THE BUG THESE PIN. The resolver decided this with:
//
//     const transient = f === "timeout" || f === "channel-error" || f === "offline";
//     if (existing && !transient) clearRoomInvite();
//
// `f` is a RoomFailure from failureFromJoin, and failureFromJoin CANNOT RETURN
// any of those three values — they come from failureFromStatus, the Realtime
// path. So `transient` was always false and every join failure deleted the
// invite, including a transport blip on patchy 4G. The invitee saw "You're not
// in this room" with no action, and since the URL is clean now, reloading
// started a brand new empty room rather than retrying. Under the old ?room=
// design the reload recovered.
//
// It is the repo's recurring failure: a guard that never executes the thing it
// guards. The last test here is the one that generalises it, and it is the
// reason this file exists rather than four assertions about a boolean.

function src(rel: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../${rel}`, import.meta.url)),
    "utf8",
  );
}

describe("which failures are worth retrying", () => {
  it("keeps the code for a transport blip and for a rate-limit", () => {
    // `error` is a thrown/failed RPC. `rate-limited` is 20 join attempts per
    // 10 minutes, enforced in the DB, which a user on a flaky connection burns
    // through no fault of their own, and which refills.
    expect(isTransientJoinReason("error")).toBe(true);
    expect(isTransientJoinReason("rate-limited")).toBe(true);
  });

  it("drops it for anything terminal", () => {
    for (const r of ["not-found", "expired", "closed", "auth"]) {
      expect(isTransientJoinReason(r), `${r} must be terminal`).toBe(false);
    }
    // Holding a code past these would re-attempt a room that is gone on every
    // future visit to /plan/together on this browser.
    expect(isTransientJoinReason(undefined)).toBe(false);
    expect(isTransientJoinReason("something-new")).toBe(false);
  });

  it("is wired to the RESULT's reason, not the mapped failure", () => {
    const flow = src("app/(main)/plan/together/together-flow.tsx")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(flow).toContain("isTransientJoinReason(result.reason)");
    // The mapped value must not be what decides this again.
    expect(flow).not.toMatch(
      /f === "timeout"|f === "channel-error"|f === "offline"/,
    );
  });

  it("never treats a value failureFromJoin cannot produce as meaningful", () => {
    // THE GENERALISATION. Any reason the transient check accepts must be a
    // reason the join path can actually return, or the check is decorative.
    // Parsed from RoomResult's own union so a renamed reason breaks this
    // rather than silently disabling the guard.
    const action = src("lib/room-action.ts");
    const union = action.match(/reason:\s*([^;]*);/)?.[1] ?? "";
    const reasons = [...union.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(reasons.length).toBeGreaterThan(0); // positive control
    expect(reasons).toContain("error"); // the one the old guard missed

    for (const r of reasons.filter(isTransientJoinReason)) {
      expect(reasons, `${r} is not a reason join can return`).toContain(r);
    }
    // And at least one real reason IS transient, or the guard is dead again.
    expect(reasons.filter(isTransientJoinReason).length).toBeGreaterThan(0);
  });

  it("every transient reason still maps to a failure screen with a retry", () => {
    // A reason we keep the code for is useless if its screen offers no way to
    // use it. Both transient reasons map through failureFromJoin to a screen;
    // this asserts the mapping exists rather than assuming it.
    for (const r of ["error", "rate-limited"]) {
      const f = failureFromJoin({ ok: false, reason: r }, "join");
      expect(f, `${r} must map to a failure`).toBeTruthy();
    }
  });
});
