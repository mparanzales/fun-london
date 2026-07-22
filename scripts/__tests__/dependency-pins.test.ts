import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "node:url";

// Guard: the CVE pins in package.json "pnpm.overrides" must actually reach the
// lockfile.
//
// WHY THIS EXISTS. Those overrides are the only thing keeping four patched
// versions in the tree, and they fail SILENTLY. pnpm already prints:
//
//   [WARN] The "pnpm" field in package.json is no longer read by pnpm.
//          The following keys were ignored: "pnpm.overrides".
//
// It works today because the committed lockfile encodes the resolutions and CI
// installs --frozen-lockfile. But regenerate that lockfile with a pnpm that
// honours the warning and every pin vanishes with no error, no failing build,
// and no signal until Dependabot notices days later.
//
// Measured, not assumed (2026-07-22): moving the overrides to
// pnpm-workspace.yaml under pnpm 9 brought back sharp 0.34.5 (vulnerable) and
// dropped js-yaml to 4.3.0. Do NOT migrate them there until pnpm is upgraded
// and this test still passes afterwards. That is exactly what it is for.
//
// This reads the LOCKFILE, not package.json, because the lockfile is what CI
// and Vercel install.

const LOCK = readFileSync(
  fileURLToPath(new URL("../../pnpm-lock.yaml", import.meta.url)),
  "utf8",
);

// Escape every regex metacharacter, not just a hand-picked few. The package
// names below are hardcoded and metacharacter-free, so this is not a live
// hole, but a partial escape is a bug waiting for the first scoped name with a
// "." or "+" in it.
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

// Every version of `name` that appears as a resolved package in the lockfile.
function lockedVersions(name: string): string[] {
  const re = new RegExp(`^\\s{2}${escapeRegExp(name)}@([^:\\s(]+)`, "gm");
  const out = new Set<string>();
  for (const m of LOCK.matchAll(re)) out.add(m[1]);
  return [...out];
}

// Numeric semver compare, enough for the x.y.z tags npm publishes.
function lt(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0);
  }
  return false;
}

// package, first patched version, advisory. A resolved version below the
// floor (within the same major.minor line, where the advisory applies) fails.
const PINS: { name: string; floor: string; note: string }[] = [
  { name: "sharp", floor: "0.35.0", note: "libvips CVE-2026-33327/-33328/-35590/-35591 (HIGH)" },
  { name: "dompurify", floor: "3.4.12", note: "CUSTOM_ELEMENT_HANDLING bypass (LOW)" },
  { name: "js-yaml", floor: "5.2.1", note: "quadratic-complexity DoS via !!omap (MODERATE)" },
];

describe("CVE pins survive into the lockfile", () => {
  it.each(PINS)("$name is at or above $floor", ({ name, floor, note }) => {
    const found = lockedVersions(name);
    expect(found.length, `${name} not found in pnpm-lock.yaml`).toBeGreaterThan(0);
    const vulnerable = found.filter((v) => lt(v, floor));
    expect(
      vulnerable,
      `${name} ${vulnerable.join(", ")} is below ${floor} — ${note}. ` +
        `The pnpm.overrides in package.json did not reach the lockfile. ` +
        `Do NOT "fix" this by deleting the pin.`,
    ).toEqual([]);
  });

  // brace-expansion ships two live majors (1.x and 5.x) with separate
  // advisories, so it needs a floor per line rather than one global floor.
  it("brace-expansion is patched on every major line present", () => {
    const found = lockedVersions("brace-expansion");
    expect(found.length).toBeGreaterThan(0);
    const bad = found.filter((v) => {
      if (v.startsWith("1.")) return lt(v, "1.1.16");
      if (v.startsWith("5.")) return lt(v, "5.0.7");
      return false;
    });
    expect(
      bad,
      `brace-expansion ${bad.join(", ")} is vulnerable (HIGH, DoS via ` +
        `exponential-time expansion). Needs >=1.1.16 on 1.x and >=5.0.7 on 5.x.`,
    ).toEqual([]);
  });

  it("the overrides block still exists in package.json", () => {
    const pkg = JSON.parse(
      readFileSync(
        fileURLToPath(new URL("../../package.json", import.meta.url)),
        "utf8",
      ),
    );
    // If this ever fails, the pins were deleted rather than migrated. Read the
    // header of this file before touching it.
    expect(pkg.pnpm?.overrides).toBeTruthy();
    expect(Object.keys(pkg.pnpm.overrides).length).toBeGreaterThan(0);
  });
});
