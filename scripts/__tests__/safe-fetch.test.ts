// The server-side half of the catalogue-URL rule: no cron may be walked into
// fetching our own loopback, our own cloud metadata service, or a scheme that
// never leaves the process.
//
// Three layers, because each can rot independently:
//
//   1. Behavioural — the real guard run over the exact strings an attacker
//      would store, including the obfuscations that defeat a naive check.
//   2. Reachability — proof that each hostile fixture WOULD have been fetched
//      if the guard were absent. Without this, a fixture that Node's fetch
//      rejects for its own unrelated reasons (file:// throws; a bare hostname
//      never parses) passes vacuously and pins nothing.
//   3. Wiring — proof that the scripts actually call the guard, which is what
//      catches the NEXT script somebody adds.
//
// A source scan cannot prove a runtime fact, so (3) is a tripwire on top of
// (1) and (2), not a substitute for either.

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// The resolver is mocked for the whole file. Two reasons: these tests must not
// depend on the machine having working DNS (a unit test that silently needs
// the network is a flake waiting for CI), and the resolution branch is a guard
// in its own right that has to be pinned deliberately — see the
// "resolves to" block below.
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));
const { lookup } = await import("node:dns/promises");
// dns.lookup is overloaded, and vi.mocked binds to the single-address form —
// which is not the one safe-fetch calls ({ all: true } returns an array). Cast
// to the plain Mock so the array answers below typecheck.
const mockLookup = lookup as unknown as Mock;

const {
  BlockedUrlError,
  isBlockedUrlError,
  isPublicIpLiteral,
  parseFetchTarget,
  safeFetch,
  assertFetchTarget,
} = await import("../safe-fetch");

const SCRIPTS_DIR = fileURLToPath(new URL("../", import.meta.url));

// Default: every name resolves to one ordinary public address.
beforeEach(() => {
  mockLookup.mockReset();
  mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
});

// ── The fixtures from the report, plus the obfuscations of them ──────────
//
// Every one of these, stored in venues.img_url / venues.website_url /
// editorial_sources[].url / events.source_url, was a request our own process
// would make on behalf of whoever wrote the row.

const METADATA_AND_LOOPBACK = [
  // Verbatim from the SSRF report.
  "http://169.254.169.254/latest/meta-data/iam/security-credentials/?x=places.googleapis.com",
  "http://127.0.0.1:54321/rest/v1/venues?x=places.googleapis.com",
  // The same two destinations, spelled so a dotted-quad string match misses
  // them. The WHATWG parser normalises every one of these back to
  // 127.0.0.1 — which is exactly why the check has to run on the PARSED
  // hostname and not on the raw string.
  "http://0177.0.0.1/",
  "http://2130706433/",
  "http://0x7f.0x0.0x0.0x1/",
  "http://127.1/",
  "http://127.0.0.1.:8000/",
  // IPv6. The parser rewrites [::ffff:169.254.169.254] to ::ffff:a9fe:a9fe,
  // so a check looking for the "::ffff:" + dotted-quad spelling sees nothing.
  "http://[::1]/",
  "http://[::ffff:127.0.0.1]/",
  "http://[::ffff:169.254.169.254]/latest/meta-data/",
  "http://[0:0:0:0:0:ffff:a9fe:a9fe]/",
  "http://[fd00::1]/",
  "http://[fe80::1]/",
  // Found by review, all judged PUBLIC by the first version of the v6 check —
  // which is why that check is now an allowlist of 2000::/3 instead of a list
  // of forbidden prefixes. Keep every one of these: they are the evidence that
  // enumerating "what is reserved" was the wrong shape.
  "http://[::127.0.0.1]/", // ::/96 IPv4-compatible, normalises to ::7f00:1
  "http://[::ffff:0:127.0.0.1]/", // ::ffff:0:0:0/96 IPv4-translated
  "http://[fec0::1]/", // fec0::/10 site-local
  "http://[2001:db8::1]/", // 2001:db8::/32 documentation
  "http://[2001::1]/", // 2001::/32 Teredo
  "http://[64:ff9b:1::7f00:1]/", // local-use NAT64
  "http://[100::1]/", // 100::/64 discard-only
  // Other reserved space that reaches something inside the perimeter.
  "http://10.0.0.1/",
  "http://172.16.0.1/",
  "http://192.168.1.1/",
  "http://100.64.0.1/",
  "http://0.0.0.0:8000/",
  "http://localhost:54321/rest/v1/venues",
  "http://api.localhost/",
];

