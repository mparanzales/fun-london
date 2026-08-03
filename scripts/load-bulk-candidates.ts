// Fun London — load a bulk CSV of place names into pending_candidates.
//
// Built 2026-08-02 for the second injection (Maria's curated CSV list). Loads
// each row as a status="pending" candidate with source "bulk-import", so it
// lands in the SAME /admin/candidates approval queue as the discover-venues
// leftovers. Publishing stays where it always was: after human approval,
// scripts/ingest-from-pending.ts (which now defaults to --limit=25 per run —
// see the Places budget note there).
//
// 💸 THIS SCRIPT MAKES ZERO GOOGLE CALLS. It only reads/writes Supabase.
// The Places spend happens later, at publish time, per approved candidate.
//
// CSV shape (header row required, extra columns ignored, case-insensitive):
//   Name,Location,Description
//
// ⚖️ PROVENANCE RULES (both are load-bearing — do not relax them; enforced by
// scripts/__tests__/load-bulk-candidates.test.ts):
//   1. The Description column is another publication's editorial text. It is
//      stored ONLY as sources[0].import_note — an internal writing aid for
//      the later curation-voice rewrite, and the evidence line the admin
//      approval card shows. It must NEVER be copied into
//      long_description_draft: ingest-from-pending publishes that column
//      VERBATIM into venues.long_description (the ~222-template-description
//      debt started exactly this way). Nothing reads import_note at publish.
//   2. The source label stays the neutral "bulk-import" — never the provider
//      name (see the 2026-07-23 scrub; legal-sensitive).
//
// Classification: type_guess/time_of_day/moods are derived LOCALLY from
// name+description keywords (nothing external, nothing stored beyond the
// enum values). Without this every bulk row published as an Evening
// "Restaurant" with mood ["dinner"] — wrong for a list that is mostly
// day-spots. The guess is a HINT the reviewer sees on the approval card;
// rows with no keyword hit stay null and publish under the old defaults.
//
// Dedupe: skips rows whose normalised name already exists in venues OR in
// pending_candidates (any status), and intra-CSV duplicates. Re-running the
// same CSV is therefore a no-op — safe.
//
// Run:
//   pnpm load-candidates:dry -- --csv="/path/to/list.csv"   # counts only
//   pnpm load-candidates -- --csv="/path/to/list.csv"       # insert
//
// Required environment (.env.local):
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const DRY_RUN = process.argv.includes("--dry-run");
const csvArg = process.argv.find((a) => a.startsWith("--csv="));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ── Minimal RFC-4180 CSV parser ─────────────────────────────────────────────
// Handles quoted fields, escaped quotes ("") and newlines inside quotes. No
// dependency: the repo has no CSV library and this input is a spreadsheet
// export, not an adversarial stream.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // Normalise BOM + CRLF once so the state machine only sees \n.
  const src = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      field = "";
      // Skip fully-empty trailing lines.
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

// Same normalisation used for the pre-load dedupe check on 2026-08-02:
// lowercase, strip everything but letters/digits/spaces, collapse whitespace.
export function normName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Local keyword classifier ────────────────────────────────────────────────
// Emits only enum values ingest-from-pending's mapVenueType already checks
// ("pub" / "wine bar" / "bar" / "cafe" / "market" / "culture" / "outdoors"),
// plus the time_of_day/moods shape discover-venues candidates carry. Order
// matters: specific before generic ("market" wins over "culture" for
// Leadenhall Market; drink words win over food words for a gastropub).
type Classification = {
  type_guess: string | null;
  time_of_day: "Day" | "Evening" | null;
  moods: string[] | null;
};

