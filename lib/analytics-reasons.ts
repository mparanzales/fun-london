// Pure mappers from real error shapes onto the CLOSED failure categories in
// lib/analytics.ts. Separate file for two reasons: it is unit-testable without
// a DOM, and `import type` below is erased at build time, so importing this
// from the anon plan flow pulls in no runtime dependency (that file is pinned
// by lib/__tests__/plan-preview-guard.test.ts).
//
// 🧨 THE WHOLE POINT: an analytics event must never carry a raw error. A
// PostgREST failure's `message` can echo a row value, and on the NETWORK path
// postgrest-js puts a full stack trace in `details`. A thrown client error's
// `String(err)` can carry anything the engine was holding. So the only thing
// that ever leaves this module is one of a handful of fixed strings.

import type { PlanFailReason, SaveFailReason } from "@/lib/analytics";

/**
 * Bucket a Supabase/PostgREST insert failure.
 *
 * Reads the SQLSTATE code and the HTTP status ONLY. Never the message.
 *
 * Codes seen on this path:
 *   42501  insufficient_privilege  -> an RLS policy refused the write
 *   23xxx  integrity constraint    -> unique / fk / check violation
 *   42xxx  syntax or schema        -> a column that no longer matches the code
 *   PGRST* PostgREST-level         -> schema cache / parse problems
 * Status 0 means the request never reached the server (offline, DNS, CORS).
 */
export function saveFailReason(
  code: string | undefined | null,
  status: number | undefined | null,
): SaveFailReason {
  const c = typeof code === "string" ? code : "";
  if (c === "42501") return "rls_denied";
  if (c.startsWith("23")) return "constraint";
  if (c.startsWith("42") || c.startsWith("PGRST")) return "schema_mismatch";

  // Status is the fallback signal when there is no SQLSTATE at all.
  if (status === 0 || status === undefined || status === null) {
    // supabase-js reports a network failure as status 0 / absent.
    return c === "" ? "network" : "unknown";
  }
  if (status === 401 || status === 403) return "auth_expired";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server";
  if (status >= 400) return "unknown";
  return "unknown";
}

/**
 * Map the anon plan server action's own `reason` string onto a plan failure
 * category. The server's vocabulary is small and bounded; anything outside it
 * becomes "unknown" rather than being forwarded verbatim.
 */
export function planFailReasonFromServer(
  reason: string | undefined | null,
): PlanFailReason {
  switch (reason) {
    case "limited":
      return "rate_limited";
    case "empty":
      return "no_result";
    case "invalid":
      return "invalid_input";
    case "unavailable":
    case "error":
      return "server";
    default:
      return "unknown";
  }
}

/**
 * Bucket a thrown client-side failure without touching the error object.
 *
 * `online` is `navigator.onLine` where available. A false reading is the only
 * evidence we have that the request never left the device; everything else is
 * reported as "server", because guessing harder would mean inspecting the
 * error, which is the thing this module exists to prevent.
 */
export function throwFailReason(online: boolean | undefined): PlanFailReason {
  return online === false ? "network" : "server";
}
