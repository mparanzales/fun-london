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

  it("keys the marker on the venue slug, not the stop index", () => {
    // A replaced or dropped stop shifts indices while the user is away
    // booking; the slug follows the venue. The stored stopIndex is an
    // analytics dimension only.
    expect(src).toContain("bookedStop?.slug === s.venue.slug");
  });
});
