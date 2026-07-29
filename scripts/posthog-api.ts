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

export function requireKey(): string {
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
  if (key.startsWith("phc_")) {
    console.error(
      "That is the PROJECT key (phc_), which is write-only: it can send\n" +
        "events but cannot read them back. A personal API key (phx_) is\n" +
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
// URL bar, so we resolve it from the key itself unless it is pinned in env.
export async function resolveProjectId(): Promise<number> {
  const pinned = process.env.POSTHOG_PROJECT_ID;
  if (pinned) return Number(pinned);
  const me = await ph<{
    team?: { id: number; name: string };
    organization?: { name: string };
  }>("/api/users/@me/");
  if (!me.team?.id) {
    throw new Error(
      "Could not resolve a project from this key. Set POSTHOG_PROJECT_ID in\n" +
        ".env.local (the number in the PostHog URL: /project/<id>/…).",
    );
  }
  return me.team.id;
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
