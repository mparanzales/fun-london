// A javascript: value must never survive to an href.
//
// safe-url.test.ts proves the helper enforces the rule. This file proves the
// APP is wired to it, in the two ways that can independently rot:
//
//   1. Composition — the exact expressions the venue and event pages build,
//      run end to end over hostile input. This is the real pipeline, including
//      applyAffiliate, which parses with `new URL` and hands its input back
//      unchanged when parsing throws.
//   2. Structure — no href anywhere in app/ or components/ may name a
//      catalogue URL field directly. This is what catches the NEXT sink
//      somebody adds.
//
// The structural half is a source scan, and a source scan cannot prove a
// runtime fact: it shows the sinks are wired, not that a browser refused to
// navigate. It is a regression tripwire on top of (1), not a substitute for it.

import { describe, it, expect } from "vitest";
import { readdirSync, statSync, readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { safeExternalHref } from "@/lib/safe-url";
import { applyAffiliate } from "@/lib/affiliate";
import { buildReserveUrl } from "@/lib/booking-link";

const HOSTILE = [
  "javascript:alert(1)",
  "JavaScript:alert(document.domain)",
  "java\nscript:alert(1)",
  "  javascript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "vbscript:msgbox(1)",
];

const executable = (href: string | null) =>
  href !== null && !/^https?:\/\//.test(href);

describe("composition: the expressions the pages actually build", () => {
  // app/event/[id]/event-detail.tsx — the ticket CTA.
  it.each(HOSTILE)("event ticket CTA drops %j", (raw) => {
    const popup = safeExternalHref(raw);
    const ticketed = safeExternalHref(applyAffiliate("ticketmaster", raw));
    expect(popup).toBeNull();
    expect(ticketed).toBeNull();
  });

  it("event ticket CTA survives applyAffiliate's fail-open on a live payload", () => {
    // The specific reason the guard wraps the FINAL string rather than the
    // source: applyAffiliate parses "javascript:alert(1)//" successfully, adds
    // its utm params, and the trailing "//" comments them out, so what comes
    // back is still executable JavaScript.
    const affiliated = applyAffiliate("ticketmaster", "javascript:alert(1)//");
    expect(affiliated).toContain("javascript:");
    expect(safeExternalHref(affiliated)).toBeNull();
  });

  // app/venue/[slug]/venue-detail.tsx — "See the menu" / "Visit website".
  it("venue site link prefers the menu but is not poisoned by it", () => {
    const menuHref = safeExternalHref("javascript:alert(1)");
    const websiteHref = safeExternalHref("https://example.com/");
    expect(menuHref ?? websiteHref).toBe("https://example.com/");
    // ...and the label follows the link we rendered, so a dropped menu_url
    // cannot leave the button saying "See the menu" while pointing at a
    // homepage.
    expect(menuHref ? "See the menu" : "Visit website").toBe("Visit website");
  });

  it.each(HOSTILE)(
    "venue site link drops %j when there is no website",
    (raw) => {
      expect(safeExternalHref(raw) ?? safeExternalHref(null)).toBeNull();
    },
  );

  // components/reserve-sheet.tsx via lib/booking-link.ts (the PR #226 path,
  // re-pinned here now that it shares the helper).
  it.each(HOSTILE)("buildReserveUrl drops %j", (raw) => {
    const url = buildReserveUrl(
      { platform: "opentable", url: raw },
      { date: "2026-08-07", time: "20:00", party: 2 },
    );
    expect(url).toBeNull();
  });

  it("buildReserveUrl still builds a normal pre-filled link", () => {
    const url = buildReserveUrl(
      { platform: "opentable", url: "https://www.opentable.co.uk/r/x" },
      { date: "2026-08-07", time: "20:00", party: 2 },
    );
    expect(url).toMatch(/^https:\/\//);
    expect(url).toContain("partySize=2");
  });

  it("nothing executable escapes any of these paths", () => {
    for (const raw of HOSTILE) {
      expect(executable(safeExternalHref(raw))).toBe(false);
      expect(
        executable(safeExternalHref(applyAffiliate("ticketmaster", raw))),
      ).toBe(false);
      expect(
        executable(
          buildReserveUrl(
            { platform: "website", url: raw },
            { date: "2026-08-07", time: "20:00", party: 2 },
          ),
        ),
      ).toBe(false);
    }
  });
});

// ── Structural tripwire ──────────────────────────────────────────────────
// Catalogue fields that hold a URL somebody could store a scheme into. Adding
// a new one to the catalogue means adding it here.
const CATALOGUE_URL_FIELDS = [
  "websiteUrl",
  "menuUrl",
  "sourceUrl",
  "mapsUrl",
  "website",
  "website_url",
  "source_url",
  "url",
];
const RAW_FIELD = new RegExp(`\\.(${CATALOGUE_URL_FIELDS.join("|")})\\b`);

const REPO = fileURLToPath(new URL("../../", import.meta.url));

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
}

// Pull each href={ ... } expression out, matching braces so nested JSX and
// template literals stay in one piece.
function hrefExpressions(src: string): { expr: string; line: number }[] {
  const out: { expr: string; line: number }[] = [];
  const re = /href=\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length;
    const start = i;
    let depth = 1;
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      i++;
    }
    out.push({
      expr: src.slice(start, i - 1),
      line: src.slice(0, m.index).split("\n").length,
    });
  }
  return out;
}

