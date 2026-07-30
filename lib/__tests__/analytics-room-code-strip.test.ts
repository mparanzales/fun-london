import { describe, it, expect, vi } from "vitest";

// BEHAVIOURAL tests for the room-code stripper, replacing the source-text
// assertions that used to "prove" it.
//
// Why this file exists at all: the original guard checked that the string
// `sanitize_properties: stripRoomCodes` appeared in the source and that the
// regex literal matched a hard-coded shape. Three real leaks passed that guard
// with CI green, and the third assertion pinned the buggy regex, so fixing the
// bug would have broken the test and invited someone to loosen the test instead.
// That is the same failure mode as PR #187's own commit title: "fix the gate
// meant to prove it".
//
// A room code is a BEARER CREDENTIAL. Every case below asserts the code
// characters are ABSENT from the output, not that some function was called.

vi.mock("posthog-js", () => ({
  default: {
    init: vi.fn(),
    capture: vi.fn(),
    identify: vi.fn(),
    reset: vi.fn(),
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
    captureException: vi.fn(),
  },
}));
vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));

const { stripRoomCodes } = await import("@/lib/analytics");

// Distinctive so a partial match cannot hide behind a common word.
const CODE = "K4WP2X";

function leaks(props: Record<string, unknown>): boolean {
  return JSON.stringify(stripRoomCodes(props)).includes(CODE);
}

describe("the plain, documented case", () => {
  it("redacts a room code in a top-level URL", () => {
    expect(
      leaks({ $current_url: `https://funldn.com/plan/together?room=${CODE}` }),
    ).toBe(false);
  });

  it("keeps the path, so funnels on /plan/together still work", () => {
    const out = stripRoomCodes({
      $current_url: `https://funldn.com/plan/together?room=${CODE}`,
    });
    expect(String(out.$current_url)).toContain("/plan/together");
    expect(String(out.$current_url)).toContain("redacted");
  });
});

describe("percent-encoded forms: the PRIMARY leak path, missed by v1", () => {
  // This is what the anon invite flow actually produces. An invitee opens
  // /plan/together?room=CODE, the auth wall builds a sign-in link with the whole
  // return path URL-encoded, and autocapture then attaches that URL to every
  // subsequent click. v1 tested `includes("room=")` on the raw value, so this
  // sailed straight through to PostHog EU.
  it.each([
    [
      "encoded return param",
      `https://funldn.com/sign-in?return=%2Fplan%2Ftogether%3Froom%3D${CODE}`,
    ],
    [
      "encoded separator, plain equals",
      `https://funldn.com/sign-in?return=%2Fplan%2Ftogether%3Froom=${CODE}`,
    ],
    [
      "uppercase encoding",
      `https://funldn.com/sign-in?return=%2Fplan%2Ftogether%3FROOM%3D${CODE}`,
    ],
    [
      "second param position",
      `https://funldn.com/sign-in?a=1%26room%3D${CODE}`,
    ],
    [
      "the /auth/callback redirect",
      `https://funldn.com/auth/callback?next=%2Fplan%2Ftogether%3Froom%3D${CODE}`,
    ],
  ])("redacts %s", (_label, url) => {
    expect(leaks({ $current_url: url })).toBe(false);
  });

  it("also covers the referrer properties, which are re-derived per event", () => {
    expect(
      leaks({
        $referrer: `https://funldn.com/sign-in?return=%2Fplan%2Ftogether%3Froom%3D${CODE}`,
        $initial_referrer: `https://funldn.com/plan/together?room=${CODE}`,
      }),
    ).toBe(false);
  });
});

