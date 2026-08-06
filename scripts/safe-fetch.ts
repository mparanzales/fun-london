// Keep catalogue-sourced URLs from reaching a SERVER-SIDE fetch as anything
// but a public web address.
//
// lib/safe-url.ts (PR #228) is the browser-side half of this rule: it keeps
// catalogue URLs out of hrefs, where the danger is the user's own tap in the
// funldn.com origin. This is the server-side half, where the danger is
// different in kind: our process sits inside the machine, so a stored URL
// pointed at 127.0.0.1 or 169.254.169.254 makes US the attacker's HTTP client
// against our own loopback and our own cloud metadata service — with whatever
// the runtime already trusts us to reach.
//
// The scheme rule is NOT re-decided here. parseExternalUrl is imported so
// there is exactly one definition of "a real web URL" in the codebase, and so
// this half inherits its normalisation for free (case folding, embedded
// tabs/newlines, userinfo stripping). What this file adds on top is the part
// an href never needed: WHERE the URL points.
//
// Lives in scripts/ rather than lib/ on purpose. Every consumer is a cron or
// backfill script, and this module imports node:dns and node:net — no other
// file in lib/ imports a Node builtin, and putting one there would make a
// bundler-safe directory conditionally bundler-unsafe.
//
// Threat model, concretely. venues.img_url, venues.website_url,
// editorial_sources[].url, creator_coverage[].url and events.source_url are
// all written by ingestion crons and bulk CSV import. They are catalogue DATA,
// not code — the same trust level as a venue name. A row reading
//
//   http://169.254.169.254/latest/meta-data/iam/security-credentials/
//   http://127.0.0.1:54321/rest/v1/venues
//
// is a request we will happily make, and in backfill-photos the RESPONSE BODY
// was then uploaded to a public storage bucket and its public URL written back
// onto the venue row. That is not just SSRF; it is SSRF with a delivery
// mechanism.

import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { parseExternalUrl } from "@/lib/safe-url";

// "We refuse this destination" — a judgement about the URL itself. Callers
// treat this as a signal about the DATA: a catalogue row is pointing somewhere
// it should not, which is worth shouting about.
//
// Deliberately NOT used for DNS failures or a too-long redirect chain. Those
// are transport conditions, and an earlier version threw this class for them
// too — which made backfill-photos print a "🚨 a row is poisoned" banner when
// the real problem was flaky home wifi, and made discover-menus skip the retry
// that used to cover a transient resolver blip. A security alarm that fires on
// a bad network is an alarm people learn to ignore.
export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedUrlError";
  }
}

export type SafeFetchOptions = {
  // Exact hostnames the FIRST url is allowed to name. Compared against the
  // PARSED hostname, never against the raw string: a prefix test like
  // url.startsWith("https://img.funldn.com") also accepts
  // "https://img.funldn.com.evil.test/x", which is a different site.
  //
  // Named "initial" because it stops applying after hop 1, and that is load
  // bearing rather than an oversight: Google's Places photo endpoint answers
  // with a 302 to a googleusercontent CDN host, so pinning every hop to the
  // allowlist would mirror exactly zero photos. Later hops still have to be
  // public http(s), which is what actually closes the SSRF — the allowlist is
  // about which service we start talking to, not about where its own CDN
  // lives. See the redirect test that pins both halves of this.
  allowInitialHosts?: readonly string[];
  // Redirects are followed manually so every hop is re-checked. 0 = refuse to
  // follow any redirect at all. The default is generous enough for the
  // ordinary http → https → www → trailing-slash → locale chain that real
  // publisher sites serve; fetch's own default is 20.
  maxRedirects?: number;
};

// ── Address classification ──────────────────────────────────────────────
//
// IPv4 enumerates the reserved blocks; IPv6 allowlists global unicast instead
// (see the comment on isPublicIPv6 for why the two differ). The v4 space is
// small enough, and IANA's special-purpose registry stable enough, that the
// table below is checkable by reading it. The v6 space is not.

