import { describe, it, expect } from "vitest";
import {
  classifyRevocation,
  hostObjection,
  keyObjection,
  keyFingerprint,
} from "../posthog-revoked-check";

// The one piece of logic whose entire job is to prevent a false green tick.
//
// 🧨 IT HAS ALREADY BEEN WRONG ONCE, and it had no test when it was. The first
// version read "rejected" as `status === 401 || status === 403`, which
// certifies a LIVE key as dead: on this project a correctly-scoped personal key
// returns 403 from /api/users/@me/ because it deliberately lacks `user:read`.
// Demonstrated against the live API, the permanent read-only key -- which had
// just listed 32 insights -- produced 403, and the check printed
// "CONFIRMED REVOKED ... exit 0".
//
// So the rule for this file: every case that could make a LIVE key look dead
// gets a test, because that is the only direction that costs anything. A dead
// key misreported as live is an operator re-running a command; a live key
// misreported as dead is a write-scoped credential left on a public repo's
// project under a green tick.

describe("classifying PostHog's answer", () => {
  it("calls it DEAD only on an explicit auth failure", () => {
    expect(classifyRevocation(401, "authentication_failed")).toBe("dead");
  });

  it("does NOT call it dead when the header simply never arrived", () => {
    // "not_authenticated" is what PostHog returns with no Authorization header
    // at all. It says nothing whatsoever about the key.
    expect(classifyRevocation(401, "not_authenticated")).toBe("unproven");
    expect(classifyRevocation(401, "")).toBe("unproven");
  });

  it("treats 403 as ALIVE, which is the whole bug", () => {
    // It authenticated and was then refused for missing scope. That is a
    // working credential.
    expect(classifyRevocation(403, "permission_denied")).toBe("live");
    expect(classifyRevocation(403, "")).toBe("live");
  });

  it("treats any 2xx as alive", () => {
    for (const s of [200, 201, 204]) {
      expect(classifyRevocation(s, "")).toBe("live");
    }
  });

  it("refuses to guess at anything else", () => {
    // A rate limit, a gateway error, an HTML error page, a redirect. None of
    // these establish anything, and "I could not tell" must never be a pass.
    for (const s of [429, 500, 502, 503, 301, 404, 418]) {
      expect(classifyRevocation(s, ""), `HTTP ${s}`).toBe("unproven");
    }
  });

  it("never returns dead for any status other than 401", () => {
    // The property, rather than the enumerated cases above: the ONLY route to
    // "dead" is 401 + authentication_failed.
    for (let s = 200; s < 600; s++) {
      for (const code of ["", "permission_denied", "authentication_failed"]) {
        const verdict = classifyRevocation(s, code);
        if (verdict === "dead") {
          expect(s).toBe(401);
          expect(code).toBe("authentication_failed");
        }
      }
    }
  });
});

describe("answers that cannot be trusted are refused before they are believed", () => {
  it("refuses a host the key was not issued against", () => {
    // A personal API key is unknown to any other PostHog host, so that host
    // returns 401 authentication_failed for a key that is very much alive --
    // indistinguishable from a real revocation. POSTHOG_API_HOST may well
    // still be exported from an earlier debugging session.
    expect(hostObjection("https://us.posthog.com")).toBeTruthy();
    expect(hostObjection("https://eu.i.posthog.com")).toBeTruthy(); // ingest host
    expect(hostObjection("https://app.posthog.com")).toBeTruthy();
  });

  it("accepts the host the keys are actually issued on", () => {
    expect(hostObjection("https://eu.posthog.com")).toBeNull();
  });

  it("refuses a key mangled by a wrapped paste", () => {
    // Django's token auth splits the header; three parts raises
    // AuthenticationFailed, which is the exact 401 a revoked key gives.
    expect(keyObjection("phx_broken key")).toBeTruthy();
    expect(keyObjection("phx_broken\tkey")).toBeTruthy();
    expect(keyObjection("phx_broken\nkey")).toBeTruthy();
  });

  it("refuses something that is not a personal API key at all", () => {
    // Pasting the browser (phc_) key here would otherwise "confirm" the
    // provisioning key dead while it is still live.
    expect(keyObjection("phc_abcdefghijklmnop")).toBeTruthy();
    expect(keyObjection("sk-whatever")).toBeTruthy();
    expect(keyObjection("")).toBeTruthy();
  });

  it("accepts a well-formed one", () => {
    expect(keyObjection(`phx_${"a".repeat(43)}`)).toBeNull();
  });
});

describe("the fingerprint identifies without revealing", () => {
  const KEY = `phx_${"a".repeat(43)}`;

  it("contains NO substring of the key", () => {
    // 🧨 The obvious implementation prints the last four characters, and this
    // repo's rule is that a key never reaches terminal output, full stop --
    // terminals get scrolled, screenshotted and pasted into chats.
    const fp = keyFingerprint(KEY);
    expect(fp).not.toContain(KEY);
    expect(fp).not.toContain(KEY.slice(-4));
    expect(fp).not.toContain(KEY.slice(4, 12));
  });

  it("still distinguishes two different keys", () => {
    // Otherwise it cannot answer "is this the one I deleted?".
    expect(keyFingerprint(KEY)).not.toBe(
      keyFingerprint(`phx_${"b".repeat(43)}`),
    );
  });

  it("is stable for the same key across runs", () => {
    expect(keyFingerprint(KEY)).toBe(keyFingerprint(KEY));
  });
});
