// Guard against open-redirects via the ?return= param.
//
// Sign-in carries a `?return=/somewhere` so we can send the user back to where
// they were headed. Without validation, `?return=//evil.com` (or `/\evil.com`,
// which browsers normalise to `//evil.com`) produces a protocol-relative
// redirect OFF our origin — a phishing vector. This only lets through
// site-internal absolute paths; anything else falls back to a safe default.

export function safeReturnPath(
  raw: string | null | undefined,
  fallback = "/explore",
): string {
  if (typeof raw !== "string" || raw.length === 0) return fallback;
  // Must be a single-slash absolute path on THIS site.
  if (!raw.startsWith("/")) return fallback;
  // Reject protocol-relative ("//host") and backslash tricks ("/\host",
  // "\\host") that browsers re-interpret as a new host.
  if (raw.startsWith("//") || raw.startsWith("/\\") || raw.startsWith("\\")) {
    return fallback;
  }
  return raw;
}
