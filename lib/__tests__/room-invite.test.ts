import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  readRoomInvite,
  armRoomInvite,
  clearRoomInvite,
  ROOM_INVITE_INLINE_SCRIPT,
} from "@/lib/room-invite";

// The room code is a BEARER CREDENTIAL. These tests pin the two properties that
// matter: it never goes back into the URL, and it survives exactly the journeys
// a real invitee takes.

const CODE = "K4WP2X";
let store: Map<string, string>;

function stubWindow(url = "https://funldn.com/plan/together") {
  store = new Map<string, string>();
  const u = new URL(url);
  vi.stubGlobal("window", {
    location: { pathname: u.pathname, search: u.search, hash: u.hash },
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
  stubWindow();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the stash round-trips a code", () => {
  it("arms and reads back", () => {
    armRoomInvite(CODE);
    expect(readRoomInvite()).toBe(CODE);
  });

  it("is NOT one-shot, so a reload mid-room rejoins the same room", () => {
    // A one-shot read would consume the code on first load and drop the next
    // reload into a brand new empty room. That is worse for the user than the
    // code sitting in same-origin storage that is never transmitted.
    armRoomInvite(CODE);
    expect(readRoomInvite()).toBe(CODE);
    expect(readRoomInvite()).toBe(CODE);
    expect(readRoomInvite()).toBe(CODE);
  });

  it("uppercases and trims what it is given", () => {
    armRoomInvite("  k4wp2x  ");
    expect(readRoomInvite()).toBe(CODE);
  });

  it("refuses a code that is not the right shape", () => {
    for (const bad of ["", "SHORT", "TOOLONG7", "K4WP2!", "<script>"]) {
      clearRoomInvite();
      armRoomInvite(bad);
      expect(readRoomInvite()).toBeNull();
    }
  });

  it("expires", () => {
    vi.useFakeTimers();
    armRoomInvite(CODE);
    vi.advanceTimersByTime(16 * 60 * 1000);
    expect(readRoomInvite()).toBeNull();
  });

  it("removes an expired entry rather than re-parsing it forever", () => {
    vi.useFakeTimers();
    armRoomInvite(CODE);
    vi.advanceTimersByTime(16 * 60 * 1000);
    readRoomInvite();
    expect([...store.values()].join("")).not.toContain(CODE);
  });

  it("survives a corrupt stored value", () => {
    store.set("fl.room.invite.v1", "{not json");
    expect(() => readRoomInvite()).not.toThrow();
    expect(readRoomInvite()).toBeNull();
  });

  it("never throws when storage is unavailable", () => {
    vi.stubGlobal("window", {
      location: { pathname: "/plan/together", search: "", hash: "" },
      get localStorage(): Storage {
        throw new Error("private mode");
      },
    });
    expect(() => armRoomInvite(CODE)).not.toThrow();
    // The in-memory copy still carries this document.
    expect(readRoomInvite()).toBe(CODE);
  });
});

describe("sign-out must drop it", () => {
  it("clears both the global and storage", () => {
    armRoomInvite(CODE);
    clearRoomInvite();
    expect(readRoomInvite()).toBeNull();
    expect([...store.values()].join("")).not.toContain(CODE);
  });
});

describe("the pre-paint inline script", () => {
  // Run the exact string the layout injects, in a fake document, so the script
  // and the test cannot drift. This is the whole fix in one line of HTML: if it
  // stops stripping, the credential is back in PostHog.
  function runScript(href: string) {
    const u = new URL(href);
    const replaced: string[] = [];
    const win: Record<string, unknown> = {
      location: { pathname: u.pathname, search: u.search, hash: u.hash },
      history: {
        replaceState: (_a: unknown, _b: unknown, url: string) => {
          replaced.push(url);
        },
      },
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    };
    // The script is written against globals, so evaluate it with those bound.
    const fn = new Function(
      "window",
      "location",
      "history",
      "localStorage",
      "URLSearchParams",
      ROOM_INVITE_INLINE_SCRIPT,
    );
    fn(win, win.location, win.history, win.localStorage, URLSearchParams);
    return { replaced, win };
  }

  it("strips the code from the URL and stashes it", () => {
    const { replaced, win } = runScript(
      `https://funldn.com/plan/together?room=${CODE}`,
    );
    expect(replaced).toEqual(["/plan/together"]);
    expect(replaced.join("")).not.toContain(CODE);
    expect(JSON.stringify(win.__FL_ROOM_INVITE)).toContain(CODE);
    expect([...store.values()].join("")).toContain(CODE);
  });

  it("keeps other query params", () => {
    const { replaced } = runScript(
      `https://funldn.com/plan/together?a=1&room=${CODE}&b=2`,
    );
    expect(replaced[0]).toContain("a=1");
    expect(replaced[0]).toContain("b=2");
    expect(replaced[0]).not.toContain(CODE);
  });

  it("also reads a code from the hash", () => {
    const { win } = runScript(`https://funldn.com/plan/together#room=${CODE}`);
    expect(JSON.stringify(win.__FL_ROOM_INVITE)).toContain(CODE);
  });

  it("strips a MALFORMED code from the URL too, then stashes nothing", () => {
    // replaceState runs before the shape test on purpose: junk in `?room=`
    // should not be left sitting in the address bar either.
    const { replaced, win } = runScript(
      "https://funldn.com/plan/together?room=not-a-code",
    );
    expect(replaced).toEqual(["/plan/together"]);
    expect(win.__FL_ROOM_INVITE).toBeUndefined();
  });

  it("is a no-op on every other route", () => {
    for (const path of ["/explore", "/venue/padella", "/plan", "/"]) {
      const { replaced } = runScript(`https://funldn.com${path}?room=${CODE}`);
      expect(replaced).toEqual([]); // never touches the URL elsewhere
    }
  });

  it("does nothing when there is no room param", () => {
    const { replaced, win } = runScript("https://funldn.com/plan/together");
    expect(replaced).toEqual([]);
    expect(win.__FL_ROOM_INVITE).toBeUndefined();
  });
});

describe("the code is never put back into a URL", () => {
  it("no source file builds a navigable /plan/together?room= URL except the share link", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    // Comments are stripped first: these guards assert about CODE, and the
    // comments in these files deliberately quote the very pattern being
    // banned ("this used to be replaceState(...?room=...)"), so a raw text
    // scan flags the documentation explaining the fix.
    const read = (rel: string) =>
      readFileSync(
        fileURLToPath(new URL(`../../${rel}`, import.meta.url)),
        "utf8",
      )
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
        .replace(/^\s*\/\/.*$/gm, "")
        .replace(/\/\/.*$/gm, "");

    // The resolver and the failure screen must never rebuild it.
    const flow = read("app/(main)/plan/together/together-flow.tsx");
    expect(flow).not.toMatch(/replaceState[\s\S]{0,120}room=/);
    expect(flow).not.toMatch(/href=\{`\/plan\/together\?room=/);
    // And it must read from the stash, not the address bar.
    expect(flow).toContain("readRoomInvite()");
    expect(flow).not.toMatch(/URLSearchParams\(window\.location\.search\)/);

    // The auth wall's return path must be the constant clean one: the code
    // used to ride into /sign-in, /auth/callback, Supabase's redirect_to and
    // the magic-link EMAIL BODY.
    const page = read("app/(main)/plan/together/page.tsx");
    expect(page).toContain('const returnTo = "/plan/together"');
    expect(page).not.toMatch(/returnTo[\s\S]{0,80}room/);

    // The share link is the ONE legitimate producer: it is what an invitee
    // receives, and their own pre-paint script strips it on arrival.
    const lobby = read("app/(main)/plan/together/_steps/lobby.tsx");
    expect(lobby).toContain("room=");
  });
});
