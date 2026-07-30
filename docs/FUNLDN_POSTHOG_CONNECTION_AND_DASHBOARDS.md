# PostHog connection and dashboard provisioning

**Branch:** `feat/posthog-read-and-dashboards`, cut from `main` @ `0d35d47`.
**Scope:** `scripts/` and four `package.json` entries. No app code, no database,
no anon-reachable route.

Companion documents (on `feat/analytics-foundation`):
`FUNLDN_ANALYTICS_INSTRUMENTATION.md`, `FUNLDN_ANALYTICS_EVENT_DICTIONARY.md`.
Dashboard contents: `FUNLDN_ANALYTICS_DASHBOARD_MANIFEST.md`.

**No secret value appears in this repository, in any commit, in any log, or in
this document.** Keys live only in `.env.local` (git-ignored, verified untracked)
or in a secure environment store.

## The problem this solves

PostHog has been ingesting production events since 2026-06-16. It has never been
**readable**. The only key in the app is the browser project key (`phc_`), which
is public by design and **write-only**: it can send events and cannot read a
single aggregate back. Every product question that navigation, the landing page,
Events placement, Map priority and audience decisions are waiting on was
therefore unanswerable.

## Two hosts, and confusing them is the most common failure

| | Host | Purpose |
| --- | --- | --- |
| Ingest | `https://eu.i.posthog.com` | Where the browser SDK posts events. This is `NEXT_PUBLIC_POSTHOG_HOST`. **It does not serve the REST API.** |
| API | `https://eu.posthog.com` | The app and the REST API. This is what the scripts talk to. Override with `POSTHOG_API_HOST`. |

`scripts/posthog-api.ts` refuses to run if `POSTHOG_API_HOST` points at an ingest
host, and refuses a `phc_` key where a personal key is required. Both produce a
clear error rather than a 404 loop.

## Keys: scopes and lifecycle

Two keys, created by Maria at `https://eu.posthog.com/settings/user-api-keys`.
Claude cannot create them; they require the account owner's console.

### Permanent read-only key

| | |
| --- | --- |
| Env var | `POSTHOG_PERSONAL_API_KEY` |
| Scopes | `query:read`, `insight:read`, `project:read` |
| Used by | `pnpm posthog:verify` |
| Lifetime | Permanent |

This is all the verification path ever needs. It **cannot** create a dashboard,
update an insight, delete anything, or change a project setting.

### Temporary provisioning key

| | |
| --- | --- |
| Env var | `POSTHOG_PROVISIONING_API_KEY` |
| Scopes | `query:read`, `insight:read`, `project:read`, `dashboard:write`, `insight:write` |
| Used by | `pnpm posthog:dashboards`, once |
| Lifetime | **Delete immediately after the provisioning run** |

### Never

- A project-admin key.
- A broad personal key carrying unrelated write scopes.
- The browser ingest key (`phc_`) as a read key. It cannot read; the script
  rejects it explicitly.
- A key in a commit, in terminal output, in a document, or pasted into chat.

`POSTHOG_PROJECT_ID` is optional: the client resolves the project from the key via
`/api/users/@me/`. The numeric project id is treated as sensitive by the same rule
as everything else and is not recorded here.

### Revocation confirmation

Deleting the provisioning key is not complete until it is **proven dead**:

```bash
POSTHOG_PERSONAL_API_KEY="$POSTHOG_PROVISIONING_API_KEY" pnpm posthog:verify
```

A revoked key must return **401**. A success means the key is still live.

## Commands

```bash
pnpm posthog:verify              # counts the 4 required events, last 30 days
pnpm posthog:verify -- --days=90 # wider window
pnpm posthog:verify:all          # the whole AnalyticsEvent union
pnpm posthog:dashboards:dry      # print the 6 dashboards + 26 insights, OFFLINE
pnpm posthog:dashboards          # create or update them, idempotently
```

`posthog:dashboards:dry` is deliberately **offline**: it needs no key, so the six
dashboards can be reviewed in a pull request before any key exists.

`posthog:verify` **exits 1** when a required event has never fired. Zero is a
broken funnel, not a quiet success. This repo has been burned by a green tick over
a job that no-opped for nine weeks, so the script answers "what number changed?"
rather than "did it run?".

## Provisioning procedure

1. `pnpm posthog:dashboards:dry` and keep the output as the review manifest. It
   must read **6 dashboards, 26 insights**.
2. Put the provisioning key in `.env.local`.
3. `pnpm posthog:dashboards` **once**. It prints a scoreboard of integers and
   exits 1 if nothing was written.
4. Re-run it. The second run must report `dashboards_reused: 6` and
   `insights_updated: 26`, with **zero** created. That is the idempotency proof.
