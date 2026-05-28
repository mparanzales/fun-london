// Shared types for publication adapters under scripts/candidate-sources/.
//
// Each adapter pulls recently-published venue write-ups from a single
// publication (Time Out, Eater, etc.) and normalises them into the
// `PublicationMention` shape below. The orchestrator
// (scripts/scout-candidates.ts) cross-references mentions across
// publications and surfaces venues with >= 2 distinct sources in the
// last 24 months as candidates.

export type PublicationName =
  | "Time Out"
  | "Eater London"
  | "The Infatuation"
  | "Hot Dinners"
  | "Square Mile"
  | "Harden's";

export type PublicationMention = {
  // Venue identity — best-effort, cleaned to title case
  venueName: string;
  // Optional area / neighbourhood when the publication surfaces it
  neighbourhood?: string;
  // Mention provenance
  publication: PublicationName;
  url: string; // canonical URL of the review/feature
  title: string; // article title
  date: string; // ISO date or YYYY-MM-DD — when the article was published
  // Optional: lift from the article if the publication makes it easy
  excerpt?: string; // ~200 chars of preview text
  category?: string; // free-form, e.g. "Restaurant", "Bar", "Pub"
};

// Each publication adapter exports a single fetch function with this
// signature. The orchestrator calls them in parallel and aggregates
// mentions.
export type PublicationAdapter = {
  publication: PublicationName;
  // Fetch the most recent N venue mentions. `sinceMonths` defaults to 24
  // months per the curation thesis.
  fetchRecentMentions: (opts?: {
    sinceMonths?: number;
    limit?: number;
  }) => Promise<PublicationMention[]>;
};
