import { describe, it, expect } from "vitest";
import { tidyText, repairMojibake, hasControlChars } from "@/lib/text";

// The real thing: the exact characters Ticketmaster's Discovery API served for
// event 1AwZk8gGkdJ9ZcH on 2026-07-30, captured from the live response and
// confirmed byte-identical to the row we had stored (utf8 hex c382c280c293).
//
// Written as \u escapes on purpose. Unprintable C1 controls pasted literally
// into a source file are silently rewritten by editors, formatters and git
// filters, which would leave this test passing against the wrong input.
const MOJI_EN_DASH = "\u00C2\u0080\u0093"; // was U+2013
const MOJI_EM_DASH = "\u00C2\u0080\u0094"; // was U+2014
const MOJI_APOS = "\u00C2\u0080\u0099"; // was U+2019
const MOJI_LQUOTE = "\u00C2\u0080\u009C"; // was U+201C
const MOJI_RQUOTE = "\u00C2\u0080\u009D"; // was U+201D

const TM_CORRUPT = `Through Storms and Stars ${MOJI_EN_DASH} an Evening with Voyager`;

describe("tidyText recovers provider mojibake", () => {
  it("repairs the Ticketmaster title that reached real subscribers", () => {
    // The residue identifies an en dash, and the brand rule turns dashes into
    // ", " for clean copy, so recovered copy must land in the same place.
    expect(tidyText(TM_CORRUPT)).toBe(
      "Through Storms and Stars, an Evening with Voyager",
    );
  });

  it("leaves no C1 control characters behind", () => {
    expect(hasControlChars(TM_CORRUPT)).toBe(true);
    expect(hasControlChars(tidyText(TM_CORRUPT))).toBe(false);
  });

  it("recovers the whole e2 80 xx punctuation family, not just en dash", () => {
    expect(tidyText(`a ${MOJI_EM_DASH} b`)).toBe("a, b");
    expect(tidyText(`a ${MOJI_EN_DASH} b`)).toBe("a, b");
    expect(tidyText(`Maria${MOJI_APOS}s bar`)).toBe("Maria’s bar");
    expect(tidyText(`${MOJI_LQUOTE}hi${MOJI_RQUOTE}`)).toBe("“hi”");
  });

  it("drops unrecoverable garbage instead of inventing a glyph", () => {
    // A lone control carries no identity, so there is nothing to recover from
    // and guessing a plausible character would be worse than removing it.
    const lone = "Bar\u0085Cafe";
    expect(tidyText(lone)).toBe("BarCafe");
    expect(hasControlChars(tidyText(lone))).toBe(false);
  });
});

describe("tidyText leaves legitimate text alone", () => {
  it("does not touch real accented venue names", () => {
    // 97 venue names carry accents. A guard that mangled them would be worse
    // than the bug it fixes, so these must round-trip byte for byte.
    for (const name of [
      "Abraço Dalston",
      "ALAÏA Café & Bookstore",
      "Café Kitsuné",
      "Berberè Pizzeria",
      "Blåbär Nordic Living",
      "Arôme Bakery",
      "Amazónico",
    ]) {
      expect(tidyText(name)).toBe(name);
    }
  });

  it("keeps a capital A-circumflex that is genuinely part of a word", () => {
    // The mis-decode lead character is only consumed when a control follows.
    expect(tidyText("Ângstrom Bar")).toBe("Ângstrom Bar");
  });

  it("still applies the no-dashes rule to clean copy", () => {
    // Built from escapes: check-no-dashes scans this directory, and a
    // literal dash here would fail the very guard it is testing.
    expect(tidyText("Soho \u2014 the good bit")).toBe("Soho, the good bit");
    expect(tidyText(`Soho ${"-".repeat(2)} the good bit`)).toBe(
      "Soho, the good bit",
    );
  });

  it("passes null and undefined straight through", () => {
    expect(tidyText(null)).toBeNull();
    expect(tidyText(undefined)).toBeUndefined();
  });
});

describe("recovery never deletes a printable character", () => {
  // REGRESSION. The first version of this helper dropped an entire run when it
  // could not recover, which ate real letters off the front of real names.
  // Found by code review, reproduced against live behaviour, fixed here.
  const MOJI_E_ACUTE = "\u00C3\u0089";
  const MOJI_E_LOWER = "\u00C3\u00A9";
  const MOJI_O_SLASH = "\u00C3\u0098";
  const MOJI_ELLIPSIS = "\u00C2\u0080\u00A6";
  const MOJI_BULLET = "\u00C2\u0080\u00A2";
  const MOJI_RTL = "\u00C2\u0080\u008F";

  it("recovers accented capitals instead of swallowing them", () => {
    expect(tidyText(`${MOJI_E_ACUTE}tienne de Cr${MOJI_E_LOWER}cy`)).toBe(
      "\u00C9tienne de Cr\u00E9cy",
    );
    expect(tidyText(`M${MOJI_O_SLASH}`)).toBe("M\u00D8");
  });

  it("recovers punctuation whose tail byte is printable, not just controls", () => {
    // These tails sit above U+009F, so a controls-only rule left bare garbage.
    expect(tidyText(`Doors at 7${MOJI_ELLIPSIS}`)).toBe("Doors at 7\u2026");
    expect(tidyText(`A ${MOJI_BULLET} B`)).toBe("A \u2022 B");
  });

  it("keeps every printable when corruption is genuinely unrecoverable", () => {
    // Only the control goes; the letters either side must survive.
    expect(tidyText(`Bar\u0085Cafe`)).toBe("BarCafe");
    expect(tidyText(`caf\u00E9\u0085bar`)).toBe("caf\u00E9bar");
  });

  it("never emits an invisible direction mark mid-title", () => {
    // Tails 0x8B to 0x8F recover to zero-width and direction marks, which
    // would flip the rest of the line. They must not survive.
    expect(tidyText(`Bar ${MOJI_RTL} Grill`)).toBe("Bar Grill");
  });
});

