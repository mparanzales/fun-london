import { describe, it, expect } from "vitest";
import {
  acceptsPayload,
  filterPresence,
  type RosterGuard,
} from "./room-roster";
import {
  failureFromJoin,
  failureFromStatus,
  ROOM_FAILURE_COPY,
} from "./room-errors";

const guard: RosterGuard = {
  memberIds: new Set(["u-me", "u-alice", "u-bob"]),
  myUserId: "u-me",
};

describe("roster-gated payloads (vote forgery)", () => {
  it("accepts a real member's payload", () => {
    expect(acceptsPayload(guard, "u-alice")).toBe(true);
  });

  it("🧨 REJECTS an invented member, so the majority cannot be inflated", () => {
    // The old model: any client could mint crypto.randomUUID() ids and send
    // N votes under N fake members to force a veto majority.
    expect(acceptsPayload(guard, "u-ghost")).toBe(false);
    expect(acceptsPayload(guard, crypto.randomUUID())).toBe(false);
    const forged = Array.from({ length: 10 }, () => crypto.randomUUID());
    expect(forged.filter((id) => acceptsPayload(guard, id))).toEqual([]);
  });

  it("rejects a payload claiming to be ME that I did not send", () => {
    // selfEcho is the answer to "did I send this?", NOT "is it stamped with
    // my id?" — the call sites now track outbound keys, so this is a real
    // check rather than the vacuous one review caught.
    expect(acceptsPayload(guard, "u-me", false)).toBe(false);
    expect(acceptsPayload(guard, "u-me", true)).toBe(true);
  });

  it("rejects malformed member ids", () => {
    expect(acceptsPayload(guard, undefined)).toBe(false);
    expect(acceptsPayload(guard, null)).toBe(false);
    expect(acceptsPayload(guard, 42)).toBe(false);
    expect(acceptsPayload(guard, "")).toBe(false);
    expect(acceptsPayload(guard, { id: "u-alice" })).toBe(false);
  });

  it("drops presence entries that are not on the server-owned roster", () => {
    const present = [
      { id: "u-alice", name: "Alice" },
      { id: "u-ghost", name: "Ghost" },
      { id: "u-bob", name: "Bob" },
      { id: "u-alice", name: "Alice again" }, // duplicate
    ];
    expect(filterPresence(guard, present).map((p) => p.id)).toEqual([
      "u-alice",
      "u-bob",
    ]);
  });
});

describe("subscription failure mapping", () => {
  it("maps every terminal Realtime status to an honest state", () => {
    expect(failureFromStatus("SUBSCRIBED")).toBeNull();
    expect(failureFromStatus("TIMED_OUT")).toBe("timeout");
    expect(failureFromStatus("CHANNEL_ERROR")).toBe("channel-error");
    expect(failureFromStatus("CLOSED")).toBe("offline");
  });

  it("separates create-path throttling from join denial", () => {
    // Telling someone STARTING a room to "ask for the link again" was the
    // pre-review behaviour.
    expect(
      failureFromJoin({ ok: false, reason: "rate-limited" }, "create"),
    ).toBe("too-many-rooms");
    expect(failureFromJoin({ ok: false, reason: "rate-limited" }, "join")).toBe(
      "denied",
    );
  });

  it("maps join outcomes, including expiry and closure", () => {
    expect(failureFromJoin({ ok: true })).toBeNull();
    expect(failureFromJoin({ ok: false, reason: "expired" })).toBe("expired");
    expect(failureFromJoin({ ok: false, reason: "closed" })).toBe("closed");
    expect(failureFromJoin({ ok: false, reason: "not-found" })).toBe(
      "not-found",
    );
    expect(failureFromJoin({ ok: false, reason: "rate-limited" })).toBe(
      "denied",
    );
    expect(failureFromJoin({ ok: false, reason: "auth" })).toBe("auth");
    expect(failureFromJoin(null)).toBe("denied");
  });

  it("every failure has copy, and the copy never blames or leaks", () => {
    for (const [state, copy] of Object.entries(ROOM_FAILURE_COPY)) {
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.body.length).toBeGreaterThan(0);
      // No stack traces, no error codes, no "you did something wrong".
      expect(copy.body).not.toMatch(/error code|failed with|invalid input/i);
      expect(`${state}: ${copy.title}`).not.toMatch(/undefined|null/);
    }
  });
});
