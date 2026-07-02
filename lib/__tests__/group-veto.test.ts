import { describe, it, expect } from "vitest";
import { vetoMajority } from "@/lib/group-veto";

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