describe("nested values: missed by v1, which only looked at top-level strings", () => {
  it("redacts inside the $elements array posthog-js builds", () => {
    // Sent whenever the project's remote config has elementsChainAsString
    // false. attr__href is captured verbatim: mask_all_element_attributes and
    // mask_personal_data_properties both default to false and are not set.
    expect(
      leaks({
        $elements: [
          { tag_name: "a", attr__href: `/plan/together?room=${CODE}` },
          { tag_name: "div" },
        ],
      }),
    ).toBe(false);
  });

  it("redacts inside a nested object", () => {
    expect(
      leaks({ ctx: { deep: { href: `/plan/together?room=${CODE}` } } }),
    ).toBe(false);
  });

  it("redacts inside an array of strings", () => {
    expect(leaks({ hrefs: [`/plan/together?room=${CODE}`, "/explore"] })).toBe(
      false,
    );
  });

  it("survives a cyclic-ish deep structure without hanging", () => {
    let deep: Record<string, unknown> = { href: `?room=${CODE}` };
    for (let i = 0; i < 50; i++) deep = { nest: deep };
    // Past the depth cap the value is returned untouched rather than walked
    // forever. Nothing the app sends is anywhere near this deep; the assertion
    // is that it TERMINATES.
    expect(() => stripRoomCodes(deep)).not.toThrow();
  });
});

describe("the greedy match no longer destroys the payload", () => {
  it("redacts the code in an elements chain WITHOUT eating the rest", () => {
    const chain =
      `a.cta:attr__href="/plan/together?room=${CODE}" nth-child="1" text="Try again";` +
      `div.wrap:nth-child="2";body:`;
    const out = String(
      stripRoomCodes({ $elements_chain: chain }).$elements_chain,
    );
    expect(out).not.toContain(CODE);
    // v1 replaced everything from `room=` to end of string, so all three of
    // these vanished. They are the whole value of an elements chain.
    expect(out).toContain('nth-child="1"');
    expect(out).toContain('text="Try again"');
    expect(out).toContain("body:");
  });
});

describe("it does not damage anything legitimate", () => {
  it("leaves an unrelated URL alone", () => {
    const url = "https://funldn.com/venue/padella?ref=explore";
    expect(stripRoomCodes({ $current_url: url }).$current_url).toBe(url);
  });

  it("leaves the app's own coarse properties alone", () => {
    const props = {
      auth_state: "anon",
      viewport_bucket: "mobile",
      entry_surface: "explore",
      stop_index: 1,
      duration_ms: 42,
      full: false,
      pool_size: null,
    };
    expect(stripRoomCodes(props)).toEqual(props);
  });

  it("passes the security events' own payloads through untouched", () => {
    // room_id is the opaque plan_rooms row uuid, NOT a join credential, and it
    // is the only correlation property two of the three together_* events have.
    const props = {
      reason: "expired",
      room_id: "8f14e45f-ceea-467a-9d0b-0a1b",
    };
    expect(stripRoomCodes(props)).toEqual(props);
  });

  it("does not choke on non-plain-object values", () => {
    const d = new Date(0);
    const out = stripRoomCodes({ when: d, re: /x/, n: 1, b: true, z: null });
    expect(out.when).toBe(d); // returned as is, type preserved
    expect(out.n).toBe(1);
    expect(out.z).toBeNull();
  });
});

describe("it is wired into posthog.init", () => {
  it("is passed as sanitize_properties, so every capture goes through it", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test_key");
    let opts: Record<string, unknown> | undefined;
    vi.doMock("posthog-js", () => ({
      default: {
        init: (_k: string, o?: Record<string, unknown>) => void (opts = o),
        capture: vi.fn(),
        identify: vi.fn(),
        reset: vi.fn(),
        opt_in_capturing: vi.fn(),
        opt_out_capturing: vi.fn(),
        captureException: vi.fn(),
      },
    }));
    vi.stubGlobal("window", {
      innerWidth: 375,
      localStorage: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
      },
      sessionStorage: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
      },
    });
    const mod = await import("@/lib/analytics");
    mod.initAnalytics();

    const hook = opts?.sanitize_properties as
      | ((p: Record<string, unknown>, e: string) => Record<string, unknown>)
      | undefined;
    expect(typeof hook).toBe("function");
    // And the wired hook is the hardened one, exercised end to end.
    const cleaned = hook!(
      {
        $current_url: `https://funldn.com/sign-in?return=%2Fplan%3Froom%3D${CODE}`,
      },
      "$autocapture",
    );
    expect(JSON.stringify(cleaned)).not.toContain(CODE);
    vi.unstubAllGlobals();
  });
});
