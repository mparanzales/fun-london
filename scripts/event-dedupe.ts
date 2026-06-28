// Shared event de-duplication. The same pop-up/exhibition gets surfaced under
// many name variants ("PleasingLand", "PleasingLand Pop-Up", "Harry Styles'
// PleasingLand"), so an exact name/slug key misses them. We match on
// significant-token overlap + date overlap instead. Used by the events cleanup
// (fix-events.ts) and the pop-up ingestion (discover-popups.ts).

const STOP = new Set([
  "the", "a", "an", "at", "by", "of", "in", "on", "for", "and", "popup",
  "pop", "up", "shop", "store", "experience", "official", "summer", "winter",
  "spring", "autumn", "july", "june", "august", "2026", "2025", "london",
  "tour", "edition", "brand", "presents", "feat", "with",
]);

export function nameTokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1 && !STOP.has(t)),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export function normVenue(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24);
}

export type DedupeRow = {
  tokens: Set<string>;
  venue: string;
  start: number; // ms epoch (NaN if unknown)
  end: number; // ms epoch (NaN if unknown)
};

export function makeRow(
  name: string,
  venueName: string,
  startISO: string | null,
  endISO: string | null,
): DedupeRow {
  const start = startISO ? Date.parse(startISO) : NaN;
  const endP = endISO ? Date.parse(endISO) : NaN;
  return {
    tokens: nameTokens(name),
    venue: normVenue(venueName),
    start,
    end: isNaN(endP) ? start : endP,
  };
}

function datesOverlap(a: DedupeRow, b: DedupeRow): boolean {
  if (isNaN(a.start) || isNaN(b.start)) return true; // unknown dates don't block a merge
  const ae = isNaN(a.end) ? a.start : a.end;
  const be = isNaN(b.end) ? b.start : b.end;
  return a.start <= be && b.start <= ae;
}

/** Two events are the same thing when their runs overlap AND either the names
 *  are very similar, or it's the same venue with a moderate name match. */
export function sameEvent(a: DedupeRow, b: DedupeRow): boolean {
  if (!datesOverlap(a, b)) return false;
  const j = jaccard(a.tokens, b.tokens);
  return j >= 0.5 || (a.venue === b.venue && j >= 0.34);
}

/** Is `cand` a duplicate of anything already in `existing`? */
export function isDuplicate(cand: DedupeRow, existing: DedupeRow[]): boolean {
  return existing.some((e) => sameEvent(cand, e));
}
