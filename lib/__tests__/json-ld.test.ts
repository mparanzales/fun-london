// A catalogue string must never be able to close the JSON-LD <script> block.
//
// Behavioural, plus a structural tripwire that no page goes back to raw
// JSON.stringify inside dangerouslySetInnerHTML.

import { describe, it, expect } from "vitest";
import { readdirSync, statSync, readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { jsonLdHtml } from "@/lib/json-ld";

const REPO = fileURLToPath(new URL("../../", import.meta.url));

describe("jsonLdHtml", () => {
  it("escapes the closing script tag a venue name could carry", () => {
    const out = jsonLdHtml({
      name: "Bar </script><script>alert(1)</script>",
    });
    // The literal sequence that ends a script element must not appear.
    expect(out.toLowerCase()).not.toContain("</script");
    expect(out).not.toContain("<");
  });

  it("escapes < wherever it appears, not just before /script", () => {
    const out = jsonLdHtml({ description: "a < b", url: "x<y" });
    expect(out).not.toContain("<");
    expect(out).toContain("\\u003c");
  });

  it("still parses back to exactly the same data", () => {
    // The escape must be meaning-preserving: every JSON-LD consumer has to
    // read the same object we serialised.
    const data = {
      "@context": "https://schema.org",
      name: "Bar </script><script>alert(1)</script>",
      description: "5 < 6 & 7 > 2",
      nested: { url: "https://example.com/a?b=1&c=<2" },
    };
    expect(JSON.parse(jsonLdHtml(data))).toEqual(data);
  });

  it("escapes the JS line separators", () => {
    const name = "a\u2028b\u2029c";
    const out = jsonLdHtml({ name });
    expect(out).not.toContain("\u2028");
    expect(out).not.toContain("\u2029");
    expect(JSON.parse(out).name).toBe(name);
  });
});

describe("structure: no page serialises JSON-LD with raw JSON.stringify", () => {
  it("every dangerouslySetInnerHTML JSON-LD block uses the helper", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === ".next") continue;
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(p)) files.push(p);
      }
    };
    // components/ too: a JSON-LD block that moves out of app/ must not become
    // invisible to this check.
    for (const root of ["app", "components"]) walk(join(REPO, root));
    expect(files.length).toBeGreaterThan(50);

    // Anchor on the ld+json script element, then read whatever that element
    // feeds to __html. Matching only the literal "__html: JSON.stringify("
    // missed `const ld = JSON.stringify(x); ... __html: ld` and every other
    // serialiser; anchoring on __html alone is too wide, because layout.tsx
    // legitimately inlines the anti-flash theme script and the room-invite
    // script, neither of which is JSON-LD.
    const offenders: string[] = [];
    let blocks = 0;
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const re = /application\/ld\+json/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        blocks++;
        // The __html for this element sits within the next few lines.
        const after = src.slice(m.index, m.index + 400);
        const html = after.match(/__html:\s*([^}]+)\}/);
        const expr = html ? html[1].trim() : "(no __html found)";
        if (html && expr.includes("jsonLdHtml(")) continue;
        offenders.push(
          `${f.replace(REPO, "")}  ld+json __html: ${expr.replace(/\s+/g, " ").slice(0, 60)}`,
        );
      }
    }
    // Every known JSON-LD block must be seen; a regex that matched nothing
    // would pass this test while checking nothing.
    expect(blocks).toBeGreaterThanOrEqual(3);
    expect(offenders).toEqual([]);
  });
});