function isPublicIPv4(b: readonly number[]): boolean {
  const [a, c, d] = b;
  if (a === 0) return false; // 0.0.0.0/8 — "this network"; 0.0.0.0 hits localhost on Linux
  if (a === 10) return false; // 10/8 private
  if (a === 127) return false; // 127/8 loopback
  if (a === 100 && c >= 64 && c <= 127) return false; // 100.64/10 CGNAT
  if (a === 169 && c === 254) return false; // 169.254/16 link-local — cloud metadata lives here
  if (a === 172 && c >= 16 && c <= 31) return false; // 172.16/12 private
  if (a === 192 && c === 0 && d === 0) return false; // 192.0.0/24 IETF protocol assignments
  if (a === 192 && c === 0 && d === 2) return false; // 192.0.2/24 TEST-NET-1
  if (a === 192 && c === 168) return false; // 192.168/16 private
  if (a === 198 && (c === 18 || c === 19)) return false; // 198.18/15 benchmarking
  if (a === 198 && c === 51 && d === 100) return false; // 198.51.100/24 TEST-NET-2
  if (a === 203 && c === 0 && d === 113) return false; // 203.0.113/24 TEST-NET-3
  if (a >= 224) return false; // 224/4 multicast + 240/4 reserved + 255.255.255.255
  return true;
}

// Expand any valid IPv6 textual form to its 16 bytes. Needed because the URL
// parser's normalisation is not a string we can pattern-match: it rewrites
// "[::ffff:169.254.169.254]" to "::ffff:a9fe:a9fe", so a check looking for
// "::ffff:" followed by dotted quad sees nothing and waves it through.
function ipv6ToBytes(addr: string): number[] | null {
  let s = addr;
  // A trailing dotted quad ("::ffff:127.0.0.1") — fold it into two hextets so
  // the rest of the parse only deals with hex groups.
  const embedded = s.match(/^(.*:)((?:\d{1,3}\.){3}\d{1,3})$/);
  if (embedded) {
    const q = embedded[2].split(".").map(Number);
    if (q.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    s =
      embedded[1] +
      (((q[0] << 8) | q[1]) >>> 0).toString(16) +
      ":" +
      (((q[2] << 8) | q[3]) >>> 0).toString(16);
  }

  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  // No "::" means every group must be written out.
  if (halves.length === 1 && missing !== 0) return null;
  if (missing < 0) return null;
  const groups = [
    ...head,
    ...(halves.length === 2 ? Array<string>(missing).fill("0") : []),
    ...tail,
  ];
  if (groups.length !== 8) return null;

  const bytes: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    const n = parseInt(g, 16);
    bytes.push((n >> 8) & 0xff, n & 0xff);
  }
  return bytes;
}

// IPv6, as an ALLOWLIST — the shape lib/safe-url.ts uses, and for the same
// reason. A first version of this enumerated the reserved prefixes instead,
// and review found four families it had missed (::/96 IPv4-compatible,
// ::ffff:0:0:0/96 IPv4-translated, fec0::/10 site-local, 2001:db8::/32), each
// of which came out judged PUBLIC. Enumerating what is forbidden means being
// right about all of it forever; enumerating what is permitted means being
// right once. Only 2000::/3 global unicast is routable on the public internet,
// so that is the gate, and the carve-outs inside it are subtracted explicitly.
function isPublicIPv6(b: readonly number[]): boolean {
  const zeros = (from: number, to: number) =>
    b.slice(from, to).every((x) => x === 0);

  // Forms that CARRY an IPv4 address are judged on the address they carry —
  // before the 2000::/3 gate, since some of them sit outside it.
  if (zeros(0, 10) && b[10] === 0xff && b[11] === 0xff)
    return isPublicIPv4(b.slice(12)); // ::ffff:0:0/96 IPv4-mapped
  if (zeros(0, 12)) return isPublicIPv4(b.slice(12)); // ::/96 IPv4-compatible (incl. ::1, ::)
  if (zeros(0, 8) && b[8] === 0xff && b[9] === 0xff && zeros(10, 12))
    return isPublicIPv4(b.slice(12)); // ::ffff:0:0:0/96 IPv4-translated
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) {
    if (zeros(4, 12)) return isPublicIPv4(b.slice(12)); // 64:ff9b::/96 NAT64
    return false; // 64:ff9b:1::/48 local-use NAT64 — never public
  }
  if (b[0] === 0x20 && b[1] === 0x02) return isPublicIPv4(b.slice(2, 6)); // 2002::/16 6to4

  // The gate: everything outside 2000::/3 is non-global by definition. This is
  // what makes fc00::/7, fe80::/10, fec0::/10, ff00::/8, 100::/64 and every
  // other reserved block a refusal without having to name them one by one.
  if ((b[0] & 0xe0) !== 0x20) return false;

  // Carve-outs INSIDE global unicast.
  if (b[0] === 0x20 && b[1] === 0x01) {
    if (b[2] === 0x00 && b[3] === 0x00) return false; // 2001::/32 Teredo
    if (b[2] === 0x0d && b[3] === 0xb8) return false; // 2001:db8::/32 documentation
  }
  return true;
}

