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

  it("terminates on a pathologically deep structure, and stops redacting past the cap", () => {
    let deep: Record<string, unknown> = { href: `?room=${CODE}` };
    for (let i = 0; i < 50; i++) deep = { nest: deep };
    expect(() => stripRoomCodes(deep)).not.toThrow();
    // HONEST about the trade: past MAX_SANITIZE_DEPTH the sub-tree is returned
    // by reference, so anything below it is NOT redacted. Asserted rather than
    // glossed over, because the file header promises the code is absent from
    // the output and here it is not. The bound is unreachable from real
    // payloads: the deepest posthog sends is $exception_list frames at depth 5
    // of 6, and $elements sits at depth 3.
    expect(leaks(deep)).toBe(true);
  });
});

describe("object KEYS, the leak that survived the first hardening", () => {
  // Caught by capturing a real $$heatmap payload off production, not by reading
  // the code. PostHog's heatmap data is an object KEYED BY THE PAGE URL, and
  // heatmaps are switched on by the project's REMOTE CONFIG, so nothing in this
  // repository says they are enabled at all.
  it("redacts a room code sitting in a $heatmap_data key", () => {
    const props = {
      $heatmap_data: {
        [`https://funldn.com/sign-in?return=%2Fplan%2Ftogether%3Froom%3D${CODE}`]:
          [{ x: 10, y: 20, target_fixed: false, type: "click" }],
      },
    };
    expect(leaks(props)).toBe(false);
  });

  it("keeps the heatmap entry usable rather than dropping it", () => {
    const out = stripRoomCodes({
      $heatmap_data: {
        [`https://funldn.com/plan/together?room=${CODE}`]: [{ x: 1, y: 2 }],
      },
    }) as { $heatmap_data: Record<string, unknown> };
    const keys = Object.keys(out.$heatmap_data);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toContain("/plan/together"); // the page is still identifiable
    expect(keys[0]).toContain("redacted");
    expect(out.$heatmap_data[keys[0]]).toEqual([{ x: 1, y: 2 }]); // data intact
  });

  it("redacts keys at depth, not just at the top", () => {
    expect(leaks({ a: { b: { [`?room=${CODE}`]: { c: 1 } } } })).toBe(false);
  });

  it("leaves ordinary keys untouched", () => {
    const props = {
      $heatmap_data: { "https://funldn.com/explore": [{ x: 1 }] },
    };
    expect(stripRoomCodes(props)).toEqual(props);
  });
});

describe("redacting a key must not silently drop the other bucket", () => {
  it("merges two heatmap buckets that collapse to the same redacted key", () => {
    // One visitor, two rooms, inside a single heatmap flush window. Before the
    // merge the second key overwrote the first and its clicks vanished: the
    // same "looks fine on a dashboard" data loss the greedy match caused.
    const out = stripRoomCodes({
      $heatmap_data: {
        "https://funldn.com/plan/together?room=AAAA11": [{ x: 1, y: 1 }],
        "https://funldn.com/plan/together?room=BBBB22": [{ x: 9, y: 9 }],
      },
    }) as { $heatmap_data: Record<string, unknown> };
    const keys = Object.keys(out.$heatmap_data);
    expect(keys).toHaveLength(1); // they legitimately collapse
    expect(out.$heatmap_data[keys[0]]).toEqual([
      { x: 1, y: 1 },
      { x: 9, y: 9 },
    ]); // and BOTH buckets survive
    expect(JSON.stringify(out)).not.toContain("AAAA11");
    expect(JSON.stringify(out)).not.toContain("BBBB22");
  });
});

