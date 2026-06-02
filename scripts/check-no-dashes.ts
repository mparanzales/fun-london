// Guard: no em dashes (—), en dashes (–), or spaced double hyphens ( -- ) in
// USER-FACING text. They read as machine-written and clutter the brand voice.
//
// It strips code comments first (line, block, and JSX {/* */}) so dashes in
// developer comments are ignored — only text a user could actually see is
// flagged. CSS custom properties like --fl-bg are NOT matched (we only catch
// the typographic dashes and a SPACED double hyphen, never bare "--").
//
// Wired into `pnpm check`. Fix offenders with a full stop, comma, or middot (·).

import { readdirSync, statSync, readFileSync } from "fs";
import { join } from "path";

const ROOTS = ["app", "components", "lib"];
const EXT = /\.(ts|tsx)$/;
const BAD: { re: RegExp; name: string }[] = [
  { re: /—/, name: "em dash (—)" },
  { re: /–/, name: "en dash (–)" },
  { re: / -- /, name: "double hyphen ( -- )" },
];

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXT.test(p)) out.push(p);
  }
}

// Remove comment text from one line, tracking multi-line block state so line
// numbers stay accurate. Leaves user-facing strings/JSX intact.
function stripComments(line: string, state: { inBlock: boolean }): string {
  let res = "";
  let i = 0;
  while (i < line.length) {
    if (state.inBlock) {
      const end = line.indexOf("*/", i);
      if (end === -1) return res;
      i = end + 2;
      state.inBlock = false;
      continue;
    }
    if (line[i] === "/" && line[i + 1] === "*") {
      state.inBlock = true;
      i += 2;
      continue;
    }
    // Line comment — but ignore the // inside URLs like https://
    if (line[i] === "/" && line[i + 1] === "/" && line[i - 1] !== ":") {
      return res;
    }
    res += line[i];
    i += 1;
  }
  return res;
}

const files: string[] = [];
for (const root of ROOTS) {
  try {
    walk(root, files);
  } catch {
    // root may not exist in some setups
  }
}

let count = 0;
for (const file of files) {
  const lines = readFileSync(file, "utf8").split("\n");
  const state = { inBlock: false };
  lines.forEach((line, idx) => {
    const code = stripComments(line, state);
    for (const bad of BAD) {
      if (bad.re.test(code)) {
        count += 1;
        console.log(`${file}:${idx + 1}  ${bad.name}\n    ${code.trim().slice(0, 90)}`);
      }
    }
  });
}

if (count > 0) {
  console.error(
    `\n✗ ${count} dash(es) found in user-facing text. Replace with a full stop, comma, or middot (·).`,
  );
  process.exit(1);
}
console.log("✓ no em/en dashes or ' -- ' in user-facing text");
