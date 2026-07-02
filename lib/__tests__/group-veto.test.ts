import { describe, it, expect } from "vitest";
import { vetoMajority, pruneReactions, countReactions } from "@/lib/group-veto";

describe("vetoMajority · a stop swaps only on a strict group majority", () => {
  it("no vetoes never swaps", () => {
    expect(vetoMajority(0, 3)).toBe(false);
    expect(vetoMajority(0, 1)).toBe(false);
  });

  it("a pair needs both to veto (one can't override)", () => {
    expect(vetoMajority(1, 2)).toBe(false);
    expect(vetoMajority(2, 2)).toBe(true);
  });

  it("three need two; one is not a majority", () => {
    expect(vetoMajority(1, 3)).toBe(false);
    expect(vetoMajority(2, 3)).toBe(true);
  });

  it("four need three (exactly half is not enough)", () => {
    expect(vetoMajority(2, 4)).toBe(false);
    expect(vetoMajority(3, 4)).toBe(true);
  });

  it("a lone member passes on their own veto", () => {
    expect(vetoMajority(1, 1)).toBe(true);
  });

  it("an empty group never swaps", () => {
    expect(vetoMajority(0, 0)).toBe(false);
    expect(vetoMajority(1, 0)).toBe(false);
  });
});

describe("countReactions · counts only members still present", () => {
  it("counts the value for present members", () => {
    const present = new Set(["a", "b", "c"]);
    expect(
      countReactions({ a: "veto", b: "veto", c: "keep" }, "veto", present),
    ).toBe(2);
  });

  it("ignores a lingering vote from a member who has left (race-proof)", () => {
    // c already left; its stale veto must not count toward the majority.
    const present = new Set(["a", "b"]);
    expect(
      countReactions({ a: "veto", b: "keep", c: "veto" }, "veto", present),
    ).toBe(1);
  });

  it("returns 0 for an absent stop", () => {
    expect(countReactions(undefined, "veto", new Set(["a"]))).toBe(0);
  });
});

describe("pruneReactions · a departed member's vote stops counting", () => {
  const live = new Set(["a", "b"]);

  it("drops reactions from members no longer present", () => {
    const reactions = { 0: { a: "veto", c: "veto" }, 1: { b: "keep" } };
    expect(pruneReactions(reactions, live)).toEqual({
      0: { a: "veto" },
      1: { b: "keep" },
    });
  });

  it("drops a stop entirely once all its voters have left", () => {
    const reactions = { 0: { c: "veto", d: "veto" }, 1: { a: "keep" } };
    expect(pruneReactions(reactions, live)).toEqual({ 1: { a: "keep" } });
  });

  it("a departure that leaves 2/4 → 2/3 vetoes: pruning keeps it at 2 (no false majority)", () => {
    // b and c vetoed; d (a non-voter) leaves → still just b + c present-or-not.
    const reactions = { 0: { b: "veto", c: "veto" } };
    // c also left; only b remains → 1 veto, not a majority of the live pair.
    const pruned = pruneReactions(reactions, new Set(["a", "b"]));
    expect(Object.values(pruned[0] ?? {}).filter((v) => v === "veto")).toEqual([
      "veto",
    ]);
  });

  it("returns the SAME reference when nothing is pruned (no needless re-render)", () => {
    const reactions = { 0: { a: "veto" }, 1: { b: "keep" } };
    expect(pruneReactions(reactions, live)).toBe(reactions);
  });
});
