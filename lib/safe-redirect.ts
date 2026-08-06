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
  let u: URL;
  try {
    u = new URL(raw, PROBE_ORIGIN);
  } catch {
    return fallback;
  }
  if (u.origin !== PROBE_ORIGIN) return fallback;
  // Hand back the NORMALISED path, so what we validated is what the caller
  // redirects to. Callers include a bare next/navigation redirect(), where the
  // raw string would reach a Location header with its control chars intact.
  return u.pathname + u.search + u.hash;
}
