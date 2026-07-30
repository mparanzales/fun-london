import { describe, it, expect } from "vitest";
import {
  HOST_STALE_MS,
  resolveHost,
  shouldClaimHost,
  type RosterEntry,
} from "./room-host";

const roster: RosterEntry[] = [
  { userId: "u-charlie", joinedAt: "2026-07-29T20:00:03.000Z" },
  { userId: "u-alice", joinedAt: "2026-07-29T20:00:01.000Z" },
  { userId: "u-bob", joinedAt: "2026-07-29T20:00:02.000Z" },
];

describe("host handoff", () => {
  it("picks the earliest-joined PRESENT member", () => {
    expect(resolveHost(roster, ["u-alice", "u-bob", "u-charlie"])).toBe(
      "u-alice",
    );
    // Alice gone → Bob, not Charlie.
    expect(resolveHost(roster, ["u-bob", "u-charlie"])).toBe("u-bob");
    expect(resolveHost(roster, ["u-charlie"])).toBe("u-charlie");
    expect(resolveHost(roster, [])).toBeNull();
  });

  it("is DETERMINISTIC across devices: same inputs in any order, same host", () => {
    const shuffles = [
      [roster[0], roster[1], roster[2]],
      [roster[2], roster[0], roster[1]],
      [roster[1], roster[2], roster[0]],
    ];
    const present = ["u-charlie", "u-bob"];
    const answers = shuffles.map((r) => resolveHost(r, present));
    expect(new Set(answers).size).toBe(1);
    expect(answers[0]).toBe("u-bob");
  });

  it("breaks a joined_at tie by user id, not by array order", () => {
    const tied: RosterEntry[] = [
      { userId: "u-zoe", joinedAt: "2026-07-29T20:00:00.000Z" },
      { userId: "u-adam", joinedAt: "2026-07-29T20:00:00.000Z" },
    ];
    expect(resolveHost(tied, ["u-zoe", "u-adam"])).toBe("u-adam");
    expect(resolveHost([...tied].reverse(), ["u-zoe", "u-adam"])).toBe(
      "u-adam",
    );
  });

  describe("shouldClaimHost: exactly one device asks", () => {
    const now = Date.parse("2026-07-29T21:00:00.000Z");
    const stale = new Date(now - HOST_STALE_MS - 1000).toISOString();
    const fresh = new Date(now - 1000).toISOString();

    it("no claim while the host is present", () => {
      expect(
        shouldClaimHost({
          roster,
          presentUserIds: ["u-alice", "u-bob"],
          hostUserId: "u-alice",
          hostSeenAt: fresh,
          myUserId: "u-bob",
          now,
        }),
      ).toBe(false);
    });

    it("no claim while the host's heartbeat is fresh (a quiet host is not a gone host)", () => {
      expect(
        shouldClaimHost({
          roster,
          presentUserIds: ["u-bob", "u-charlie"],
          hostUserId: "u-alice",
          hostSeenAt: fresh,
          myUserId: "u-bob",
          now,
        }),
      ).toBe(false);
    });

    it("the successor claims when the host is absent AND stale", () => {
      expect(
        shouldClaimHost({
          roster,
          presentUserIds: ["u-bob", "u-charlie"],
          hostUserId: "u-alice",
          hostSeenAt: stale,
          myUserId: "u-bob",
          now,
        }),
      ).toBe(true);
    });

    it("NON-successors stay quiet, so no multi-host race", () => {
      const claims = ["u-bob", "u-charlie"].filter((me) =>
        shouldClaimHost({
          roster,
          presentUserIds: ["u-bob", "u-charlie"],
          hostUserId: "u-alice",
          hostSeenAt: stale,
          myUserId: me,
          now,
        }),
      );
      expect(claims).toEqual(["u-bob"]);
    });
  });
});
