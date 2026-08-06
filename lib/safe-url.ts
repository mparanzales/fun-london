// Keep catalogue-sourced URLs from reaching an href as anything but the web.
//
// Venue websites and menus, booking links, ticket links, editorial-source and
// creator-coverage links, admin candidate/prospect/pop-up links: every one of
// them arrives from an ingestion cron or a bulk CSV import. They are catalogue
// DATA, not code, so their scheme is attacker-controlled. A stored
// "javascript:..." rendered into an href executes in the funldn.com origin, on
// the user's own tap, with the user's session.
//
// PR #226 established the rule inside buildReserveUrl (http(s) or nothing).
// This is that same rule hoisted out so every sink shares ONE definition
// instead of each one re-deciding. lib/safe-redirect.ts is the internal
// sibling: that keeps ?return= on our origin, this keeps outbound hrefs on
// real web schemes.
//
// Deliberately an ALLOWLIST. A denylist of "javascript:, data:, vbscript:" is
// one novel scheme away from being wrong, and it has to out-guess the parser:
// the WHATWG parser folds scheme case and strips tabs, newlines and leading
// whitespace before we ever see `protocol`, so "Java\nScript:alert(1)" arrives
// at this check already normalised to "javascript:" and is rejected by the
// same two-entry set that rejects the plain spelling.

const WEB_SCHEMES = new Set(["http:", "https:"]);

// The rule, once. Returns a parsed URL only for real web schemes.
export function parseExternalUrl(raw: string | null | undefined): URL | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    // Relative ("/menu") or bare ("www.example.com"). Deliberately NOT
    // upgraded to https by guessing a scheme: that would invent a
    // destination we were never given. A bare host is already broken today
    // anyway, since the browser resolves it against funldn.com.
    return null;
  }
  if (!WEB_SCHEMES.has(u.protocol)) return null;
  // Strip any userinfo. "https://ticketmaster.com@evil.com/x" is a valid https
  // URL to evil.com that READS as ticketmaster.com to a person glancing at the
  // status bar, which is the whole phishing trick. No legitimate catalogue URL
  // carries credentials, so dropping them costs nothing and removes the
  // disguise. (providerFromUrl already reads `hostname`, so it correctly
  // refuses to label such a link, but that is one consumer, not a guarantee.)
  u.username = "";
  u.password = "";
  return u;
}

// Sink guard: the value to put in an href, or null to render no link at all.
// Callers must treat null as "drop the anchor" rather than falling back to the
// raw string, which is the whole point. No link beats a live sink.
export function safeExternalHref(
  raw: string | null | undefined,
): string | null {
  // The PARSED serialisation, never the caller's original string, so the value
  // we validated is the exact value that reaches the DOM. Nothing the parser
  // normalised away can sneak back in through a re-parse difference.
  return parseExternalUrl(raw)?.toString() ?? null;
}