// True only for an IP LITERAL that is routable on the public internet.
//
// Named "…IpLiteral" rather than "…Address" on purpose: it returns false for a
// hostname, which is fail-closed at every call site here but reads as "this
// host is not public" to anyone who writes `if (!isPublicIpLiteral(host))` —
// the opposite of what it means. A name is not judged, it is RESOLVED, and
// that happens in assertFetchTarget.
export function isPublicIpLiteral(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const b = ip.split(".").map(Number);
    return b.length === 4 && isPublicIPv4(b);
  }
  if (version === 6) {
    const b = ipv6ToBytes(ip);
    return b !== null && isPublicIPv6(b);
  }
  return false; // not an IP at all — callers resolve the name first
}

// Hostnames that never denote a public host. The DNS check below is the real
// guard (these all resolve to loopback anyway); this is a fast path that also
// works offline, in tests, and when a resolver is misconfigured.
const LOCAL_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

function isLocalName(host: string): boolean {
  if (host === "localhost") return true;
  return LOCAL_SUFFIXES.some((s) => host.endsWith(s));
}

// URL.hostname keeps the brackets on an IPv6 literal; net.isIP does not want
// them.
function hostLabel(u: URL): string {
  const h = u.hostname;
  return h.startsWith("[") && h.endsWith("]") ? h.slice(1, -1) : h;
}

// ── The guard ───────────────────────────────────────────────────────────

// Everything checkable without touching the network: scheme, host allowlist,
// and IP literals. Exported so tests can pin the rules without DNS, and so a
// caller can pre-screen a batch cheaply.
export function parseFetchTarget(
  raw: string | URL | null | undefined,
  opts: SafeFetchOptions = {},
): URL | null {
  // The scheme allowlist, once, from lib/safe-url.ts. This is what refuses
  // "data:", and it matters more here than it looks: Node's fetch RESOLVES a
  // data: URL and returns 200, so a checker that treats "a live response" as
  // evidence the link is real will happily believe an attacker-authored
  // string that never left the process.
  const u = parseExternalUrl(typeof raw === "string" ? raw : raw?.toString());
  if (!u) return null;

  const host = hostLabel(u);
  if (opts.allowInitialHosts && !opts.allowInitialHosts.includes(host))
    return null;

  if (isIP(host) !== 0) return isPublicIpLiteral(host) ? u : null;
  if (isLocalName(host)) return null;
  return u;
}

