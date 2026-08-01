import { describe, it, expect } from "vitest";
import { nextInCycle } from "@/lib/plan-cycle";

/**
 * The "Change" rotation. These exist because the decision they cover used to
 * live inside a React handler, where this suite cannot reach it — and a guard
 * in that handler shipped inert for eight commits with everything green.
 */
const v = (id: string) => ({ id });
const A = v("A"); // the stop's original, prepended once it has been replaced
const B = v("B");
const C = v("C");
const D = v("D");

describe("nextInCycle", () => {
  it("returns null for an empty list rather than throwing", () => {
    expect(nextInCycle([], [], 1)).toBeNull();
  });

  it("offers the best option first", () => {
    expect(nextInCycle([B, C, D], [], 1)?.picked.id).toBe("B");
  });

  it("🧨 reaches EVERY option before repeating any", () => {
    // The defect this replaces: an index into a list that is rebuilt each tap
    // skipped an option permanently. With four candidates the old model ran
    // A,B,C,D,A,C,D,A — B unreachable however long the user tapped.
    const list = [A, B, C, D];
    let visited: string[] = [];
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = nextInCycle(list, visited, 1);
      expect(r).not.toBeNull();
      visited = r!.visited;
      seen.push(r!.picked.id);
    }
    expect([...seen].sort()).toEqual(["A", "B", "C", "D"]);
    expect(new Set(seen).size).toBe(4); // no repeats inside one rotation
  });

  it("🧨 wraps to a fresh rotation instead of stalling", () => {
    const list = [B, C];
    const first = nextInCycle(list, [], 1)!;
    const second = nextInCycle(list, first.visited, 1)!;
    // Both shown; the next tap must still return something, and must reset the
    // history rather than accumulate it forever.
    const third = nextInCycle(list, second.visited, 1)!;
    expect(third.picked.id).toBe("B");
    expect(third.visited).toEqual(["B"]);
  });

  it("goes backwards from the other end, and also reaches everything", () => {
    const list = [B, C, D];
    let visited: string[] = [];
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = nextInCycle(list, visited, -1)!;
      visited = r.visited;
      seen.push(r.picked.id);
    }
    expect(seen).toEqual(["D", "C", "B"]);
  });

  it("never re-offers a venue already shown while unseen ones remain", () => {
    const list = [A, B, C, D];
    const r = nextInCycle(list, ["A", "C"], 1)!;
    expect(["B", "D"]).toContain(r.picked.id);
    expect(r.visited).toEqual(["A", "C", r.picked.id]);
  });

  it("🧨 a list that shrinks under it still rotates, and never stalls", () => {
    // Options are recomputed against the night's CURRENT stops, so the list
    // genuinely changes shape between taps. The rotation must not depend on it
    // staying the same length.
    let visited: string[] = [];
    const lists = [[A, B, C, D], [A, C, D], [C, D], [D]];
    for (const list of lists) {
      const r = nextInCycle(list, visited, 1);
      expect(r, `stalled on a list of ${list.length}`).not.toBeNull();
      visited = r!.visited;
    }
  });
});