// Non-web schemes. data: is the one that matters most here: Node's fetch
// RESOLVES it and answers 200 without touching the network, which is how
// verify-editorial-sources could grant `verified: true` to a URL that was
// never anywhere.
const NON_WEB_SCHEMES = [
  "data:text/html,<h1>hi</h1>",
  "data:text/plain,the-ivy-chelsea",
  "javascript:alert(1)",
  "JavaScript:alert(1)",
  "java\nscript:alert(1)",
  "file:///etc/passwd",
  "gopher://127.0.0.1:11211/_stats",
];

const PUBLIC_OK = [
  "https://places.googleapis.com/v1/places/abc/media?key=k&maxWidthPx=1600",
  "https://www.squaremeal.co.uk/restaurants/some-place",
  "https://img.funldn.com/venue.webp",
  "http://example.com/menu",
  "https://example.com:8443/path?a=1#frag",
];

// ── 1. Behavioural ───────────────────────────────────────────────────────

describe("parseFetchTarget refuses the destinations a catalogue row must not name", () => {
  it.each(METADATA_AND_LOOPBACK)("refuses %j", (raw) => {
    expect(parseFetchTarget(raw)).toBeNull();
  });

  it.each(NON_WEB_SCHEMES)("refuses %j", (raw) => {
    expect(parseFetchTarget(raw)).toBeNull();
  });

  it.each(PUBLIC_OK)("allows %j", (raw) => {
    expect(parseFetchTarget(raw)).not.toBeNull();
  });

  it("refuses empty and non-string input", () => {
    expect(parseFetchTarget(null)).toBeNull();
    expect(parseFetchTarget(undefined)).toBeNull();
    expect(parseFetchTarget("")).toBeNull();
    expect(parseFetchTarget("not a url")).toBeNull();
  });
});

describe("allowInitialHosts pins the destination by parsed authority", () => {
  const opts = { allowInitialHosts: ["places.googleapis.com"] };

  it("allows the real photo host", () => {
    expect(
      parseFetchTarget("https://places.googleapis.com/v1/places/x/media", opts),
    ).not.toBeNull();
  });

  // The bug this whole change exists for: "%places.googleapis.com%" matches
  // the literal ANYWHERE in the string. Each of these satisfies that LIKE and
  // names a completely different host.
  it.each([
    "http://169.254.169.254/latest/meta-data/?x=places.googleapis.com",
    "http://127.0.0.1:54321/rest/v1/venues?x=places.googleapis.com",
    "https://evil.test/places.googleapis.com/media",
    "https://evil.test/#places.googleapis.com",
    "https://places.googleapis.com.evil.test/media",
    // Userinfo: reads as the real host in a status bar, resolves to evil.test.
    "https://places.googleapis.com@evil.test/media",
  ])(
    "refuses %j even though it contains the allowed host as a substring",
    (raw) => {
      expect(raw).toContain("places.googleapis.com"); // the SQL filter would select it
      expect(parseFetchTarget(raw, opts)).toBeNull(); // the guard will not fetch it
    },
  );

  it("refuses a sibling host that a startsWith prefix check would accept", () => {
    const base = "https://img.funldn.com";
    const hostile = "https://img.funldn.com.evil.test/venue.webp";
    expect(hostile.startsWith(base)).toBe(true); // the old migrate-photos check
    expect(
      parseFetchTarget(hostile, { allowInitialHosts: ["img.funldn.com"] }),
    ).toBeNull();
  });
});

