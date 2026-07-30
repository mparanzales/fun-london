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
update an insight, delete anything, or change a project setting. **Proven, not
assumed** (2026-07-30): a POST to `/dashboards/` and a POST to `/insights/` both
came back `403 permission_denied` naming the missing `dashboard:write` /
`insight:write` scope, and nothing was created.

🧨 **Set "Organization & project access" to PROJECTS and pick the one project.**
That is the tightest setting and it is also the one that changes which endpoints
work: a project-scoped key is refused by every LISTING endpoint with
*"API keys with scoped projects are only supported on project-based endpoints"* —
`/api/projects/`, `/api/organizations/` and `/api/environments/` all 403. Only
project-based endpoints such as `/api/projects/@current/` work, which is what
`resolveProjectId()` uses.

🧨 **Do NOT add `user:read`.** An earlier version of `resolveProjectId()` called
`/api/users/@me/`, which needs it. That scope returns the account holder's own
profile and has nothing to do with reading analytics, so the resolver was changed
rather than the key widened. If anything ever asks for `user:read` again, fix the
caller.

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

Deleting the provisioning key is not complete until it is **proven dead by a real
HTTP round trip**:

```bash
export POSTHOG_REVOKED_KEY='the key you just deleted'
pnpm posthog:revoked-check
```

Three outcomes, deliberately distinguished:

| Exit | Meaning |
| --- | --- |
| **0** | PostHog rejected the key with 401/403. **Confirmed dead.** |
| **1** | 🔴 PostHog **accepted** it. The key is still live. Delete it and re-run. |
| **2** | Nothing was proven (no key supplied, or the request never got there). **Not a pass.** |

🧨 **The previous documented proof could not fail correctly, and it is worth
knowing why.** It was:

```
POSTHOG_PERSONAL_API_KEY="$POSTHOG_PROVISIONING_API_KEY" pnpm posthog:verify
```

The provisioning key lives in `.env.local`, and a shell does not source
`.env.local`, so `$POSTHOG_PROVISIONING_API_KEY` expanded to the **empty
string**. The prefix assignment still set the variable in the child environment,
and dotenv will not fill a key that is already present, so the script saw `""`,
printed "not set" and exited 1 **without making a single request**. Exit 1 is
also what a revoked key produces, so the operator would have read "never
contacted PostHog" as "confirmed revoked". Had the deletion not taken, a key
carrying `dashboard:write` and `insight:write` would have stayed live on a public
repo's project, certified dead by a check that never ran.

That is the repo's own recorded landmine: **a missing secret is `""`, not
`undefined`**, so the check goes quiet instead of failing. The new script reads
the key from the **shell**, not `.env.local` (a revoked key should not be in
`.env.local` at all), and refuses to treat "no key" as a pass.

## Commands

```bash
pnpm posthog:verify              # counts the 4 required events, last 30 days
pnpm posthog:verify -- --days=90 # wider window
pnpm posthog:verify:all          # the whole AnalyticsEvent union
pnpm posthog:dashboards:dry      # print the 6 dashboards + 26 insights, OFFLINE
pnpm posthog:dashboards          # create or update them, idempotently
pnpm posthog:revoked-check       # prove a deleted key is actually dead
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
6. Delete the provisioning key, then `export POSTHOG_REVOKED_KEY=...` and run
   `pnpm posthog:revoked-check`. It must exit **0**. Exit 2 means nothing was
   tested, which is not the same thing.
7. Keep only the permanent read-only key.

Matching is **by name**. Renaming an insight in the PostHog UI will make the next
run create a duplicate; rename it in
`scripts/posthog-provision-dashboards.ts` instead.

## Final verified state (2026-07-30)

What has actually been checked, and what has not. Nothing below is inferred.

| Item | State | Evidence |
| --- | --- | --- |
| PR #189 landed on `main` | ✅ | Verified **by content**, not by the Merged badge: `export function stripRoomCodes`, `NESTED_URL_PARAM_RE`, `MAX_SANITIZE_DEPTH`, `plan_setup_started`, `flushPendingEvents` and `first_control` are all present on `origin/main` @ `3ff37ed`. This repo has a documented squash-merge hazard, so the badge is not evidence. |
| Production is running the #189 sanitizer | ✅ | The deployed bundle carries the new stripper's distinctive markers (`%3f`, `redirect_uri`, the `return\|returnto\|next` alternation) that the old version did not have, AND it was confirmed **functionally**: a percent-encoded room URL on prod was captured leaving the browser as `$current_url = "https://www.funldn.com/sign-in?return=redacted"`, with a positive control proving payloads were being captured at all. |
| A residual leak in the same area | 🔴 → fixed in [PR #192](https://github.com/mparanzales/fun-london/pull/192) | The same capture showed the code still present in `$heatmap_data`, whose object is **keyed by the page URL**. #189 sanitised values, not keys. Heatmaps are enabled by the PostHog project's remote config, so no code review could have found it. |
| Permanent key is read-only | ✅ **proven** | POST to `/dashboards/` and `/insights/` both `403 permission_denied`, naming the missing write scopes. Nothing created. |
| `venue_save`, `venue_unsave` | ✅ **counted** | Real counts read back from the project on 2026-07-30, not just observed on the wire. |
| `together_room_create`, `together_room_join` | ✅ **counted** | Both firing, confirmed by `pnpm posthog:verify` on 2026-07-30 against the post-#187 secure environment. **No room code was exposed doing it:** the verifier counts events and never reads a property. This closes the item that was pending staging verification. |
| #189's ten new events | ⏳ **all zero, as expected** | Checked over 90 days on 2026-07-30: every one reads `never`. #189 merged the same afternoon, so production has not yet had traffic through those paths. This is why Dashboard 5 stays on proxies. Re-run `pnpm posthog:verify -- --all` in a few days. |
| `sign_in_complete` | 🔎 **0 over 90 days** | Empirical confirmation of the bug #189 fixed: `SignInTracker` mounted before `AnalyticsGate`, so the event was dropped before PostHog initialised. It has literally never arrived. Expect it to start appearing now. |
| Permanent read-only key | ✅ **created and working** | Created 2026-07-30. Never printed, never committed. |
| Temporary provisioning key | ⏳ | **Never created**, so nothing to revoke. |
| Dashboards provisioned | ⏳ | Not run. Dry run: 6 dashboards, 26 insights, offline. |
| `fl_probe_manual` excluded | ✅ by construction | Every one of the 26 insights is scoped to explicit event names, so an unnamed event cannot be swept in. Pinned by `scripts/__tests__/posthog-dashboards.test.ts`. A project-level filter is still worth adding in the PostHog UI for ad-hoc exploration. |
| Verifier covers every event | ✅ | It no longer keeps a hand-maintained list. It reads the `AnalyticsEvent` union from `lib/analytics.ts` at runtime and refuses to run if the parse returns an implausibly small list. The old hand-list had drifted to **13 of 33 events missing**. |

## Known limitations

- ⚠️ **The provisioning payload shapes follow the documented PostHog API but have
  never been executed against a live project**, because no key exists yet. The
  first real run is the test.
- ⚠️ **Dashboard 5 still ships proxies**, deliberately. #189 merged so the real
  events exist in code, but nobody has confirmed they are ARRIVING. Verify
  arrival first, then rewrite the panels, then delete the warning. Doing it in
  any other order puts a panel on the wall that nobody has checked. If a `FunnelsQuery` or `TrendsQuery` field name has
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
