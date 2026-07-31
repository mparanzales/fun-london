// ─────────────────────────────────────────────────────────────────────────
// Prove a deleted PostHog key is ACTUALLY dead.
//
// 🧨 WHY THIS IS A SCRIPT AND NOT A ONE-LINER. The documented proof used to be:
//
//     POSTHOG_PERSONAL_API_KEY="$POSTHOG_PROVISIONING_API_KEY" pnpm posthog:verify
//
// and it could not fail correctly. The provisioning key lives in .env.local, and
// a shell does not source .env.local, so `$POSTHOG_PROVISIONING_API_KEY` expands
// to the EMPTY STRING. The prefix assignment still SETS the variable in the child
// environment, and dotenv refuses to fill a key that is already present, so the
// script saw "" and printed "POSTHOG_PERSONAL_API_KEY is not set", exit 1.
//
// Exit 1 is what a revoked key also produces, so the operator sees a failure and
// reads it as proof. PostHog was never contacted. If the deletion had not taken,
// a key carrying dashboard:write and insight:write would stay live on a public
// repo's project, certified dead by a check that never made a request.
//
// This repo has been burned by exactly this before: a missing CI secret is ""
// rather than undefined, `??` never fires, and the job goes quiet for nine weeks.
//
// So this script distinguishes THREE outcomes instead of two:
//   • key not supplied      -> exit 2, "you did not give me a key to test"
//   • key still works       -> exit 1, "STILL LIVE, revoke it"
//   • key rejected          -> exit 0, "confirmed dead" (a real HTTP round trip)
//
// 🧨 AND THEN IT MADE THE SAME MISTAKE ONE LAYER DOWN. The first version read
// "rejected" as `status === 401 || status === 403`, which certifies a LIVE key
// as dead. On this project 403 is the LIVE-key signature: a personal API key
// with project-scoped grants authenticates fine and is then refused for missing
// `user:read`. Demonstrated rather than argued — the permanent read-only key,
// which had just listed 32 insights, produced:
//
//     GET /api/users/@me/ -> 403
//     CONFIRMED REVOKED: rejected the key with HTTP 403.   (exit 0)
//
// The two outcomes are told apart by the error CODE, not the status:
//
//   401 + "authentication_failed"  the key is not a key any more. DEAD.
//   401 + "not_authenticated"      no credential arrived. Proves nothing.
//   403 + "permission_denied"      it AUTHENTICATED, then failed on scope. LIVE.
//
// Anything unrecognised exits 2. "I could not tell" must never be reported as
// "confirmed dead" — that is the entire reason this file exists.
//
// Usage (export it in the SHELL, it deliberately does not read .env.local):
//   export POSTHOG_REVOKED_KEY='the key you just deleted'
//   pnpm posthog:revoked-check
// ─────────────────────────────────────────────────────────────────────────

import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const DEFAULT_API_HOST = "https://eu.posthog.com";
const API_HOST = (process.env.POSTHOG_API_HOST ?? DEFAULT_API_HOST).replace(
  /\/$/,
  "",
);

/**
 * What PostHog's answer actually tells us about the key.
 *
 * Extracted from main() so it can be table-tested. It was inline, with
 * process.exit calls threaded through it, which made the one piece of logic in
 * this repo whose entire job is to prevent a false green tick the only piece
 * with no test at all. It has already been wrong once.
 *
 *   "dead"     the string is not a credential
 *   "live"     it authenticated (2xx, or 403 = authenticated then out-scoped)
 *   "unproven" anything else. NEVER report this as a pass.
 */
export function classifyRevocation(
  status: number,
  code: string,
): "dead" | "live" | "unproven" {
  if (status === 401) {
    // Only an explicit auth failure proves the key is gone. "not_authenticated"
    // means the header never arrived, which says nothing about the key.
    return code === "authentication_failed" ? "dead" : "unproven";
  }
  // 🧨 403 means it AUTHENTICATED and was then refused for missing scope.
  if (status === 403) return "live";
  if (status >= 200 && status < 300) return "live";
  // 429, 5xx, an HTML error page, anything unrecognised: we learned nothing.
  return "unproven";
}

/**
 * Reasons the ANSWER cannot be trusted regardless of what it says.
 *
 * A personal API key is issued against one PostHog host and is simply unknown
 * to any other, so a live key checked against the wrong host returns
 * `401 authentication_failed` -- indistinguishable from a real revocation. The
 * same document calls confusing the ingest host with the API host "the most
 * common failure", and POSTHOG_API_HOST may well still be exported from an
 * earlier debugging session.
 */
export function hostObjection(host: string): string | null {
  if (host === DEFAULT_API_HOST) return null;
  return (
    `POSTHOG_API_HOST is set to ${host}, not ${DEFAULT_API_HOST}. A personal ` +
    "API key is unknown to any host it was not issued on, so that host would " +
    "answer 401 for a key that is very much alive. Unset it and re-run."
  );
}