5. Open each dashboard and check the names against the manifest.
6. Delete the provisioning key, then run the revocation check above.
7. Keep only the permanent read-only key.

Matching is **by name**. Renaming an insight in the PostHog UI will make the next
run create a duplicate; rename it in
`scripts/posthog-provision-dashboards.ts` instead.

## Known limitations

- ⚠️ **The provisioning payload shapes follow the documented PostHog API but have
  never been executed against a live project**, because no key exists yet. The
  first real run is the test. If a `FunnelsQuery` or `TrendsQuery` field name has
  drifted, the script fails loudly with PostHog's own error message attached,
  which is where the useful text is.
- **Dashboard 5 is partial by construction.** See the manifest.
- **`fl_probe_manual`** (distinct_id `fl-cdp-probe`) is one test event sitting in
  the production project from proving the capture endpoint was reachable during
  the 2026-07-29 investigation. Harmless but real. **Exclude it from all
  reporting.** No production event was deleted to make this true.
- **Access scope:** dashboards are visible to the PostHog project's members. There
  is no per-dashboard sharing configured and no public link is created.
- **Every count is a floor.** All capture is behind the opt-out consent gate, so
  ratios are usable and absolute volumes are not.

## Rollback

Nothing here changes the application, so there is no user-visible rollback.

- **Undo the dashboards:** delete them in the PostHog UI (Dashboards, then delete
  each of the six by name). Insights created by the script are attached to those
  dashboards and can be deleted with them. **Deleting a dashboard does not delete
  events**; historical data is untouched and re-running
  `pnpm posthog:dashboards` recreates everything from code.
- **Undo the branch:** it is three files under `scripts/` plus four
  `package.json` script entries. `git revert` of the single commit is complete and
  safe.
- **Undo read access:** delete the personal API key in the PostHog console. The
  app is unaffected: it uses only the `phc_` browser key.

## Verification of the four required events

Runtime-verified on production, signed out, on 2026-07-29 via headless Chrome and
raw CDP, decompressing the gzipped capture payloads and reading event names off
the wire:

| Event | Status |
| --- | --- |
| `venue_save` | ✅ observed reaching the capture endpoint |
| `venue_unsave` | ✅ observed |
| `together_room_create` | ⏳ pending: needs a signed-in session |
| `together_room_join` | ⏳ pending: needs a signed-in session |

The two group events are **not broken**. `app/(main)/plan/together/page.tsx`
returns the auth wall for anonymous visitors, so `TogetherFlow` (which fires both
on mount) never mounts. Verifying them needs either a signed-in session on a
secure staging deployment, or `pnpm posthog:verify` once the read key exists.

**Update 2026-07-30: the secure group-room environment now EXISTS in production.**
`fix/group-room-security` merged as
[PR #187](https://github.com/mparanzales/fun-london/pull/187) (`main` @ `da88c2f`),
main auto-deploys, and the merge is confirmed live: the room-code stripper's
replacement string is present in the deployed production bundle. So the brief's
condition ("verify group events only against the secure group-room environment")
is now satisfiable in prod rather than blocked on a staging deploy.

What still blocks the two events is narrower: **a signed-in session**.
`app/(main)/plan/together/page.tsx` returns the auth wall for anonymous visitors,
so `TogetherFlow` (which fires both events on mount) never mounts. Two ways to
close it, either is sufficient:
1. **`pnpm posthog:verify` once the read-only key exists** — it counts both events
   across all real users and exits 1 if either has never fired. No manual session
   needed. This is the recommended route.
2. A signed-in session on prod, driven manually. Not needed if (1) is run.

⚠️ Do **not** verify them by creating rooms in production and reading room codes
out of the analytics feed. Until
[PR #189](https://github.com/mparanzales/fun-london/pull/189) merges, two of the
three room-code leak paths it fixes are **live**, so that method would be reading
bearer credentials out of PostHog. #189 hardens the stripper; verify after it
lands.

### 🧨 The false alarm, recorded so nobody repeats it

The first probes showed **zero** capture requests from production, including no
`$pageview`, while PostHog visibly initialised. That reads exactly like a dead
pipeline and was nearly reported as an outage.

**Cause: posthog-js drops events client-side when it detects automation**
(`navigator.webdriver === true`, a headless user-agent). Hiding those two signals
turned 0 capture requests into 6.

Any future headless analytics check must launch with
`--disable-blink-features=AutomationControlled`, set a realistic user-agent, and
inject `Object.defineProperty(navigator, 'webdriver', { get: () => undefined })`
via `Page.addScriptToEvaluateOnNewDocument`, or it will report a false P0.

Also tested and **cleared** in the same session: downgrading `posthog-js` to the
pre-#184 version `1.387.0` changed nothing, so the version bump is not a suspect.
Do not re-investigate it.