describe("structure: no href names a catalogue URL field directly", () => {
  it("every href in app/ and components/ goes through the helper first", () => {
    const files: string[] = [];
    for (const root of ["app", "components"]) walk(join(REPO, root), files);
    // Sanity-check the scanner itself: a walk that silently found nothing
    // would make this test pass while checking absolutely nothing.
    expect(files.length).toBeGreaterThan(50);

    const offenders: string[] = [];
    let scanned = 0;
    for (const file of files) {
      for (const { expr, line } of hrefExpressions(
        readFileSync(file, "utf8"),
      )) {
        scanned++;
        if (RAW_FIELD.test(expr)) {
          offenders.push(
            `${file.replace(REPO, "")}:${line}  href={${expr.replace(/\s+/g, " ").trim()}}`,
          );
        }
      }
    }
    expect(scanned).toBeGreaterThan(20);
    expect(offenders).toEqual([]);
  });

  // 🧨 The scan above only reads what is INSIDE href={...}. On its own it is
  // defeated by one rename: change `const menuHref = safeExternalHref(
  // venue.menuUrl)` to `const menuHref = venue.menuUrl` and every href still
  // names a local, so the whole suite stays green while the sink is live
  // again. (code-reviewer found exactly that hole.) So also require the other
  // direction: wherever a catalogue URL field is READ in app/ or components/,
  // it must be an argument to the helper, or a listed exception.
  it("every read of a catalogue URL field is wrapped or explicitly excepted", () => {
    // Reads that legitimately do not produce an href. Each needs a reason.
    const EXCEPTIONS: { match: RegExp; why: string }[] = [
      {
        match: /providerFromUrl\(event\.sourceUrl\)/,
        why: "reads hostname for a provider LABEL; returns null on a parse throw",
      },
      {
        match: /applyAffiliate\("ticketmaster", event\.sourceUrl \?\? ""\)/,
        why: "inner call; the result is wrapped by safeExternalHref at the sink",
      },
      {
        match: /new URL\(request\.url\)/,
        why: "Next's Request.url, not catalogue data",
      },
      {
        match: /redactRoomCodesInString\(e\.url\)/,
        why: "PostHog event property, not catalogue data",
      },
      {
        match: /\{fr\.website\}|\{p\.source_url\}|\$\{s\.url\}/,
        why: "rendered as TEXT so a reviewer can see the rejected value",
      },
      {
        match:
          /\{!sourceHref && p\.source_url \?|\) : fr\.website \?|s\.url \? `/,
        why: "presence test gating the rejected-value text above",
      },
    ];

    const files: string[] = [];
    for (const root of ["app", "components"]) walk(join(REPO, root), files);

    const READ = new RegExp(`\\.(${CATALOGUE_URL_FIELDS.join("|")})\\b`, "g");
    const offenders: string[] = [];
    let reads = 0;

    for (const file of files) {
      const src = readFileSync(file, "utf8");
      // Drop comments first, so prose mentioning venue.menuUrl is not a read.
      const code = src
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^[ \t]*\/\/.*$/gm, "");
      const lines = code.split("\n");
      READ.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = READ.exec(code))) {
        const lineNo = code.slice(0, m.index).split("\n").length;
        const text = lines[lineNo - 1] ?? "";
        reads++;
        const wrapped =
          /(safeExternalHref|parseExternalUrl)\(\s*[A-Za-z0-9_$?.[\]]*$/.test(
            code.slice(Math.max(0, m.index - 120), m.index),
          );
        if (wrapped) continue;
        if (EXCEPTIONS.some((e) => e.match.test(text))) continue;
        offenders.push(`${file.replace(REPO, "")}:${lineNo}  ${text.trim()}`);
      }
    }

    expect(reads).toBeGreaterThan(15);
    expect(offenders).toEqual([]);
  });
});