const CLASSIFIER: {
  re: RegExp;
  type_guess: string;
  time_of_day: "Day" | "Evening" | null;
  moods: string[] | null;
}[] = [
  { re: /\bmarket\b/, type_guess: "market", time_of_day: "Day", moods: null },
  {
    re: /\bpub\b|\btavern\b|alehouse|\binn\b/,
    type_guess: "pub",
    time_of_day: null,
    moods: null,
  },
  {
    re: /wine bar|wine shop|natural wine/,
    type_guess: "wine bar",
    time_of_day: null,
    moods: null,
  },
  {
    re: /\bbar\b|cocktail|speakeasy|brewery|taproom|distillery|nightclub|night club/,
    type_guess: "bar",
    time_of_day: null,
    moods: null,
  },
  {
    re: /\bcaf[eé]\b|coffee|bakery|tea ?room|patisserie/,
    type_guess: "cafe",
    time_of_day: "Day",
    moods: null,
  },
  {
    re: /cemetery|park\b|garden|\bwalk\b|trail|heath|wetland|reservoir|marsh|\bwood\b|woods\b|nature|canal|river\b|towpath/,
    type_guess: "outdoors",
    time_of_day: "Day",
    moods: ["activity"],
  },
  {
    re: /museum|galler(y|ies)|exhibit|theatre|theater|cinema|church|chapel|abbey|cathedral|library|archive|collection|statue|sculpture|memorial|monument|historic|heritage|palace|castle|ruins?\b|crypt|tomb|observatory|planetarium|\bart\b/,
    type_guess: "culture",
    time_of_day: "Day",
    moods: ["culture"],
  },
];

export function classify(name: string, description: string): Classification {
  const hay = `${name} ${description}`.toLowerCase();
  for (const rule of CLASSIFIER) {
    if (rule.re.test(hay)) {
      return {
        type_guess: rule.type_guess,
        time_of_day: rule.time_of_day,
        moods: rule.moods,
      };
    }
  }
  return { type_guess: null, time_of_day: null, moods: null };
}

// ── Row builder (extracted so the provenance test can assert on it) ─────────
export type CandidateInsert = {
  name: string;
  neighbourhood: string | null;
  type_guess: string | null;
  status: "pending";
  sources: {
    source: "bulk-import";
    import_note: string | null;
    time_of_day: "Day" | "Evening" | null;
    moods: string[] | null;
  }[];
  sources_count: number;
};

export function buildCandidateRow(
  name: string,
  rawLocation: string,
  description: string,
): CandidateInsert {
  // The CSV's Location column is boilerplate ("London, England") — a real
  // neighbourhood arrives later from the venue's Google postcode at publish
  // (areaFromPostcode in ingest-from-pending). Only keep it when it says
  // something more specific than London itself.
  const loc = rawLocation.trim();
  const neighbourhood = /^london(,|\s|$)/i.test(loc) ? null : loc || null;
  const desc = description.trim();
  const cls = classify(name, desc);
  return {
    name: name.trim(),
    neighbourhood,
    type_guess: cls.type_guess,
    status: "pending",
    sources: [
      // import_note = internal writing aid + admin-card evidence ONLY — see
      // the provenance rules in the header. Publish code never reads it.
      {
        source: "bulk-import",
        import_note: desc || null,
        time_of_day: cls.time_of_day,
        moods: cls.moods,
      },
    ],
    sources_count: 1,
  };
}

