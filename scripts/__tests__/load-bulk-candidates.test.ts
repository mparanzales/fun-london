// Guards for the bulk-candidate loader (2026-08-02, second injection).
//
// The load-bearing invariant is LEGAL-SENSITIVE, not stylistic: the CSV's
// Description column is another publication's editorial text, and
// ingest-from-pending publishes long_description_draft VERBATIM into
// venues.long_description. If the description ever reaches any *_draft
// column, it ships to the public site — the exact mechanism that created
// the ~222-template-description debt. These tests pin the description to
// sources[0].import_note and NOWHERE else.

import { describe, expect, it } from "vitest";
import {
  buildCandidateRow,
  classify,
  normName,
  parseCsv,
} from "../load-bulk-candidates";

const DESC = "This ornate Victorian marketplace was a film set.";

describe("buildCandidateRow — provenance invariant", () => {
  it("stores the CSV description ONLY in sources[0].import_note", () => {
    const row = buildCandidateRow("Leadenhall Market", "London, England", DESC);
    expect(row.sources[0].import_note).toBe(DESC);
    // The description string must appear nowhere else in the row.
    const { sources, ...rest } = row;
    expect(JSON.stringify(rest)).not.toContain("Victorian");
    expect(sources).toHaveLength(1);
  });

  it("never emits any *_draft field (publish paths ship drafts verbatim)", () => {
    const row = buildCandidateRow("Somewhere", "London, England", DESC);
    for (const key of Object.keys(row)) {
      expect(key).not.toMatch(/_draft$/);
    }
    expect(row).not.toHaveProperty("long_description_draft");
    expect(row).not.toHaveProperty("vibe_draft");
    expect(row).not.toHaveProperty("vibe_tags_draft");
  });

  it("labels the source with the neutral 'bulk-import' string", () => {
    const row = buildCandidateRow("Somewhere", "", "");
    expect(row.sources[0].source).toBe("bulk-import");
    expect(row.status).toBe("pending");
    expect(row.sources_count).toBe(1);
  });

  it("drops the boilerplate 'London, England' location but keeps a real one", () => {
    expect(
      buildCandidateRow("X", "London, England", "").neighbourhood,
    ).toBeNull();
    expect(buildCandidateRow("X", "", "").neighbourhood).toBeNull();
    expect(buildCandidateRow("X", "Hackney", "").neighbourhood).toBe("Hackney");
  });

  it("stores an empty description as null, not ''", () => {
    expect(buildCandidateRow("X", "", "  ").sources[0].import_note).toBeNull();
  });
});

describe("classify — local keyword hints", () => {
  it("classifies day-spots so they don't publish as Evening restaurants", () => {
    expect(
      classify("Highgate Cemetery", "London's creepiest cemetery"),
    ).toEqual({
      type_guess: "outdoors",
      time_of_day: "Day",
      moods: ["activity"],
    });
    expect(classify("God's Own Junkyard", "a warehouse of neon art")).toEqual({
      type_guess: "culture",
      time_of_day: "Day",
      moods: ["culture"],
    });
  });

  it("market beats culture for markets (rule order)", () => {
    expect(
      classify("Leadenhall Market", "ornate Victorian marketplace, a film set")
        .type_guess,
    ).toBe("market");
  });

  it("drink types win over generic words", () => {
    expect(classify("The Mayflower", "historic riverside pub").type_guess).toBe(
      "pub",
    );
  });

  it("returns all-null when nothing matches (publishes under old defaults)", () => {
    expect(classify("221B Baker Street", "a fictional address")).toEqual({
      type_guess: null,
      time_of_day: null,
      moods: null,
    });
  });
});

describe("parseCsv", () => {
  it("handles quoted fields with commas and escaped quotes", () => {
    const rows = parseCsv('Name,Desc\n"A, B","he said ""hi"""\n');
    expect(rows).toEqual([
      ["Name", "Desc"],
      ["A, B", 'he said "hi"'],
    ]);
  });

  it("handles newlines inside quotes and CRLF line endings", () => {
    const rows = parseCsv('Name,Desc\r\n"Multi\nline",x\r\n');
    expect(rows).toEqual([
      ["Name", "Desc"],
      ["Multi\nline", "x"],
    ]);
  });

  it("strips a UTF-8 BOM before the header", () => {
    const rows = parseCsv("﻿Name,Desc\na,b\n");
    expect(rows[0][0]).toBe("Name");
  });
});

describe("normName", () => {
  it("collapses case, punctuation and whitespace", () => {
    expect(normName("The  Ruins of St. Dunstan-in-the-East")).toBe(
      "the ruins of st dunstanintheeast",
    );
  });
});
