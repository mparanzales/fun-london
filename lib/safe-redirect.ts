// Guard against open-redirects via the ?return= param.
//
// Sign-in carries a `?return=/somewhere` so we can send the user back to where
// they were headed. Without validation, `?return=//evil.com` (or `/\evil.com`,
// which browsers normalise to `//evil.com`) produces a protocol-relative
// redirect OFF our origin — a phishing vector. This only lets through
// site-internal absolute paths; anything else falls back to a safe default.

// Resolved against, so we can ask the PARSER whether a path stays on our
// origin instead of asking the string. Any origin works; .invalid is reserved
// by RFC 2606 and can never be registered.
const PROBE_ORIGIN = "https://fun-london.invalid";

export function safeReturnPath(
  raw: string | null | undefined,
  fallback = "/explore",
): string {
  if (typeof raw !== "string" || raw.length === 0) return fallback;
  // Must be a single-slash absolute path on THIS site.
  if (!raw.startsWith("/")) return fallback;
  // 🧨 Prefix tests alone are not enough. This used to reject "//host",
  // "/\host" and "\host" with startsWith and nothing else, but the URL parser
  // strips tabs, newlines and carriage returns as it resolves: "/\t/evil.com"
  // passed all three checks and then resolved to the protocol-relative
  // "//evil.com". Verified.
  //
  // So resolve it, then require the result to still be on the origin we
  // resolved against. Same move as lib/safe-url.ts, which allowlists the
  // scheme rather than trying to name every bad one.
  const u = resolve(raw);
  if (!u || u.origin !== PROBE_ORIGIN) return fallback;
  // Hand back the NORMALISED path, so what we validated is what the caller
  // redirects to. Callers include a bare next/navigation redirect(), where the
  // raw string would reach a Location header with its control chars intact.
  const path = u.pathname + u.search + u.hash;
  // 🧨 Then re-check the value we are about to RETURN, resolved the way a
  // browser resolves an href rather than concatenated onto our origin.
  // Normalisation can turn a same-origin input into a protocol-relative one:
  // "/venue/..//evil.com" pops "venue", keeps the empty segment, and
  // serialises to "//evil.com" -- while u.origin is still the probe origin,
  // because a path-relative resolve can never change the host. So the check
  // above cannot see it. Verified; "/%2e%2e//evil.com" and "/a/../\/evil.com"
  // do the same thing.
  //
  // This second resolve can THROW where the first did not: the same
  // normalisation that manufactures the leading "//" also promotes whatever
  // follows into an authority, and "/a/..//[" becomes "//[", an unterminated
  // IPv6 literal. Verified, along with "//x:99999" (port out of range) and
  // "//a b" (forbidden host code point). Uncaught, that is a 500 on /sign-in
  // and /auth/callback, both public and both reachable by URL alone, so both
  // parses go through the same throw-safe helper.
  const out = resolve(path);
  if (!out || out.origin !== PROBE_ORIGIN) return fallback;
  return path;
}

function resolve(value: string): URL | null {
  try {
    return new URL(value, PROBE_ORIGIN);
  } catch {
    return null;
  }
}
