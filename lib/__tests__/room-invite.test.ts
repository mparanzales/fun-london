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

// How this DOCUMENT was entered. A RESUME entry is honoured only on "reload" /
// "back_forward"; an INVITE is honoured on any of them. Default to "navigate",
// the ordinary case, so a test that means to exercise resume has to say so.
function stubNavigation(type: NavigationTimingType = "navigate") {
  vi.stubGlobal("performance", {
    getEntriesByType: (k: string) => (k === "navigation" ? [{ type }] : []),
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
  stubWindow();
  stubNavigation();
  // Each test is a fresh DOCUMENT. The once-per-document rule lives in module
  // state, and the module is imported once for the whole file, so without this
  // the first test to read a code would leave every later one reading null.
  clearRoomInvite();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the stash round-trips a code", () => {
  it("arms and reads back", () => {
    armRoomInvite(CODE, "invite");
    expect(readRoomInvite()).toBe(CODE);
  });

  it("is NOT one-shot ACROSS RELOADS: each reload rejoins the same room", async () => {
    // A one-shot-forever read would consume the code on first load and drop the
    // next reload into a brand new empty room. That is worse for the user than
    // the code sitting in same-origin storage that is never transmitted.
    //
    // A reload is a NEW DOCUMENT, so it is modelled as a fresh module: the
    // once-per-document rule lives in module state, and simulating a reload by
    // calling read() twice in one module would be testing the opposite thing.
    stubNavigation("reload");
    armRoomInvite(CODE);
    for (let reload = 0; reload < 3; reload++) {
      vi.resetModules();
      const mod = await import("@/lib/room-invite");
      expect(mod.readRoomInvite()).toBe(CODE);
    }
  });

  it("hands a code out ONCE per document", () => {
    // 🧨 Two review findings reduce to this. An invite was never consumed, so
    // after a failed retry it stayed honourable and a later "Start a session
    // ->" dropped the user back into the abandoned room. And because
    // isResumeNavigation() is a document-level fact, one pull-to-refresh
    // licensed every later client navigation in that document to do the same.
    stubNavigation("reload");
    armRoomInvite(CODE);
    expect(readRoomInvite()).toBe(CODE); // the resolver, on mount
    expect(readRoomInvite()).toBeNull(); // a remount after a client nav
    expect(readRoomInvite()).toBeNull();
  });

  it("does not re-honour an INVITE later in the same document either", () => {
    stubNavigation("navigate");
    armRoomInvite(CODE, "invite");
    expect(readRoomInvite()).toBe(CODE);
    expect(readRoomInvite()).toBeNull();
  });

  it("uppercases and trims what it is given", () => {
    armRoomInvite("  k4wp2x  ", "invite");
    expect(readRoomInvite()).toBe(CODE);
  });

  it("refuses a code that is not the right shape", () => {
    for (const bad of ["", "SHORT", "TOOLONG7", "K4WP2!", "<script>"]) {
      clearRoomInvite();
      armRoomInvite(bad, "invite");
      expect(readRoomInvite()).toBeNull();
    }
  });

  it("expires", () => {
    vi.useFakeTimers();
    armRoomInvite(CODE, "invite");
    vi.advanceTimersByTime(61 * 60 * 1000);
    expect(readRoomInvite()).toBeNull();
  });

  it("removes an expired entry rather than re-parsing it forever", () => {
    vi.useFakeTimers();
    armRoomInvite(CODE, "invite");
    vi.advanceTimersByTime(61 * 60 * 1000);
    readRoomInvite();
    expect([...store.values()].join("")).not.toContain(CODE);
  });

  it("keeps a RESUME alive as long as the room itself", () => {
    // 🧨 A resume TTL shorter than the room's 6 hours silently FORKS a live
    // room: leave the tab open past it (or let iOS discard and reload a
    // backgrounded tab) and the reload makes the user host of a new empty room
    // while their friends are still in the old one, with no error shown.
    vi.useFakeTimers();
    stubNavigation("reload");
    armRoomInvite(CODE); // a resume
    vi.advanceTimersByTime(5 * 60 * 60 * 1000); // 5h: room still alive
    expect(readRoomInvite()).toBe(CODE);
  });

  it("still expires a resume once the room could not exist", () => {
    vi.useFakeTimers();
    stubNavigation("reload");
    armRoomInvite(CODE);
    vi.advanceTimersByTime(7 * 60 * 60 * 1000); // past the 6h room lifetime
    expect(readRoomInvite()).toBeNull();
  });

  it("survives the whole magic-link round trip", () => {
    // The first version expired at 15 minutes measured from the original tap
    // and never refreshed at the sign-in wall, which is inside the time a slow
    // inbox takes. Running out is indistinguishable from success to the user.
    vi.useFakeTimers();
    armRoomInvite(CODE, "invite");
    vi.advanceTimersByTime(30 * 60 * 1000);
    expect(readRoomInvite()).toBe(CODE);
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
    expect(() => armRoomInvite(CODE, "invite")).not.toThrow();
    // The in-memory copy still carries this document.
    expect(readRoomInvite()).toBe(CODE);
  });
});

describe("sign-out must drop it", () => {
  it("clears both the global and storage", () => {
    armRoomInvite(CODE, "invite");
    clearRoomInvite();
    expect(readRoomInvite()).toBeNull();
    expect([...store.values()].join("")).not.toContain(CODE);
  });
});

describe("an INVITE and a RESUME are not the same thing", () => {
  // 🧨 THE REGRESSION THIS PINS, caught in review before merge. Both reasons a
  // code can be in the stash used to be stored identically, so finishing a room
  // and then tapping "Start a session ->" read the code straight back and
  // returned the user to the room they had just left, with the old roster and
  // no way out ("End this room" is host-only). Before the stash existed the
  // same journey made a new room, because the resolver read `?room=` from a URL
  // that a fresh /plan/together does not have.

  it("does NOT resume a finished room on a deliberate fresh start", () => {
    stubNavigation("navigate"); // "Start a session ->", not a reload
    armRoomInvite(CODE); // written by a previous create/join
    expect(readRoomInvite()).toBeNull(); // so: start a NEW room
  });

  it("DOES resume it on a reload", () => {
    stubNavigation("reload");
    armRoomInvite(CODE);
    expect(readRoomInvite()).toBe(CODE);
  });

  it("resumes on back/forward too, including a bfcache restore", () => {
    stubNavigation("back_forward");
    armRoomInvite(CODE);
    expect(readRoomInvite()).toBe(CODE);
  });

  it("honours an INVITE on a plain navigation, which is the whole point", () => {
    // Someone sent this person a link. They opened it. That is a deliberate
    // request to be in that room and it must never be second-guessed.
    stubNavigation("navigate");
    armRoomInvite(CODE, "invite");
    expect(readRoomInvite()).toBe(CODE);
  });

  it("keeps a refused resume for the reload it exists for", () => {
    // The refusal must not delete the entry. Collapsing "stale" and "not now"
    // into one branch deleted it on the first client navigation, so the next
    // genuine reload had nothing left to resume.
    stubNavigation("navigate");
    armRoomInvite(CODE);
    expect(readRoomInvite()).toBeNull();
    expect([...store.values()].join("")).toContain(CODE); // still there
    stubNavigation("reload");
    expect(readRoomInvite()).toBe(CODE);
  });

  it("treats an entry with no source as a resume, the conservative reading", () => {
    // Written by the previous deploy, before the field existed. It must not be
    // able to hijack a fresh start.
    stubNavigation("navigate");
    store.set(
      "fl.room.invite.v1",
      JSON.stringify({ c: CODE, t: Date.now() }), // no `s`
    );
    expect(readRoomInvite()).toBeNull();
  });

  it("fails CLOSED when the Performance API says nothing", () => {
    // A refused resume costs a new empty room. An over-eager one silently puts
    // somebody in a room they did not ask for.
    vi.stubGlobal("performance", {
      getEntriesByType: () => [],
    });
    armRoomInvite(CODE);
    expect(readRoomInvite()).toBeNull();
  });

  it("never throws when there is no Performance API at all", () => {
    vi.stubGlobal("performance", undefined);
    armRoomInvite(CODE);
    expect(() => readRoomInvite()).not.toThrow();
    expect(readRoomInvite()).toBeNull();
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

  it("marks it an INVITE, so it survives the navigation it arrived on", () => {
    // A code out of a URL is somebody's deliberate request to join. Stored as
    // a resume it would be refused on the very navigation that carried it,
    // because opening a link is a "navigate" and not a "reload".
    const { win } = runScript(`https://funldn.com/plan/together?room=${CODE}`);
    expect((win.__FL_ROOM_INVITE as { s?: string })?.s).toBe("i");
    stubNavigation("navigate");
    expect(readRoomInvite()).toBe(CODE);
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

  it("STRIPS on every other route, but stashes nothing there", () => {
    // 🧨 The strip used to be pathname-guarded as well, which left the channel
    // this whole change exists to close wide open on every other route:
    // posthog freezes location.href into $initial_person_info on a browser's
    // first pageview and posts it as $initial_current_url on every /flags
    // request afterwards, and /flags never goes through the capture path. A
    // code on /explore was therefore permanent.
    for (const path of ["/explore", "/venue/padella", "/plan", "/"]) {
      const { replaced, win } = runScript(
        `https://funldn.com${path}?room=${CODE}`,
      );
      expect(replaced).toEqual([path]);
      expect(replaced.join("")).not.toContain(CODE);
      // But it is not an invite: nobody asked to join anything by loading
      // /explore, so arming one here would hijack their next visit.
      expect(win.__FL_ROOM_INVITE).toBeUndefined();
      expect([...store.values()].join("")).not.toContain(CODE);
    }
  });

  it("keeps other params intact when stripping off-route", () => {
    const { replaced } = runScript(
      `https://funldn.com/explore?area=soho&room=${CODE}&vibe=lively`,
    );
    expect(replaced[0]).toContain("area=soho");
    expect(replaced[0]).toContain("vibe=lively");
    expect(replaced[0]).not.toContain(CODE);
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

    // The retry ASSIGNS a location rather than reloading, so it has to arm an
    // invite. Armed as the default resume, the resolver would refuse the entry
    // the retry had just written and open a new empty room instead.
    expect(flow).toMatch(/armRoomInvite\([^)]*,\s*"invite"\s*\)/);

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
