// Shared, pure search-matching helpers, used by BOTH the client SearchOverlay
// (signed-in, in-memory over the full catalogue) and the server search action
// (signed-out, server-side card-level search). The matcher is identical; the
// haystacks are not — the signed-in path additionally matches the in-memory
// vibe/mood tags that the card-level signed-out path doesn't carry.

// Normalise text for search: lowercase, strip accents, DROP apostrophes (so
// "dont" matches "Don't"), turn & into "and", collapse all other punctuation to
// spaces. Without this, any venue with an apostrophe or accent (Don't Tell Dad,
// Ronnie Scott's, Café, Ladurée) is unfindable unless the user types the exact
// special character.
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accent marks
    .replace(/['’`]/g, "") // drop straight + curly apostrophes
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// 0 = name starts with query (best), 1 = name contains query,
// 2 = some other field contains query (weakest). Lower sorts first.
// `name` and `hay` must already be normalised; `q` is normalised by the caller.
export function scoreMatch(
  name: string,
  hay: string,
  q: string,
): number | null {
  if (name.startsWith(q)) return 0;
  if (name.includes(q)) return 1;
  if (hay.includes(q)) return 2;
  return null;
}