/**
 * Reasons the VALUE cannot be trusted before it is even sent.
 *
 * A key mangled by a wrapped terminal paste makes Django's token auth raise
 * AuthenticationFailed, which is the exact 401 a revoked key produces. "This
 * string is not a credential" would be reported as "the key is dead".
 */
export function keyObjection(key: string): string | null {
  if (/\s/.test(key)) {
    return (
      "The key contains whitespace, so it was probably mangled by a wrapped " +
      "paste. PostHog would reject it with the same 401 a revoked key gives, " +
      "and this check would call that proof. Re-copy it and re-run."
    );
  }
  if (!key.startsWith("phx_")) {
    return (
      "That does not look like a personal API key (they start with phx_). A " +
      "value PostHog cannot parse returns the same 401 a revoked key does."
    );
  }
  return null;
}

/**
 * Non-secret identifier, so the operator can confirm WHICH key was tested.
 *
 * A HASH, not a slice of the key. The obvious version prints the last four
 * characters, and that is still key material on a terminal that gets scrolled,
 * screenshotted or pasted into a chat -- and this repo's rule is that a key
 * never reaches terminal output, full stop. A digest prefix identifies the
 * value just as well for "is this the one I deleted?" and reveals nothing:
 * compare two runs' fingerprints rather than reading either.
 */
export function keyFingerprint(key: string): string {
  const digest = createHash("sha256").update(key).digest("hex").slice(0, 12);
  return `${key.length} chars, sha256:${digest}`;
}

async function main(): Promise<void> {
  const key = (process.env.POSTHOG_REVOKED_KEY ?? "").trim();
  if (!key) {
    console.error(
      "POSTHOG_REVOKED_KEY is empty or unset, so nothing was tested.\n" +
        "This is NOT a pass. Export the key you just deleted and re-run:\n" +
        "  export POSTHOG_REVOKED_KEY='...'\n" +
        "  pnpm posthog:revoked-check\n" +
        "It is read from the shell on purpose: .env.local should no longer " +
        "contain a revoked key at all.",
    );
    process.exit(2);
  }

  // Refuse before spending a request when the answer could not be trusted.
  for (const objection of [hostObjection(API_HOST), keyObjection(key)]) {
    if (objection) {
      console.error(`${objection}\nNothing was tested. This is NOT a pass.`);
      process.exit(2);
    }
  }
  console.log(`Testing a key: ${keyFingerprint(key)} against ${API_HOST}`);

  let res: Response;
  try {
    res = await fetch(`${API_HOST}/api/users/@me/`, {
      headers: { Authorization: `Bearer ${key}` },
    });
  } catch (err) {
    // A network failure is not evidence either way. Say so.
    console.error(
      `Could not reach ${API_HOST}: ${err instanceof Error ? err.message : err}\n` +
        "Nothing was proven. Fix the connection and re-run.",
    );
    process.exit(2);
  }

  // PostHog puts the discriminator in the body, not the status line.
  let code = "";
  try {
    code = String(
      ((await res.clone().json()) as { code?: string })?.code ?? "",
    );
  } catch {
    code = "";
  }

  switch (classifyRevocation(res.status, code)) {
    case "dead":
      console.log(
        `CONFIRMED REVOKED: ${API_HOST} rejected the key outright ` +
          `(HTTP 401 authentication_failed). It is not a valid credential.`,
      );
      return;

    case "live":
      console.error(
        `🔴 THE KEY IS STILL LIVE. ${API_HOST} returned HTTP ${res.status}` +
          (code ? ` (${code})` : "") +
          ".\n" +
          (res.status === 403
            ? "403 means it AUTHENTICATED and was then refused for missing " +
              "scope. A deleted key gives 401 authentication_failed instead.\n"
            : "") +
          "Delete it at /settings/user-api-keys and run this again. Do not " +
          "treat the provisioning step as finished until this exits 0.",
      );
      process.exit(1);
      break;

    default:
      console.error(
        `Nothing was proven: HTTP ${res.status}` +
          (code ? ` with code "${code}"` : "") +
          ". That is neither an accepted key nor a rejected one, so this is " +
          "NOT a pass. Re-run, and check the key and host if it persists.",
      );
      process.exit(2);
  }
}

// Only run when invoked as a command, never on import.
//
// Without this the module IS its own side effect: importing it to unit-test
// classifyRevocation ran main(), which found no POSTHOG_REVOKED_KEY and called
// process.exit(2) out from under the test runner. That is also precisely why
// this file had no tests while its logic was wrong -- it could not be imported.
const invokedDirectly =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(2);
  });
}
