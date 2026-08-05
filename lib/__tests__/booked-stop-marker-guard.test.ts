import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Guard: the "Booking opened here" marker is a SIBLING of the stop notice,
// never nested inside it.
//
// WHY THIS EXISTS. This exact line regressed TWICE in PR #226 with the whole
// suite green. Nested inside `{stopNotice(i) && (...)}` the marker only
// rendered on a shut or option-less stop — the one stop nobody books — so the
// feature the PR is named for was invisible on every healthy stop, and the
// scroll-on-return was a permanent no-op because the ref never attached. The
// second regression shipped a comment CLAIMING the hoist while the JSX stayed
// nested. A framework-free suite cannot render this screen, so the render
// structure gets pinned at the source level, per the repo's guard convention.
describe("🧨 the booked-stop marker renders on healthy stops", () => {
  const src = readFileSync(
    fileURLToPath(
      new URL("../../app/(main)/plan/plan-flow.tsx", import.meta.url),
    ),
    "utf8",
  )
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("attaches the marker BEFORE the stop-notice conditional opens", () => {
    // Positive controls first: both anchors must exist, or the assertion
    // below would pass vacuously on a refactor that renamed either.
    const markerAt = src.indexOf("ref={bookedStopRef}");
    const noticeAt = src.indexOf("{stopNotice(i) && (");
    expect(
      markerAt,
      "marker JSX (ref={bookedStopRef}) not found",
    ).toBeGreaterThan(-1);
    expect(
      noticeAt,
      "stop-notice conditional render not found",
    ).toBeGreaterThan(-1);
    // The invariant: the marker's ref attaches at a lower index than the
    // notice conditional opens, so it cannot be inside that block. Re-nesting
    // it (the regression, both times) puts the ref after the opener.
    expect(
      markerAt,
      "the booked-stop marker is nested inside {stopNotice(i) && ...} again: " +
        "it will only render on shut or option-less stops",
    ).toBeLessThan(noticeAt);
  });

  it("sits at the notice's own nesting depth, not inside another conditional", () => {
    // Order alone would stay green if the marker moved ABOVE the notice but
    // INSIDE some other conditional (say closedStops.includes(i)) — the
    // original symptom class with a different wrapper. Prettier normalises
    // indentation (the format gate enforces it), so equal leading whitespace
    // on the two openers pins equal JSX depth.
    const lines = src.split("\n");
    const markerLine = lines.find((l) =>
      l.includes("{bookedStop?.slug === s.venue.slug &&"),
    );
    const noticeLine = lines.find((l) => l.includes("{stopNotice(i) && ("));
    expect(markerLine, "marker conditional opener not found").toBeDefined();
    expect(noticeLine, "notice conditional opener not found").toBeDefined();
    const indent = (l: string) => (l.match(/^\s*/) ?? [""])[0].length;
    expect(
      indent(markerLine!),
      "the marker opener is indented differently from the notice opener: " +
        "it has been nested inside another conditional",
    ).toBe(indent(noticeLine!));
  });

  it("keys the marker on the venue slug, not the stop index", () => {
    // A replaced or dropped stop shifts indices while the user is away
    // booking; the slug follows the venue. The stored stopIndex is an
    // analytics dimension only.
    expect(src).toContain("bookedStop?.slug === s.venue.slug");
  });
  it("is scoped to its night by explicit clearing, not captured identity", () => {
    // 🧨 The 1a518a1 identity guard compared an object captured in the mount
    // passive effect against editKey — but the restore's re-render flushes
    // AFTER that capture, so the comparison was false on every real return
    // and the marker never rendered (both reviewers, independently). The
    // durable rule: every night SWITCH clears bookedStop. standDown covers
    // rebuild/reshuffle/Edit-anyway; activate covers reopen-saved and claim
    // (safe at mount because layout effects run before passive ones).
    expect(src).not.toContain("bookedNightKeyRef");
    // standDown's body is brace-flat, so a non-greedy capture to its closing
    // `}, []);` is safe here (unlike the sign-out block's first-brace trap).
    const standDown = src.match(
      /const standDown = useCallback\(\(\) => \{([\s\S]*?)\}, \[\]\);/,
    );
    expect(standDown, "standDown not found").not.toBeNull();
    expect(standDown![1]).toContain("setBookedStop(null)");
    // activate: the clear must sit immediately ahead of the night switch.
    expect(
      /setBookedStop\(null\);[\s\S]{0,700}setActive\(\{/.test(src),
      "activate() no longer clears the marker before switching nights",
    ).toBe(true);
  });

  it("reports the return only when the screen showed something", () => {
    // The consumption-time event fired even when the marked stop had been
    // replaced while the user was away and nothing rendered — 100% of events
    // described an invisible return. The event now carries marker_shown,
    // decided at the render, where the ref tells the truth.
    expect(/plan_book_return", \{[\s\S]{0,200}marker_shown/.test(src)).toBe(
      true,
    );
  });
});

describe("the write sites only record what actually happened", () => {
  const sheet = readFileSync(
    fileURLToPath(
      new URL("../../components/reserve-sheet.tsx", import.meta.url),
    ),
    "utf8",
  );
  const detail = readFileSync(
    fileURLToPath(
      new URL("../../app/venue/[slug]/venue-detail.tsx", import.meta.url),
    ),
    "utf8",
  );
  const confirmed = readFileSync(
    fileURLToPath(
      new URL(
        "../../app/booking/[slug]/confirmed/did-you-book.tsx",
        import.meta.url,
      ),
    ),
    "utf8",
  );

  it("the ReserveSheet hands off through a real anchor, never window.open", () => {
    // 🧨 window.open with "noopener,noreferrer" in the features string
    // returns null BY SPEC even when the tab opens (HTML window-open steps:
    // noopener -> return null), so the 1a518a1 open-detection suppressed the
    // marker on every successful handoff — and dropping the tokens to get a
    // handle back would give the partner page a live window.opener. A
    // user-gesture anchor is not popup-blocked and degrades to an in-place
    // navigation in webviews, so the site is REACHED either way and the
    // marker written on the click stays honest.
    expect(sheet).not.toContain("window.open(");
    expect(sheet).toContain('target="_blank"');
    expect(sheet).toContain('rel="noopener noreferrer"');
    expect(sheet).toContain("href={reserveUrl}");
    // The write is gated on plan provenance only — no open-detection clause.
    expect(
      /if \(fromPlan && stopIndex !== null\) \{\s*writeBookingReturn\(venue\.slug, stopIndex\);/.test(
        sheet,
      ),
    ).toBe(true);
  });

  it("the website door needs all four clauses, none deletable", () => {
    // 481afdd's rule: for a PARTNER venue the website visit is a look, not a
    // booking; the MENU is never a booking door; a non-reservable venue has
    // no bookings at all. Deleting any clause previously left the whole
    // suite green (code-reviewer, 2026-08-06) -- this pins the condition.
    const cond = detail.match(
      /if \(\s*planHandoff &&\s*!venue\.menuUrl &&\s*isReservable &&\s*!topBookingLink\s*\)/,
    );
    expect(
      cond,
      "the four-clause website-door condition has been edited or removed",
    ).not.toBeNull();
    // Positive control.
    expect(detail).toContain(
      "writeBookingReturn(venue.slug, planHandoff.stopIndex)",
    );
  });

  it("the Did-you-book screen PEEKS the marker and offers the door back", () => {
    // Peek, never read: /plan owns the one-shot consumption. And the door
    // must exist -- the screen between the booking and the plan not
    // mentioning the plan was the blocker that made the feature unreachable
    // on its main path.
    expect(confirmed).toContain("peekBookingReturn()");
    expect(confirmed).not.toContain("readBookingReturn(");
    expect(confirmed).toContain('href="/plan"');
    expect(confirmed).toContain("Back to your night");
  });
});
