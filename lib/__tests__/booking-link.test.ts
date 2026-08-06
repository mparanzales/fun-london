import { describe, it, expect } from "vitest";
import { buildReserveUrl, platformLabel } from "@/lib/booking-link";

const slot = { date: "2026-06-10", time: "20:00", party: 2 };

describe("buildReserveUrl", () => {
  it("pre-fills OpenTable with dateTime + partySize", () => {
    const url = buildReserveUrl(
      { platform: "opentable", url: "https://www.opentable.co.uk/r/padella" },
      slot,
    );
    const decoded = decodeURIComponent(url!);
    expect(decoded).toContain("dateTime=2026-06-10T20:00");
    expect(decoded).toContain("partySize=2");
  });

  it("pre-fills Resy with date + seats", () => {
    const url = buildReserveUrl(
      { platform: "resy", url: "https://resy.com/cities/ldn/venue" },
      slot,
    );
    const decoded = decodeURIComponent(url!);
    expect(decoded).toContain("date=2026-06-10");
    expect(decoded).toContain("seats=2");
  });

  it("pre-fills SevenRooms with party_size", () => {
    const url = buildReserveUrl(
      {
        platform: "sevenrooms",
        url: "https://www.sevenrooms.com/reservations/x",
      },
      slot,
    );
    expect(decodeURIComponent(url!)).toContain("party_size=2");
  });

  it("leaves a plain website link's path intact", () => {
    const url = buildReserveUrl(
      { platform: "website", url: "https://venue.example/book" },
      slot,
    );
    expect(url).toContain("https://venue.example/book");
  });

  // 🧨 http(s) or nothing: the result is rendered as an anchor HREF in the
  // ReserveSheet, and target.url is CATALOGUE data (ingestion crons, bulk
  // import). The old fallback returned the raw string verbatim, which turned
  // a poisoned row into script running in funldn.com's origin on the user's
  // own tap. Null drops the CTA instead.
  it("returns null for a value that does not parse as a URL", () => {
    expect(
      buildReserveUrl({ platform: "website", url: "not-a-valid-url" }, slot),
    ).toBeNull();
  });

  it("returns null for any non-http(s) scheme", () => {
    for (const url of [
      // eslint-disable-next-line no-script-url
      "javascript:alert(document.domain)",
      "data:text/html,<script>1</script>",
      "file:///etc/passwd",
      "vbscript:x",
    ]) {
      expect(buildReserveUrl({ platform: "website", url }, slot)).toBeNull();
    }
    // Positive control: both real web schemes survive.
    expect(
      buildReserveUrl(
        { platform: "website", url: "http://venue.example" },
        slot,
      ),
    ).not.toBeNull();
    expect(
      buildReserveUrl(
        { platform: "website", url: "https://venue.example" },
        slot,
      ),
    ).not.toBeNull();
  });
});

describe("platformLabel", () => {
  it("maps known platforms to display names", () => {
    expect(platformLabel("opentable")).toBe("OpenTable");
    expect(platformLabel("resy")).toBe("Resy");
    expect(platformLabel("sevenrooms")).toBe("SevenRooms");
    expect(platformLabel("thefork")).toBe("TheFork");
  });

  it("falls back to 'their site' for a plain website", () => {
    expect(platformLabel("website")).toBe("their site");
  });
});
