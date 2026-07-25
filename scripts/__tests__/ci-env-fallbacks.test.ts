import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "fs";
import { fileURLToPath } from "node:url";

// Guard: any env var a workflow feeds from `${{ secrets.X }}` must be defaulted
// with `||`, never `??`.
//
// WHY THIS EXISTS. GitHub Actions does not omit an env var whose secret is
// missing. It sets it to an EMPTY STRING. `??` only falls back on
// null/undefined, so `process.env.X ?? "default"` yields "" and the default
// never fires. There is no warning, no error, and nothing to see in the
// provider's dashboard.
//
// Measured, not assumed (2026-07-25): weekly-digest.yml mapped
// `EMAIL_FROM: ${{ secrets.EMAIL_FROM }}`, that secret has never existed, and
// send-weekly-digest.ts used `??`. Every weekly digest for 9 weeks posted
// `from: ""` to Resend and was rejected 422 "The domain is invalid", while the
// job still reported success. Two real opted in subscribers got nothing. The
// Resend domain and API key were both correct the whole time, which is exactly
// why it survived a manual review of both.
//
// The same file had a second instance: NEXT_PUBLIC_SITE_URL, also not a secret,
// which would have made every link in the email body relative and broken.

const root = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));

function readDir(dir: string, ext: string): string[] {
  if (!existsSync(root(dir))) return [];
  return readdirSync(root(dir))
    .filter((f) => f.endsWith(ext))
    .map((f) => `${dir}/${f}`);
}

/** Env var names that a workflow populates from a repo secret. */
function secretBackedEnvNames(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of readDir(".github/workflows", ".yml")) {
    const text = readFileSync(root(file), "utf8");
    // Matches:   SOME_NAME: ${{ secrets.SOME_NAME }}
    const re = /^\s*([A-Z][A-Z0-9_]*)\s*:\s*\$\{\{\s*secrets\./gm;
    for (const m of text.matchAll(re)) {
      const name = m[1];
      found.set(name, [...(found.get(name) ?? []), file]);
    }
  }
  return found;
}

const SOURCE_FILES = [...readDir("scripts", ".ts"), ...readDir("lib", ".ts")];

describe("CI env fallbacks", () => {
  it("finds the workflow secret mappings it is meant to police", () => {
    // Sanity check: if this ever hits 0 the regex broke and the whole test
    // would pass vacuously.
    expect(secretBackedEnvNames().size).toBeGreaterThan(3);
  });

  it("never defaults a secret-backed env var with ?? (empty string defeats it)", () => {
    const names = secretBackedEnvNames();
    const offences: string[] = [];

    for (const file of SOURCE_FILES) {
      const text = readFileSync(root(file), "utf8");
      for (const [name, workflows] of names) {
        // Capture the default so an empty-string default can be excused:
        // `?? ""` and `|| ""` behave identically, so only a NON-EMPTY default
        // is actually defeated by the empty string.
        const re = new RegExp(
          `process\\.env\\.${name}\\s*\\?\\?\\s*([^;,)\\n]+)`,
          "g",
        );
        for (const m of text.matchAll(re)) {
          const fallback = m[1].trim();
          if (fallback === '""' || fallback === "''") continue;
          offences.push(
            `${file} uses \`process.env.${name} ?? ${fallback}\`, but ` +
              `${[...new Set(workflows)].join(", ")} sets ${name} from a ` +
              `secret. If that secret is absent the value is "" and the ` +
              `default is skipped. Use \`||\`.`,
          );
        }
      }
    }

    expect(offences).toEqual([]);
  });
});