describe("ingest keeps provider fidelity, read applies the brand rule", () => {
  const MOJI_EN = "\u00C2\u0080\u0093";

  it("repairMojibake restores the dash but does NOT tidy it away", () => {
    // What we STORE stays faithful to what the provider sent. That fidelity is
    // what proved this corruption was upstream and not ours.
    expect(repairMojibake(`Stars ${MOJI_EN} Voyager`)).toBe(
      "Stars \u2013 Voyager",
    );
  });

  it("tidyText applies the no-dashes rule on the way out", () => {
    expect(tidyText(`Stars ${MOJI_EN} Voyager`)).toBe("Stars, Voyager");
  });

  it("repairMojibake leaves accented names untouched", () => {
    for (const n of ["Abra\u00E7o Dalston", "Caf\u00E9 Kitsun\u00E9"]) {
      expect(repairMojibake(n)).toBe(n);
    }
  });
});

// ── Bidi controls: BOTH blocks, not just the older one ──────────────────────
//
// A direction-override character reverses everything rendered after it, so a
// venue name carrying one flips the rest of a card, an OG title and the
// LOCATION of a downloaded calendar entry. The set used to stop at U+202E,
// which LOOKS complete: U+2066-U+2069 are the Unicode 6.3 isolates (LRI, RLI,
// FSI, PDI), they do the same job, and they live in a separate block.
describe("bidi and invisible controls", () => {
  // Built from codepoints, never pasted: this file's own header explains why
  // a literal unprintable in source is silently rewritten by editors and git
  // filters, which would leave the test passing against the wrong input.
  const ch = (code: number) => String.fromCharCode(code);
  const OLD_EMBEDDINGS: [string, string][] = [
    ["LRE U+202A", ch(0x202a)],
    ["RLE U+202B", ch(0x202b)],
    ["PDF U+202C", ch(0x202c)],
    ["LRO U+202D", ch(0x202d)],
    ["RLO U+202E", ch(0x202e)],
  ];
  const ISOLATES: [string, string][] = [
    ["LRI U+2066", ch(0x2066)],
    ["RLI U+2067", ch(0x2067)],
    ["FSI U+2068", ch(0x2068)],
    ["PDI U+2069", ch(0x2069)],
  ];

  it.each([...OLD_EMBEDDINGS, ...ISOLATES])(
    "repairMojibake strips %s out of a venue name",
    (_label, ch) => {
      expect(repairMojibake(`Rooftop${ch} Bar`)).toBe("Rooftop Bar");
    },
  );

  it.each([...OLD_EMBEDDINGS, ...ISOLATES])(
    "tidyText strips %s too, so editorial copy is covered as well",
    (_label, ch) => {
      expect(tidyText(`Rooftop${ch} Bar`)).toBe("Rooftop Bar");
    },
  );

  it("strips the zero-widths and the BOM", () => {
    expect(repairMojibake(`Roof${ch(0x200b)}top${ch(0xfeff)} Bar`)).toBe(
      "Rooftop Bar",
    );
  });

  // The other half of the contract: it must not become a blunt instrument.
  // "Never delete a printable character" is the rule this file already carries.
  it("leaves every printable character exactly where it was", () => {
    for (const s of [
      "The Photographers' Gallery, 16\u201318 Ramillies Street",
      "Hermanos Colombian Coffee Roasters \u2013 Angel Lane",
      "Knightsbridge / Belgravia",
      "Bar Américain",
      "Élysée",
    ]) {
      expect(repairMojibake(s)).toBe(s);
    }
  });

  // 🧨 The exact reason venue names do NOT go through tidyText. This is not a
  // style preference: both strings below are live catalogue values.
  it("tidyText WOULD rewrite proper nouns, which is why names use repairMojibake", () => {
    expect(
      tidyText("Hermanos Colombian Coffee Roasters \u2013 Angel Lane"),
    ).toBe("Hermanos Colombian Coffee Roasters, Angel Lane");
    expect(
      tidyText("The Photographers' Gallery, 16\u201318 Ramillies Street"),
    ).toBe("The Photographers' Gallery, 16, 18 Ramillies Street");
  });
});