describe("load-bearing init options are pinned, not defended by a comment", () => {
  // Each of these is the ONLY thing keeping a whole category of payload off a
  // transport that sanitize_properties cannot see. A comment does not fail CI.
  async function initOptions(): Promise<Record<string, unknown>> {
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
      // A production host: initAnalytics refuses to send from anywhere else.
      location: { hostname: "www.funldn.com" },
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
    vi.unstubAllGlobals();
    return opts ?? {};
  }

  it("keeps session recording off (its $snapshot path skips the sanitizer)", async () => {
    expect((await initOptions()).disable_session_recording).toBe(true);
  });

  it("keeps console-log capture off (its /i/v1/logs path sends url.full raw)", async () => {
    const logs = (await initOptions()).logs as { captureConsoleLogs?: boolean };
    expect(logs?.captureConsoleLogs).toBe(false);
  });

  it("keeps dead-click capture off (it reads the BARE room code as text)", async () => {
    expect((await initOptions()).capture_dead_clicks).toBe(false);
  });

  it("keeps heatmaps off (the one the project actually had ENABLED)", async () => {
    // $heatmap_data is keyed by the page URL, which is how a room code shipped
    // in an object KEY. The project's remote config returns heatmaps: true and
    // nothing in the product uses them, so the feature is switched off rather
    // than left to the redactor.
    expect((await initOptions()).capture_heatmaps).toBe(false);
  });

  it("stays on the EU host and stays cookieless", async () => {
    const o = await initOptions();
    expect(o.api_host).toBe("https://eu.i.posthog.com");
    expect(o.persistence).toBe("localStorage");
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

describe("the persisted first-touch URL is scrubbed before init reads it", () => {
  // posthog-js freezes $initial_person_info on the first pageview and then
  // sends it as $initial_current_url on every /flags request, which does NOT
  // pass through sanitize_properties. A browser that already opened an invite
  // link has a live room code in its own localStorage, forever.
  it("rewrites a room code already frozen in posthog's own storage", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test_key");
    const store = new Map<string, string>();
    const STORE_KEY = "ph_phc_test_key_posthog";
    store.set(
      STORE_KEY,
      JSON.stringify({
        distinct_id: "abc",
        $initial_person_info: {
          u: `https://funldn.com/plan/together?room=${CODE}`,
        },
      }),
    );
    vi.doMock("posthog-js", () => ({
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
    vi.stubGlobal("window", {
      // A production host: initAnalytics refuses to send from anywhere else.
      location: { hostname: "www.funldn.com" },
      innerWidth: 375,
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
      sessionStorage: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
      },
    });
    const mod = await import("@/lib/analytics");
    expect(store.get(STORE_KEY)).toContain(CODE); // positive control
    mod.initAnalytics();
    expect(store.get(STORE_KEY)).not.toContain(CODE);
    expect(store.get(STORE_KEY)).toContain("redacted");
    expect(store.get(STORE_KEY)).toContain("abc"); // nothing else destroyed
    vi.unstubAllGlobals();
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
      // A production host: initAnalytics refuses to send from anywhere else.
      location: { hostname: "www.funldn.com" },
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

describe("the OTHER vendor gets the same treatment", () => {
  // 🧨 track() fans out to TWO analytics providers, and every protection in
  // this file was aimed at one of them. <Analytics /> from @vercel/analytics
  // auto-tracks pageviews with the full URL, so /plan/together?room=CODE
  // shipped the bearer credential to Vercel in the clear while PostHog's copy
  // was being carefully scrubbed.

  it("redacts a room code out of a pageview URL", async () => {
    const { redactRoomCodesInString } = await import("@/lib/analytics");
    const out = redactRoomCodesInString(
      `https://www.funldn.com/plan/together?room=${CODE}`,
    );
    expect(out).not.toContain(CODE);
    expect(out).toContain("/plan/together"); // the useful part survives
  });

  it("is actually wired into the mounted <Analytics />", async () => {
    // Asserting the redactor works proves nothing if nobody calls it. This is
    // the wiring, which is the half that has been missing before.
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    // Comments stripped FIRST. The JSX comment above the mount quotes both
    // `<Analytics />` and `beforeSend` while explaining the fix, so a raw scan
    // matches the documentation and stays green after the prop is deleted.
    // Verified by removing the prop and watching this go red.
    const gate = readFileSync(
      fileURLToPath(
        new URL("../../components/analytics-gate.tsx", import.meta.url),
      ),
      "utf8",
    )
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(gate).toMatch(/<Analytics[\s\S]{0,200}beforeSend/);
    expect(gate).toContain("redactRoomCodesInString");
  });
});