// The full check, including name resolution. Throws rather than returning null
// so a caller cannot accidentally treat "blocked" as "empty" and carry on.
export async function assertFetchTarget(
  raw: string | URL | null | undefined,
  opts: SafeFetchOptions = {},
): Promise<URL> {
  const u = parseFetchTarget(raw, opts);
  if (!u) {
    throw new BlockedUrlError(
      `refusing to fetch ${JSON.stringify(String(raw ?? ""))}: not a public http(s) URL${
        opts.allowInitialHosts ? ` on ${opts.allowInitialHosts.join(", ")}` : ""
      }`,
    );
  }

  const host = hostLabel(u);
  if (isIP(host) !== 0) return u; // already judged, and no name to resolve

  // A name can point anywhere, and an attacker controls the DNS for a name
  // they chose: "169.254.169.254.nip.io" is a perfectly ordinary hostname that
  // the URL parser leaves alone and the resolver turns into the metadata
  // service. Every address it resolves to must be public — ANY private one is
  // a refusal, since a hostile resolver can return a mixed set and let the
  // connection pick.
  //
  // Honest limit: this is check-then-connect, so it does not stop a resolver
  // that answers differently on the second lookup (DNS rebinding). Closing
  // that needs a custom undici dispatcher pinned to the address we verified.
  // These are crons over a catalogue, not a user-facing fetch endpoint, and
  // the allowInitialHosts callers are not exposed to it at all — so the rebinding
  // window is logged as a known gap rather than papered over.
  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch (e) {
    // A plain Error, NOT BlockedUrlError: an unreachable resolver says nothing
    // about whether the stored URL is hostile, and callers use the class to
    // decide between "shout, a row is poisoned" and "retry later".
    throw new Error(
      `dns lookup failed for ${u.hostname}: ${(e as Error).message}`,
    );
  }
  if (addresses.length === 0)
    throw new Error(`dns lookup returned no addresses for ${u.hostname}`);
  const bad = addresses.find((a) => !isPublicIpLiteral(a.address));
  if (bad)
    throw new BlockedUrlError(
      `refusing to fetch ${u.origin}: resolves to non-public address ${bad.address}`,
    );
  return u;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// fetch(), with the guard applied to the initial URL AND to every redirect
// hop. Following redirects is the default in Node and it is exactly how a
// pre-flight check gets defeated: a wholly innocent public URL replies 302
// Location: http://169.254.169.254/ and the default client goes there without
// telling anyone. So redirect is "manual" and each hop is re-asserted.
//
// Note that allowInitialHosts deliberately applies to the FIRST url only. Google's
// Places photo endpoint answers with a 302 to a googleusercontent CDN host —
// pinning every hop to the allowlist would silently mirror zero photos. Hops
// still have to be public http(s), which is what actually closes the SSRF.
export async function safeFetch(
  raw: string | URL | null | undefined,
  init: RequestInit = {},
  opts: SafeFetchOptions = {},
): Promise<Response> {
  const max = opts.maxRedirects ?? 5;
  let target = await assertFetchTarget(raw, opts);
  let current: RequestInit = init;

  for (let hop = 0; ; hop++) {
    const res = await fetch(target, { ...current, redirect: "manual" });
    if (!REDIRECT_STATUSES.has(res.status)) return res;

    const location = res.headers.get("location");
    if (!location) return res; // a redirect with nowhere to go — hand it back as-is

    // Free the socket. undici holds it until GC otherwise, and these loops run
    // over thousands of catalogue rows.
    await res.body?.cancel().catch(() => {});

    if (hop >= max)
      throw new Error(
        `too many redirects (> ${max}) starting at ${target.origin}`,
      );

    // Resolved against the CURRENT url, the way a browser resolves a relative
    // Location, so the value we check is the value we will request.
    let nextUrl: URL;
    try {
      nextUrl = new URL(location, target);
    } catch {
      throw new BlockedUrlError(
        `refusing to follow unparseable redirect from ${target.origin}`,
      );
    }

    // Doing our own redirects means we also inherit the responsibilities the
    // runtime was carrying. undici strips credentials when a redirect crosses
    // origins; if we did not, a token meant for one host would be handed to
    // whatever host it forwarded us to. No caller passes one today — this is
    // for the next one, since ingest-events already fetches with a Bearer.
    if (nextUrl.origin !== target.origin) {
      const headers = new Headers(current.headers);
      headers.delete("authorization");
      headers.delete("cookie");
      current = { ...current, headers };
    }
    // Likewise the method: 301/302/303 turn a POST into a GET, and the body
    // must not be replayed to a new URL.
    const method = (current.method ?? "GET").toUpperCase();
    if (res.status !== 307 && res.status !== 308 && method !== "HEAD") {
      current = { ...current, method: "GET", body: undefined };
    }

    target = await assertFetchTarget(nextUrl.toString(), {
      maxRedirects: opts.maxRedirects,
    });
  }
}

// True when a failure came from this guard rather than from the network, so
// callers can report "refused" separately from "the site is down" — a poisoned
// catalogue row should be loud, not lost in dead-link noise.
export function isBlockedUrlError(e: unknown): e is BlockedUrlError {
  return e instanceof BlockedUrlError;
}
