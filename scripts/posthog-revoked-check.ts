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

const API_HOST = (
  process.env.POSTHOG_API_HOST ?? "https://eu.posthog.com"
).replace(/\/$/, "");

async function main(): Promise<void> {
  const key = process.env.POSTHOG_REVOKED_KEY ?? "";
  if (!key.trim()) {
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

  if (res.status === 401 && code === "authentication_failed") {
    console.log(
      `CONFIRMED REVOKED: ${API_HOST} rejected the key outright ` +
        `(HTTP 401 authentication_failed). It is not a valid credential.`,
    );
    return;
  }

  // 🧨 403 IS THE LIVE-KEY ANSWER, not a rejection. The key authenticated and
  // was then refused for missing scope. Reading it as "revoked" is how a
  // write-capable key stays live on a public repo's project while a green tick
  // says otherwise.
  if (res.status === 403) {
    console.error(
      `🔴 THE KEY IS STILL LIVE. ${API_HOST} returned HTTP 403 (${code || "no code"}), ` +
        "which means it AUTHENTICATED and was then refused for missing scope. " +
        "A deleted key gives 401 authentication_failed instead.\n" +
        "Delete it at /settings/user-api-keys and run this again.",
    );
    process.exit(1);
  }

  if (res.ok) {
    console.error(
      `🔴 THE KEY IS STILL LIVE. ${API_HOST} accepted it (HTTP ${res.status}).\n` +
        "Delete it at /settings/user-api-keys and run this again. Do not treat " +
        "the provisioning step as finished until this exits 0.",
    );
    process.exit(1);
  }

  if (res.status === 401) {
    // 401 without authentication_failed means the header never arrived
    // ("not_authenticated"). Nothing about the key was established.
    console.error(
      `Nothing was proven: HTTP 401 with code "${code || "none"}", which is ` +
        "what an absent or malformed Authorization header returns, not a " +
        "rejected key. Check the value you exported and re-run.",
    );
    process.exit(2);
  }

  console.error(
    `Unexpected HTTP ${res.status} from ${API_HOST}. Neither live nor revoked ` +
      "was proven, so this is not a pass.",
  );
  process.exit(2);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(2);
});