describe("isPublicIpLiteral", () => {
  it.each([
    "127.0.0.1",
    "169.254.169.254",
    "10.1.2.3",
    "172.20.0.1",
    "192.168.0.1",
    "100.64.0.1",
    "0.0.0.0",
    "255.255.255.255",
    "224.0.0.1",
    "::1",
    "::",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:a9fe:a9fe", // how the parser spells ::ffff:169.254.169.254
    "64:ff9b::7f00:1", // NAT64-wrapped 127.0.0.1
    "2002:7f00:1::", // 6to4-wrapped 127.0.0.1
  ])("rejects %s", (ip) => {
    expect(isPublicIpLiteral(ip)).toBe(false);
  });

  // 🧨 The reject list above is NOT self-sufficient. isPublicIpLiteral returns
  // false both for "correctly judged private" AND for "could not parse", so
  // deleting the embedded-IPv4 fold in ipv6ToBytes leaves every rejection
  // green — a textbook vacuous pass, in the very suite that is supposed to
  // catch them. These positives are what make the fold load-bearing: they can
  // only pass if the address is parsed AND judged. It is not academic —
  // dns.lookup returns IPv4-mapped answers in exactly this spelling, so a
  // broken fold would start silently refusing legitimate publishers.
  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "142.250.187.238",
    "2606:4700::1111",
    "2a00:1450::1",
    "::ffff:8.8.8.8", // mapped, public — must survive the fold
    "::ffff:0808:0808", // the same address, as the resolver spells it
    "64:ff9b::808:808", // NAT64-wrapped 8.8.8.8
    "2002:808:808::", // 6to4-wrapped 8.8.8.8
  ])("accepts %s", (ip) => {
    expect(isPublicIpLiteral(ip)).toBe(true);
  });

  it("returns false for a hostname — a name is resolved, never judged", () => {
    // Fail-closed at every call site here, but pinned so the meaning of the
    // false is unambiguous to whoever reads it next.
    expect(isPublicIpLiteral("example.com")).toBe(false);
    expect(isPublicIpLiteral("not an ip")).toBe(false);
  });
});

