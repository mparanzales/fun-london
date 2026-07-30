// ─────────────────────────────────────────────────────────────────────────
// Shared PostHog REST client for the two analytics scripts.
//
// TWO HOSTS, AND MIXING THEM UP IS THE #1 WAY THIS FAILS:
//   • INGEST host  https://eu.i.posthog.com  — where the browser SDK posts
//     events. That is NEXT_PUBLIC_POSTHOG_HOST, and it does NOT serve the
//     REST API. Point a script at it and every call 404s.
//   • API host     https://eu.posthog.com    — the app + REST API. That is
//     what these scripts talk to. Override with POSTHOG_API_HOST.
//
// TWO KEYS, AND THEY ARE NOT INTERCHANGEABLE:
//   • phc_…  project key. PUBLIC, write-only, ships in the browser bundle.
//     It CANNOT read anything back. This is why "PostHog is receiving events"
//     and "we can see the numbers" were two different problems.
//   • phx_…  personal API key. SECRET. Never commit it, never paste it into
//     chat, never put it in NEXT_PUBLIC_*. Read from the env only.
//
// Env:
//   POSTHOG_PERSONAL_API_KEY   phx_… (required)
//   POSTHOG_API_HOST           default https://eu.posthog.com
//   POSTHOG_PROJECT_ID         optional; auto-discovered when omitted
// ─────────────────────────────────────────────────────────────────────────

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const INGEST_HOSTS = ["i.posthog.com", "eu.i.posthog.com", "us.i.posthog.com"];

export const API_HOST = (
  process.env.POSTHOG_API_HOST ?? "https://eu.posthog.com"
).replace(/\/$/, "");

// Which key this process should use.
//
// 🧨 TWO KEYS EXIST FOR A REASON, so the code has to actually honour it. The
// docs described a permanent READ-ONLY key and a temporary WRITE key, and the
// client read only the first, which meant provisioning would have quietly
// authenticated as the read-only key and 403'd. Worse, the reverse mistake
// (reads running on the write key) would have worked, hiding the fact that the
// read key was over-scoped.
//
// Default is read. The provisioning script opts in explicitly.
let keyMode: "read" | "write" = "read";

/** Called once, at the top of a script that needs to WRITE. */
export function useWriteKey(): void {
  keyMode = "write";
}

export function requireKey(): string {
  if (keyMode === "write") {
    const write = process.env.POSTHOG_PROVISIONING_API_KEY;
    if (write) return checkedKey(write, "POSTHOG_PROVISIONING_API_KEY");
    console.error(
      "POSTHOG_PROVISIONING_API_KEY is not set, and this command WRITES.\n" +
        "Create a temporary key with dashboard:write + insight:write, run this\n" +
        "once, then delete it and prove it dead with `pnpm posthog:revoked-check`.\n" +
        "Refusing to fall back to the read-only key: that would fail with a\n" +
        "403 halfway through and leave the six dashboards half-created.",
    );
    process.exit(1);
  }
  const key = process.env.POSTHOG_PERSONAL_API_KEY;
  if (!key) {
    console.error(
      "POSTHOG_PERSONAL_API_KEY is not set.\n" +
        "Create one at " +
        API_HOST +
        "/settings/user-api-keys and add it to .env.local\n" +
        "(personal keys start with phx_ . The phc_ project key in\n" +
        " NEXT_PUBLIC_POSTHOG_KEY is write-only and cannot read anything.)",
    );
    process.exit(1);
  }
  return checkedKey(key, "POSTHOG_PERSONAL_API_KEY");
}

function checkedKey(key: string, varName: string): string {
  if (key.startsWith("phc_")) {
    console.error(
      `${varName} holds the PROJECT key (phc_), which is write-only: it can\n` +
        "send events but cannot read them back. A personal API key (phx_) is\n" +
        "what these scripts need.",
    );
    process.exit(1);
  }
  if (INGEST_HOSTS.some((h) => API_HOST.includes(h))) {
    console.error(
      "POSTHOG_API_HOST points at the INGEST host (" +
        API_HOST +
        ").\n" +
        "The REST API lives on https://eu.posthog.com (or us.posthog.com).",
    );
    process.exit(1);
  }
  return key;
}

type Json = Record<string, unknown>;

// Every call goes through here so a non-2xx is always LOUD. A silent empty
// result is the failure mode this whole task exists to fix, so the client
// refuses to return one: it throws with the status and the body PostHog sent,
// which is where the useful message ("missing scope query:read") actually is.
export async function ph<T = Json>(
  path: string,
  init?: { method?: string; body?: Json },
): Promise<T> {
  const res = await fetch(API_HOST + path, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${requireKey()}`,
      "Content-Type": "application/json",
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `PostHog ${init?.method ?? "GET"} ${path} -> ${res.status}\n${text.slice(0, 800)}`,
    );
  }
  return (text ? JSON.parse(text) : {}) as T;
}

// The numeric project id. Maria should never have to go hunting for it in the
// URL bar, so it is resolved from the key itself unless pinned in env.
//
// 🧨 TWO SCOPE LESSONS, both learned by running it against a real key rather
// than by reading the docs:
//
//  1. This used to call /api/users/@me/, which needs `user:read` — a scope that
//     hands over the account holder's own profile and has nothing to do with
//     reading analytics. A read-only analytics key must not need it.
//  2. A key restricted to specific PROJECTS (the tightest, correct setting) is
//     refused by every LISTING endpoint: /api/projects/, /api/organizations/
//     and /api/environments/ all return 403 "API keys with scoped projects are
//     only supported on project-based endpoints."
//
// /api/projects/@current/ is a project-based endpoint, so it works with exactly
// the scoping we want: project-restricted, `project:read`, nothing more.
export async function resolveProjectId(): Promise<number> {
  const pinned = process.env.POSTHOG_PROJECT_ID;
  if (pinned) {
    const n = Number(pinned);
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(
        `POSTHOG_PROJECT_ID must be a positive integer, got "${pinned}".`,
      );
    }
    return n;
  }

  const current = await ph<{ id?: number }>("/api/projects/@current/");
  if (typeof current.id !== "number") {
    throw new Error(
      "Could not resolve a project from this key.\n" +
        "Give it `project:read`, or pin POSTHOG_PROJECT_ID in .env.local " +
        "(the number in the PostHog URL: /project/<id>/...).",
    );
  }
  return current.id;
}

// HogQL is the stable read surface: one shape, no insight-filter dialect.
export async function hogql<Row = unknown[]>(
  projectId: number,
  query: string,
): Promise<{ results: Row[]; columns: string[] }> {
  const out = await ph<{ results: Row[]; columns?: string[] }>(
    `/api/projects/${projectId}/query/`,
    { method: "POST", body: { query: { kind: "HogQLQuery", query } } },
  );
  return { results: out.results ?? [], columns: out.columns ?? [] };
}