// Read one text column from every row of a table, paginated — Supabase caps a
// select at 1,000 rows, and venues is ~2,156. Forgetting this returns a
// silently-truncated list and the dedupe waves duplicates straight through.
// The .order() is load-bearing: offset pagination without a stable ORDER BY
// lets a concurrent UPDATE relocate a row between pages, silently dropping it.
async function fetchAllNames(
  supabase: SupabaseClient,
  table: "venues" | "pending_candidates",
): Promise<Set<string>> {
  const out = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select("name")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table} read failed: ${error.message}`);
    for (const r of data ?? []) out.add(normName((r as { name: string }).name));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

async function main() {
  if (!csvArg) {
    console.error('Usage: pnpm load-candidates -- --csv="/path/to/list.csv"');
    process.exit(1);
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (.env.local)",
    );
    process.exit(1);
  }
  const csvPath = csvArg.slice("--csv=".length);
  const rows = parseCsv(readFileSync(csvPath, "utf8"));
  if (rows.length < 2) {
    console.error(`No data rows found in ${csvPath}`);
    process.exit(1);
  }

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const nameIdx = header.indexOf("name");
  const locIdx = header.indexOf("location");
  const descIdx = header.indexOf("description");
  if (nameIdx === -1) {
    console.error(`CSV has no "Name" column (header: ${rows[0].join(", ")})`);
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const dataRows = rows.slice(1);
  console.log(
    `Fun London — bulk candidate load · ${dataRows.length} CSV rows · ${DRY_RUN ? "DRY RUN" : "WRITING"}\n`,
  );

  const [venueNames, candidateNames] = await Promise.all([
    fetchAllNames(supabase, "venues"),
    fetchAllNames(supabase, "pending_candidates"),
  ]);
  console.log(
    `dedupe sets: ${venueNames.size} venue names · ${candidateNames.size} candidate names`,
  );

  const seenInCsv = new Set<string>();
  const toInsert: CandidateInsert[] = [];
  let skippedVenue = 0;
  let skippedCandidate = 0;
  let skippedCsvDupe = 0;
  let skippedNoName = 0;

  for (const row of dataRows) {
    const name = (row[nameIdx] ?? "").trim();
    if (!name) {
      // Loud, not silent: a blank Name usually means a shifted column
      // (unquoted comma) — the row is dropped but COUNTED so the scoreboard
      // still reconciles to the CSV row count.
      skippedNoName++;
      continue;
    }
    const key = normName(name);
    if (seenInCsv.has(key)) {
      skippedCsvDupe++;
      continue;
    }
    seenInCsv.add(key);
    if (venueNames.has(key)) {
      skippedVenue++;
      continue;
    }
    if (candidateNames.has(key)) {
      skippedCandidate++;
      continue;
    }
    toInsert.push(
      buildCandidateRow(
        name,
        locIdx === -1 ? "" : (row[locIdx] ?? ""),
        descIdx === -1 ? "" : (row[descIdx] ?? ""),
      ),
    );
  }

  // Reconciliation: every CSV row must be accounted for exactly once.
  const accounted =
    toInsert.length +
    skippedVenue +
    skippedCandidate +
    skippedCsvDupe +
    skippedNoName;
  if (accounted !== dataRows.length) {
    throw new Error(
      `row accounting broken: ${accounted} accounted vs ${dataRows.length} CSV rows — refusing to write`,
    );
  }

  const typed = toInsert.filter((r) => r.type_guess !== null).length;
  console.log(
    `\nplan: insert ${toInsert.length} (${typed} classified, ${toInsert.length - typed} unclassified → default type) · ` +
      `skip ${skippedVenue} already-venues · skip ${skippedCandidate} already-candidates · ` +
      `skip ${skippedCsvDupe} CSV dupes · skip ${skippedNoName} blank-name`,
  );

  if (DRY_RUN) {
    console.log("\n[dry-run] nothing written.");
    return;
  }

  let inserted = 0;
  const BATCH = 500;
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const slice = toInsert.slice(i, i + BATCH);
    const { error } = await supabase.from("pending_candidates").insert(slice);
    if (error)
      throw new Error(
        `insert batch ${i / BATCH + 1} failed after ${inserted} rows: ${error.message}`,
      );
    inserted += slice.length;
    console.log(`  ✓ inserted ${inserted}/${toInsert.length}`);
  }

  // Scoreboard of integers — "ask what changed, not if it ran".
  console.log(
    `\nDONE · inserted: ${inserted} · skipped_venue: ${skippedVenue} · ` +
      `skipped_candidate: ${skippedCandidate} · csv_dupes: ${skippedCsvDupe} · ` +
      `blank_name: ${skippedNoName}`,
  );
  console.log(
    "Next: approve in /admin/candidates, then publish in batches:\n" +
      "  pnpm ingest:from-pending   # capped at 25/run by default; ~10 Google calls per published venue",
  );
}

// Only run when invoked directly (pnpm load-candidates), not when the test
// file imports the helpers above.
if (process.argv[1]?.includes("load-bulk-candidates")) {
  main().catch((err) => {
    console.error(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
