import { describe, it, expect } from "vitest";
import { tidyText, hasControlChars } from "@/lib/text";

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
