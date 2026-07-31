import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "node:url";
import {
  isoWeek,
  briefForWeek,
  londonAt,
  upcomingFriday19,
  fmtLondonTime,
  NIGHT_AREAS,
  NIGHT_VIBES,
} from "@/lib/digest-night";

// The night of the week is the digest's centrepiece and shipped untested,
// because the script it lived in calls process.exit() at module scope. These
// cover the two things that break silently in an email: the wrong hour for
// five months of the year, and a re-run that contradicts the first send.

describe("the weekly brief is stable and rotates", () => {
  it("gives the same brief twice in one week", () => {
    // A cron that is re-run, or fires twice, must not contradict the email
    // already in someone's inbox.
    const mon = new Date(Date.UTC(2026, 6, 27, 9));
    const thu = new Date(Date.UTC(2026, 6, 30, 21));
    expect(briefForWeek(mon)).toEqual(briefForWeek(thu));
  });

  it("gives a different brief the following week", () => {
    const w1 = new Date(Date.UTC(2026, 6, 27, 9));
    const w2 = new Date(Date.UTC(2026, 7, 3, 9));
    expect(briefForWeek(w1)).not.toEqual(briefForWeek(w2));
  });

  it("only ever picks a real area and a real vibe", () => {
    // Guards the modulo: an off-by-one would hand computePlan an undefined
    // area, and the night section would vanish with no error.
    for (let i = 0; i < 60; i++) {
      const d = new Date(Date.UTC(2026, 0, 1 + i * 7));
      const b = briefForWeek(d);
      expect(NIGHT_AREAS).toContain(b.area);
      expect(NIGHT_VIBES).toContain(b.vibe);
    }
  });

  it("computes ISO weeks, including the year boundary", () => {
    expect(isoWeek(new Date(Date.UTC(2026, 0, 1)))).toBe(1);
    expect(isoWeek(new Date(Date.UTC(2026, 6, 30)))).toBe(31);
    // 2027-01-01 is a Friday, so it belongs to week 53 of 2026.
    expect(isoWeek(new Date(Date.UTC(2027, 0, 1)))).toBe(53);
  });
});

describe("London time survives the BST/GMT switch", () => {
  it("reads 7pm on the wall clock in summer AND winter", () => {
    // BST (UTC+1) in July, GMT (UTC+0) in January. A hardcoded offset would
    // put every arrival time in the email an hour out for half the year.
    const july = londonAt(2026, 6, 31, 19);
    const jan = londonAt(2026, 0, 15, 19);
    expect(fmtLondonTime(july)).toBe("7:00 PM");
    expect(fmtLondonTime(jan)).toBe("7:00 PM");
    // Proof the two are genuinely different instants relative to UTC.
    expect(july.getUTCHours()).toBe(18);
    expect(jan.getUTCHours()).toBe(19);
  });

  it("formats to pure ASCII, whatever the platform's ICU does", () => {
    // en-GB joins with a plain space TODAY, so this cannot distinguish
    // parts-assembly from Intl.format on this machine. It is a forward guard:
    // en-US-style locales use U+202F before the meridiem and ICU has changed
    // this before. An invisible non-ASCII character in an email is the exact
    // failure class the digest was just repaired for.
    const s = fmtLondonTime(londonAt(2026, 6, 31, 21));
    expect(s).toBe("9:00 PM");
    expect(s).not.toContain(" ");
    expect(s).not.toContain(" ");
    expect([...s].every((c) => c.codePointAt(0)! < 128)).toBe(true);
  });

  it("always lands on a future Friday, never today", () => {
    // A Friday send must point at NEXT Friday, not the one starting in an
    // hour, or the email advertises a night that is already underway.
    for (const iso of [
      "2026-07-27T09:00:00Z", // Monday
      "2026-07-31T09:00:00Z", // Friday
      "2026-08-02T23:00:00Z", // Sunday
    ]) {
      const now = new Date(iso);
      const f = upcomingFriday19(now);
      const day = (d: Date) =>
        new Intl.DateTimeFormat("en-GB", {
          timeZone: "Europe/London",
          weekday: "long",
          day: "2-digit",
          month: "2-digit",
        }).format(d);
      expect(f.getTime()).toBeGreaterThan(now.getTime());
      expect(day(f)).toContain("Friday");
      expect(fmtLondonTime(f)).toBe("7:00 PM");
      // The load-bearing assertion. Sending ON a Friday must point at NEXT
      // Friday: today's 7pm is still technically in the future, so a
      // greater-than check alone passes while advertising a night that
      // starts in hours. The DATE has to differ.
      expect(day(f)).not.toBe(day(now));
    }
  });
});

describe("the digest's duplicated catalogue contract cannot drift", () => {
  // scripts/send-weekly-digest.ts re-declares VENUE_PLAN_COLUMNS and its own
  // row mapper, because lib/queries.ts pulls in the Next server runtime
  // (next/headers) which does not exist under tsx. Duplication is the correct
  // call there, but a silent divergence would hand computePlan venues missing
  // the fields it ranks on, and the night would quietly get worse rather than
  // fail. This is the same parity trap that let a cron undo a venue fix daily.
  const read = (p: string) =>
    readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

  const cols = (src: string) => {
    const m = src.match(/VENUE_PLAN_COLUMNS\s*=\s*\n?\s*"([^"]+)"/);
    return m
      ? m[1]!
          .split(",")
          .map((c) => c.trim())
          .sort()
      : null;
  };

  it("declares the same column set in both places", () => {
    const fromQueries = cols(read("../queries.ts"));
    const fromScript = cols(read("../../scripts/send-weekly-digest.ts"));
    expect(
      fromQueries,
      "queries.ts VENUE_PLAN_COLUMNS not found",
    ).not.toBeNull();
    expect(fromScript, "digest VENUE_PLAN_COLUMNS not found").not.toBeNull();
    expect(fromScript).toEqual(fromQueries);
  });

  it("keeps the digest's night logic out of the untestable script", () => {
    // If these drift back into the script they lose their coverage silently.
    const script = read("../../scripts/send-weekly-digest.ts");
    expect(script).toMatch(/from "@\/lib\/digest-night"/);
    expect(script).not.toMatch(/^function isoWeek/m);
    expect(script).not.toMatch(/^function londonAt/m);
  });
});
