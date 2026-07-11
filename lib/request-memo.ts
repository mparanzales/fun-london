import { cache } from "react";

// React's `cache()` memoizes per server request — the right tool for
// deduping generateMetadata + page fetches of the same row. But vitest
// resolves the CLIENT build of react, where `cache` is not a function, so
// wrapping fetchers directly broke every suite that imports lib/queries.
// This shim uses the real cache when it exists and falls back to identity
// (no memo, same behavior as before the dedup) everywhere else.
type AnyFn = (...args: any[]) => any;

export const requestMemo: <F extends AnyFn>(fn: F) => F =
  typeof cache === "function" ? cache : (fn) => fn;