describe("safeFetch", () => {
  it("throws a typed BlockedUrlError rather than returning null", async () => {
    await expect(safeFetch("http://169.254.169.254/")).rejects.toBeInstanceOf(
      BlockedUrlError,
    );
    const err = await safeFetch("data:text/plain,x").catch((e) => e);
    expect(isBlockedUrlError(err)).toBe(true);
  });

  // Following redirects is fetch's default, and it is how every pre-flight
  // check gets defeated: an entirely innocent public URL answers
  // 302 Location: http://169.254.169.254/ and the default client goes.
  it("re-checks each redirect hop instead of following blindly", async () => {
    const hops: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL) => {
      hops.push(String(input));
      return new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      });
    }) as typeof fetch;
    try {
      const err = await safeFetch("https://example.com/promo").catch((e) => e);
      expect(isBlockedUrlError(err)).toBe(true);
      // It made the first (legitimate) request and refused the second.
      expect(hops).toEqual(["https://example.com/promo"]);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("passes redirect:manual so the runtime cannot follow behind our back", async () => {
    let seen: RequestInit | undefined;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: string | URL, init: RequestInit) => {
      seen = init;
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    try {
      await safeFetch("https://example.com/x", { method: "HEAD" });
      expect(seen?.redirect).toBe("manual");
      expect(seen?.method).toBe("HEAD");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  // 🧨 Both halves of the allowInitialHosts decision, pinned together. Review
  // found that NO test called safeFetch with allowInitialHosts at all, so
  // tightening line ~330 to re-apply the allowlist on every hop left the whole
  // suite green — while backfill-photos would have mirrored exactly zero
  // photos in production, because Google's media endpoint 302s to a
  // googleusercontent CDN. A green suite over a silently-dead backfill is the
  // failure mode this repo has paid for before.
  it("follows Google's CDN redirect off the allowlisted host, and returns the body", async () => {
    const seen: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL) => {
      const u = String(input);
      seen.push(u);
      if (u.startsWith("https://places.googleapis.com/"))
        return new Response(null, {
          status: 302,
          headers: {
            location: "https://lh3.googleusercontent.com/p/photo=s1600",
          },
        });
      return new Response("JPEGBYTES", { status: 200 });
    }) as typeof fetch;
    try {
      const res = await safeFetch(
        "https://places.googleapis.com/v1/places/x/media?key=k",
        {},
        { allowInitialHosts: ["places.googleapis.com"] },
      );
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("JPEGBYTES");
      expect(seen).toHaveLength(2);
      expect(new URL(seen[1]).hostname).toBe("lh3.googleusercontent.com");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("still refuses a NON-public second hop even with an allowlisted first hop", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      })) as typeof fetch;
    try {
      const err = await safeFetch(
        "https://places.googleapis.com/v1/places/x/media",
        {},
        { allowInitialHosts: ["places.googleapis.com"] },
      ).catch((e) => e);
      expect(isBlockedUrlError(err)).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  // Doing our own redirects means inheriting the responsibilities the runtime
  // was carrying. No caller passes a credential today; ingest-events already
  // fetches with a Bearer and is the obvious next migration.
  it("strips credentials when a redirect crosses origins", async () => {
    const sent: Headers[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL, init: RequestInit) => {
      sent.push(new Headers(init?.headers));
      return String(input).includes("start")
        ? new Response(null, {
            status: 302,
            headers: { location: "https://other.test/x" },
          })
        : new Response("ok", { status: 200 });
    }) as typeof fetch;
    try {
      await safeFetch("https://example.com/start", {
        headers: { authorization: "Bearer SECRET", "user-agent": "FL" },
      });
      expect(sent[0].get("authorization")).toBe("Bearer SECRET");
      expect(sent[1].get("authorization")).toBeNull();
      expect(sent[1].get("user-agent")).toBe("FL"); // only credentials go
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("does not replay a POST body to the redirect target", async () => {
    const methods: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL, init: RequestInit) => {
      methods.push(String(init?.method ?? "GET"));
      return String(input).includes("start")
        ? new Response(null, {
            status: 302,
            headers: { location: "https://example.com/next" },
          })
        : new Response("ok", { status: 200 });
    }) as typeof fetch;
    try {
      await safeFetch("https://example.com/start", {
        method: "POST",
        body: "secret=1",
      });
      expect(methods).toEqual(["POST", "GET"]);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  // A transport condition is not a verdict on the data. backfill-photos prints
  // a "🚨 a catalogue row is poisoned" banner off BlockedUrlError, and a
  // security alarm that fires on bad wifi is one people learn to ignore.
  it("throws a PLAIN Error for DNS failure and hop exhaustion, not BlockedUrlError", async () => {
    mockLookup.mockRejectedValueOnce(new Error("EAI_AGAIN"));
    const dnsErr = await safeFetch("https://example.com/x").catch((e) => e);
    expect(dnsErr).toBeInstanceOf(Error);
    expect(isBlockedUrlError(dnsErr)).toBe(false);

    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://example.com/again" },
      })) as typeof fetch;
    try {
      const hopErr = await safeFetch(
        "https://example.com/s",
        {},
        { maxRedirects: 1 },
      ).catch((e) => e);
      expect(hopErr).toBeInstanceOf(Error);
      expect(isBlockedUrlError(hopErr)).toBe(false);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("stops after maxRedirects even when every hop is public", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://example.com/again" },
      })) as typeof fetch;
    try {
      const err = await safeFetch(
        "https://example.com/start",
        {},
        { maxRedirects: 2 },
      ).catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(String(err.message)).toContain("too many redirects");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

// A hostname is not an address. The URL parser leaves "evil.test" alone, so
// nothing before this point can tell where it actually points — and an
// attacker owns the DNS for a name they chose. This block was added because
// deleting the resolution check left the suite fully GREEN: it was untested.
describe("name resolution is checked, not just the literal", () => {
  const NIP = "http://169.254.169.254.nip.io/latest/meta-data/";

  it("the sync check alone would let a metadata-pointing NAME straight through", () => {
    // Not null: syntactically this is an ordinary public hostname. Proof that
    // the resolution step below is the only thing standing between this URL
    // and a real request — i.e. the DNS test is not redundant with the rest.
    expect(parseFetchTarget(NIP)).not.toBeNull();
  });

  it("refuses a name that resolves to a private address", async () => {
    mockLookup.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
    const err = await assertFetchTarget(NIP).catch((e) => e);
    expect(isBlockedUrlError(err)).toBe(true);
    expect(String(err.message)).toContain("169.254.169.254");
  });

  // A hostile resolver can answer with a good address AND a bad one and let
  // the connection pick. ANY private address in the answer is a refusal —
  // "at least one is public" is not good enough.
  it("refuses a MIXED answer where only some addresses are public", async () => {
    mockLookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    const err = await assertFetchTarget("https://evil.test/x").catch((e) => e);
    expect(isBlockedUrlError(err)).toBe(true);
    expect(String(err.message)).toContain("127.0.0.1");
  });

  it("refuses an IPv6 private answer", async () => {
    mockLookup.mockResolvedValue([{ address: "::ffff:a9fe:a9fe", family: 6 }]);
    await expect(
      assertFetchTarget("https://evil.test/x"),
    ).rejects.toBeInstanceOf(BlockedUrlError);
  });

  // Fails closed, but as a TRANSPORT error, not a verdict on the row — see
  // the BlockedUrlError-vs-Error test in the safeFetch block.
  it("fails closed when the lookup fails or returns nothing", async () => {
    mockLookup.mockRejectedValueOnce(new Error("ENOTFOUND"));
    const failed = await assertFetchTarget("https://evil.test/x").catch(
      (e) => e,
    );
    expect(failed).toBeInstanceOf(Error);
    expect(isBlockedUrlError(failed)).toBe(false);

    mockLookup.mockResolvedValueOnce([]);
    const empty = await assertFetchTarget("https://evil.test/x").catch(
      (e) => e,
    );
    expect(empty).toBeInstanceOf(Error);
    expect(isBlockedUrlError(empty)).toBe(false);
  });

  it("allows a name that resolves only to public addresses", async () => {
    mockLookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:4700::1111", family: 6 },
    ]);
    await expect(
      assertFetchTarget("https://squaremeal.co.uk/x"),
    ).resolves.toBeInstanceOf(URL);
  });

  it("does not resolve an IP literal — it has already been judged", async () => {
    await assertFetchTarget("https://93.184.216.34/x");
    expect(mockLookup).not.toHaveBeenCalled();
  });
});

// ── 2. Reachability — the fixtures are not passing vacuously ─────────────
//
// A guard test proves nothing if the hostile fixture would have been refused
// anyway by something else. These assert the counterfactual directly: with the
// guard removed, each fixture reaches a real fetch attempt.

describe("the hostile fixtures would genuinely reach fetch if the guard were absent", () => {
  // Every metadata/loopback fixture parses to a real http(s) request. Nothing
  // upstream of our check would have stopped it.
  it.each(METADATA_AND_LOOPBACK)(
    "%j parses to a fetchable http(s) URL",
    (raw) => {
      const u = new URL(raw);
      expect(["http:", "https:"]).toContain(u.protocol);
      expect(u.hostname.length).toBeGreaterThan(0);
    },
  );

  // data: is the load-bearing one for verify-editorial-sources: unguarded, it
  // returns 200 and would have been read as "the source is live".
  it("data: really does resolve to a 200 in this runtime", async () => {
    const res = await fetch("data:text/plain,the-ivy-chelsea");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("the-ivy-chelsea");
  });

  // ...and it would have satisfied the name-in-URL heuristic as well, so both
  // of that script's independent checks would have passed at once.
  it("a data: URL would also have satisfied the name-in-URL check", () => {
    expect(new URL("data:text/plain,the-ivy-chelsea").pathname).toContain(
      "ivy",
    );
  });

  // Counter-example, kept deliberately: file:// is NOT proof of anything,
  // because this runtime refuses it on its own. Pinning it would be a
  // vacuous pass. Documented here so nobody promotes it to a guard fixture.
  it("file:// is refused by the runtime anyway, so it proves nothing on its own", async () => {
    await expect(fetch("file:///etc/hosts")).rejects.toThrow();
  });
});

// ── 3. Wiring — the scripts are actually using it ────────────────────────

describe("every script that fetches a catalogue URL goes through the guard", () => {
  // Each entry: the script, and the catalogue field whose value it fetches.
  const GUARDED = [
    ["backfill-photos.ts", "venues.img_url"],
    ["refresh-venues.ts", "editorial_sources[].url + creator_coverage[].url"],
    ["verify-editorial-sources.ts", "editorial_sources[].url"],
    ["discover-menus.ts", "venues.website_url"],
    ["og-image.ts", "events.source_url"],
    ["photo-storage.ts", "og:image from a catalogue page"],
    ["migrate-photos-to-r2.ts", "venues.img_url / photo_urls / map_url"],
  ] as const;

  it.each(GUARDED)("%s (fetches %s) imports safe-fetch", (file) => {
    const src = readFileSync(join(SCRIPTS_DIR, file), "utf8");
    expect(src).toMatch(/from "\.\/safe-fetch"/);
  });

  // Whole-file regexes, so they are weaker than they look: they prove the file
  // uses the guard SOMEWHERE, not that the catalogue-fetching function is the
  // one using it. photo-storage.ts legitimately keeps two fixed-origin bare
  // fetches alongside its guarded one, so for that file this assertion is
  // literally satisfied by a different call than the one it names. It holds
  // only in PAIR with the inventory below, which independently pins every bare
  // fetch. Neither test is sufficient alone — do not delete one as redundant.
  it.each(GUARDED)(
    "%s fetches the catalogue value through safeFetch",
    (file) => {
      const src = readFileSync(join(SCRIPTS_DIR, file), "utf8");
      expect(src).toMatch(/safeFetch\(|parseFetchTarget\(/);
    },
  );
});

// Every bare fetch() left in scripts/, reviewed 2026-08-06. Each one's ORIGIN
// is hardcoded — a literal https:// host, or a constant/builder that resolves
// to one (PLACES_BASE, API_HOST, SUPABASE_URL, googleMediaUrl, r2PublicUrl) —
// so no catalogue value can steer where the request goes.
//
// The precise rule, because the loose version of it is wrong: a variable is
// safe when it appears AFTER a "/" that has already terminated the authority.
// `${PLACES_BASE}/${placeId}` is safe for that reason. Bare concatenation is
// NOT — posthog-api.ts's `API_HOST + path` would yield authority evil.com for
// path = "@evil.com/api", with the Bearer key attached. It is unreachable
// today only because `path` is always a caller-side literal. This repo has
// already shipped one live open redirect from exactly this mismatch between
// what a guard reads and what the consumer resolves, so audit against the
// precise rule, never the loose one.
//
// This is the tripwire for the NEXT one. A new fetch() whose destination comes
// from a variable will not be in this list, and this test will say so. The fix
// is not to add it here: it is to route it through safeFetch, or to convince
// yourself the origin really is hardcoded and then add it WITH that reason.
const REVIEWED_FIXED_ORIGIN_FETCHES: [string, string][] = [
  ["backfill-gallery.ts", "`https://places.googleapis.com/v1/places/${pla"],
  [
    "backfill-missing-venues.ts",
    '`${PLACES_BASE}:searchText`, { method: "POST",',
  ],
  [
    "backfill-missing-venues.ts",
    '`${PLACES_BASE}/${placeId}`, { headers: { "X-G',
  ],
  ["discover-venues.ts", '`${PLACES_BASE}:searchText`, { method: "POST",'],
  ["fix-events.ts", '`${PLACES_BASE}:searchText`, { method: "POST",'],
  ["fix-events.ts", '`${PLACES_BASE}/${placeId}`, { headers: { "X-G'],
  ["google-reviews.ts", "`https://places.googleapis.com/v1/places/${pla"],
  ["ingest-events.ts", "url, { headers: { Authorization: `Bearer ${tok"],
  ["ingest-events.ts", "`https://www.eventbriteapi.com/v3/events/${sou"],
  ["ingest-events.ts", "url); if (!res.ok) { throw new Error(`Ticketma"],
  ["ingest-events.ts", 'url); if (!res.ok) { console.error( ` ! "${ven'],
  ["ingest-from-pending.ts", '`${PLACES_BASE}:searchText`, { method: "POST",'],
  ["ingest-from-pending.ts", '`${PLACES_BASE}/${placeId}`, { headers: { "X-G'],
  ["ingest-from-pending.ts", "`${SUPABASE_URL}/rest/v1/pending_candidates?se"],
  ["ingest-venues.ts", '`${PLACES_BASE}:searchText`, { method: "POST",'],
  ["ingest-venues.ts", '`${PLACES_BASE}/${placeId}`, { method: "GET", '],
  ["migrate-photos-to-r2.ts", 'r2PublicUrl(name), { method: "HEAD" }); if (re'],
  ["photo-storage.ts", "googleMediaUrl(photoName)); if (!res.ok) throw"],
  ["photo-storage.ts", "url); if (!res.ok) throw new Error( `fetch HTT"],
  ["places-detail.ts", '`${PLACES_BASE}:searchText`, { method: "POST",'],
  ["places-detail.ts", '`${PLACES_BASE}/${placeId}`, { headers: { "X-G'],
  ["posthog-api.ts", 'API_HOST + path, { method: init?.method ?? "GE'],
  [
    "posthog-revoked-check.ts",
    "`${API_HOST}/api/users/@me/`, { headers: { Aut",
  ],
  ["refresh-venues.ts", '`${PLACES_BASE}/${placeId}`, { method: "GET", '],
  ["revalidate-venues.ts", '`${PLACES_BASE}/${placeId}`, { headers: { "X-G'],
  ["send-weekly-digest.ts", '"https://api.resend.com/emails", { method: "PO'],
];

describe("no NEW unguarded fetch appears in scripts/", () => {
  it("the set of bare fetch() calls is exactly the reviewed set", () => {
    const found: [string, string][] = [];
    // 🧨 RECURSIVE, and this is the whole point. A flat readdirSync could not
    // see scripts/candidate-sources/ — six publication adapters, every one a
    // stub, and timeout.ts's own TODO reads "1. fetch() the RSS XML … wire
    // this first". The single directory where the next unguarded fetch is
    // already scheduled was the one directory the tripwire was blind to.
    // __tests__ is excluded on purpose: ssrf-runtime-probe.ts makes a bare
    // fetch deliberately, as the counterfactual demonstration.
    for (const f of readdirSync(SCRIPTS_DIR, { recursive: true }) as string[]) {
      if (!/\.(ts|mts|cts|js|mjs)$/.test(f)) continue;
      if (f === "safe-fetch.ts" || f.includes("__tests__")) continue;
      // Comment LINES are dropped first. timeout.ts's TODO contains the literal
      // text "1. fetch() the RSS XML", and counting prose would both add a
      // phantom row here and — far worse — let the real call slip in later
      // under an entry that already looked reviewed. Only whole comment lines
      // go, so an inline "//" inside a URL string cannot truncate real code.
      const src = readFileSync(join(SCRIPTS_DIR, f), "utf8")
        .split("\n")
        .map((l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? "" : l))
        .join("\n");
      // The negative lookbehind is what excludes safeFetch( — this counts
      // only calls that bypass the guard.
      const re = /(?<![A-Za-z])fetch\(/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        const arg = src
          .slice(m.index + 6, m.index + 6 + 70)
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 46);
        found.push([f, arg]);
      }
    }
    const key = (p: [string, string]) => `${p[0]} :: ${p[1]}`;
    expect(found.map(key).sort()).toEqual(
      REVIEWED_FIXED_ORIGIN_FETCHES.map(key).sort(),
    );
  });
});
