/**
 * The predicates that decide which database a script is allowed to touch, and
 * how it names that database in its own output.
 *
 * They live in their own module for one reason: `staging-room-security-suite.ts`
 * calls `main()` at import time, so a test importing it would run the whole
 * live suite. Grepping the suite's source text for these rules — which is what
 * the guard tests did before — pins the spelling, not the behaviour, and a
 * guard whose test cannot fail is exactly the class of defect this track keeps
 * finding.
 */

/** Known production project refs. Nothing here may ever be a target. */
export const PRODUCTION_REFS = ["fxfuzabrivuianfwdopc"];

/**
 * Every account the harness creates matches this shape, and nothing else may.
 * It is the "is anybody real in here?" guard (teardown itself deletes by user
 * id, not by this pattern) —
 * `.invalid` is unroutable by RFC 2606, so these can never reach a person.
 */
export const FIXTURE_EMAIL = /^fl-staging-[a-z]-\d+-\d+@example\.invalid$/;

/**
 * True only for a genuine loopback host.
 *
 * A local CLI stack is safe by construction — nothing hosted answers on
 * 127.0.0.1 — but this must be decided by PARSING the URL. A substring test
 * would accept `http://127.0.0.1.attacker.example/`, whose host is not
 * loopback at all, and `http://user@127.0.0.1@evil.com/`, whose host is
 * `evil.com`.
 */
export function isLoopback(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
  } catch {
    return false;
  }
}

/**
 * The project ref a Supabase JWT key claims for itself.
 *
 * A legacy key's payload carries {"iss":"supabase","ref":"<project-ref>"}, so
 * the key names its own project — better than trusting an operator-supplied
 * string, because a custom domain or a mislabelled env var cannot hide it.
 * Returns null for opaque `sb_secret_…` keys and for anything unparseable.
 */
export function refFromKey(key: string): string | null {
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
