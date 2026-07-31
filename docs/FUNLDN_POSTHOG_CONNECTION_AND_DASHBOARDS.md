# PostHog connection and dashboard provisioning

**Branch:** `feat/posthog-read-and-dashboards`, cut from `main` @ `0d35d47`.
**Scope:** five scripts under `scripts/`, two guard tests under
`scripts/__tests__/`, five `package.json` entries, and these two documents. No
app code, no database, no anon-reachable route. (This said "three files and four
entries" for a while, and drifted as the branch grew.)

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
**`/api/projects/@current/`**. The numeric project id is treated as sensitive by
the same rule as everything else and is not recorded here.

> ⚠️ This sentence used to name `/api/users/@me/`, contradicting the scopes
> section above, which says in bold **not** to grant `user:read`. A reader
> following the old wording would have over-scoped the permanent key to reach an
> endpoint the client abandoned for exactly that reason.

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
| **0** | PostHog answered **401 `authentication_failed`**: the string is not a credential. **Confirmed dead.** |
| **1** | 🔴 **Still live.** Either PostHog accepted it (2xx), or it answered **403** — which means the key AUTHENTICATED and was then refused for missing scope. Delete it and re-run. |
| **2** | Nothing was proven: no key supplied, the request never got there, or an answer the script cannot classify. **Not a pass.** |

🧨 **403 IS NOT A REJECTION, and this table used to say it was.** On this project
a live, correctly-scoped personal key returns 403 from `/api/users/@me/` because
it deliberately lacks `user:read`. Reading that as "revoked" meant the one script
written to stop a write-capable key being certified dead would have certified it
dead. Demonstrated against the live API: the permanent read-only key, which had
just listed 32 insights, produced `403` and the old check printed
`CONFIRMED REVOKED ... exit 0`. If you see exit 1 on a 403, the script is right
and the key is alive.

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
| #189's ten new events | ⏳ **still not arriving from real users** | Re-checked 2026-07-30 after #189 deployed. `plan_setup_started` shows exactly ONE event, and it is **mine**, from the probe that proved #189 was live. Nothing organic. Dashboard 5 therefore stays on proxies. |
| #189's ten new events (earlier note) | ⏳ | Checked over 90 days on 2026-07-30: every one reads `never`. #189 merged the same afternoon, so production has not yet had traffic through those paths. This is why Dashboard 5 stays on proxies. Re-run `pnpm posthog:verify -- --all` in a few days. |
| `sign_in_complete` | 🔎 **0 over 90 days** | Empirical confirmation of the bug #189 fixed: `SignInTracker` mounted before `AnalyticsGate`, so the event was dropped before PostHog initialised. It has literally never arrived. Expect it to start appearing now. |
| Permanent read-only key | ✅ **created and working** | Created 2026-07-30. Never printed, never committed. |
| Temporary provisioning key | ✅ **revoked in the console, and removed from `.env.local`** — see the caveat | 🧨 It cannot be revoked through the API: PostHog answers `GET /api/personal_api_keys/` with *"This action does not support personal API key access"*, by design, so this was a console action. Confirmed 2026-07-31: `POSTHOG_PROVISIONING_API_KEY` is absent from `.env.local` and from the shell, and the remaining permanent key `403`s on both writes. ⚠️ **What was NOT produced is a 401/403 round trip for the deleted key itself**, because doing that needs its value and the value is (correctly) gone. `pnpm posthog:revoked-check` exits **2** — "nothing was tested, this is NOT a pass" — which is the honest answer, not a failure. If you want that proof, capture the key value at deletion time and run the check immediately, before removing the line. |
| Dashboards filtered to production traffic | 🔴 **in code, NOT on the live dashboards** | Every insight is now scoped to `$host IN ('funldn.com','www.funldn.com')`, mutation-tested four ways. Applying it live needs a write key, which has been revoked. **Until re-provisioned the live dashboards still count dev and preview traffic.** See Known limitations. |
| Insights still correctly provisioned | ✅ **re-verified 2026-07-31** | All 26 code-defined insights exist in the project, 0 missing, 0 duplicate names. The 6 extra insights in the project are PostHog's own defaults (DAUs, WAUs, Retention, Growth accounting, Referring domain, Pageview funnel). Dashboard *grouping* was not re-checked: the read key has no `dashboard:read` and 403s on `/dashboards/`. |
| Dashboards provisioned | ✅ **done 2026-07-30** | 6 dashboards, 26 insights. Verified **against the live project**, not from the script's own scoreboard: 4+4+5+4+5+4 = 26, no duplicate dashboard names, no duplicate insight names. |
| Provisioning is idempotent | ✅ **proven twice** | Two further runs, both `dashboards_created: 0, dashboards_reused: 6, insights_created: 0, insights_updated: 26`. |
| Filters and date ranges | ✅ **reviewed live** | All 18 visualisation insights carry `dateRange: -30d` and their breakdowns; the 8 HogQL tables carry their own window in SQL. 18 + 8 = 26. ⚠️ A first pass reported all of them as missing a date range: PostHog wraps `TrendsQuery`/`FunnelsQuery` in an `InsightVizNode`, so the range sits at `query.source.dateRange`, one level deeper than the naive check looked. The checker was wrong, not the dashboards. |
| Read-only key cannot write | ✅ **re-proven 2026-07-30** | POST to `/dashboards/` and `/insights/` both 403. |
| `fl_probe_manual` excluded | ✅ **by construction, and confirmed live** (0 insights in the project reference it) | Every one of the 26 insights is scoped to explicit event names, so an unnamed event cannot be swept in. Pinned by `scripts/__tests__/posthog-dashboards.test.ts`. A project-level filter is still worth adding in the PostHog UI for ad-hoc exploration. |
| Verifier covers every event | ✅ | It no longer keeps a hand-maintained list. It reads the `AnalyticsEvent` union from `lib/analytics.ts` at runtime and refuses to run if the parse returns an implausibly small list. The old hand-list had drifted to **13 of 33 events missing**. |

### Two things learned provisioning for real

**Pin `POSTHOG_PROJECT_ID` in `.env.local`.** Then the write key needs *only*
`dashboard:write` + `insight:write` — no `project:read`, because nothing has to
resolve the project. Tighter, and it is one fewer scope to remember to revoke.
The value is not a credential, but it is not recorded in this repository either.

**PostHog caps `description` at 400 characters** on insights and dashboards. Two
descriptions were over and the first provisioning run failed part-way through,
after creating two dashboards. That was harmless *because provisioning is
idempotent*: shortening them and re-running reused what existed and continued.
Had it not been idempotent, the recovery would have been manual cleanup. Keep
long-form caveats in this repository's docs and keep the in-product text short.

### Test data this work put into the production project

Disclosed rather than left for someone to find:

| What | Where from | Action |
| --- | --- | --- |
| `fl_probe_manual` (distinct_id `fl-cdp-probe`) | Proving the capture endpoint was reachable, 2026-07-29 | Excluded from all 26 insights by construction; a test asserts it |
| One `plan_setup_started` + `plan_preview_built` | Proving #189 was actually deployed to production | Negligible, but it is why that event reads 1 and not 0 |
| `localhost:3011` URLs, and a synthetic room code `ZZTST9` inside `$heatmap_data` | The leak audit for the invite fix. **The dev server uses the production `phc_` key**, so local events land in the real project. `ZZTST9` is not a real room. | Worth a PostHog filter excluding `$current_url` containing `localhost`, so local development never pollutes product numbers again |

The last row is the one worth acting on: nothing stops any local `pnpm dev` session from writing into production analytics.

## Known limitations

- 🧨 **THE PRODUCTION-TRAFFIC FILTERS ARE IN CODE BUT NOT YET ON THE LIVE
  DASHBOARDS.** Every insight is now scoped to `$host IN ('funldn.com',
  'www.funldn.com')` so that localhost, preview deployments and deliberate
  probes stop being counted (see `PROD_HOSTS` / `PROD_ONLY_SQL` in
  `scripts/posthog-provision-dashboards.ts`). Applying that to the live project
  means re-running `pnpm posthog:dashboards`, which needs a WRITE-scoped key —
  and the temporary provisioning key has been revoked, correctly, and must not
  be recreated casually. So:

  **Until someone re-provisions, the six dashboards on the wall are still
  counting dev and preview traffic in their 30-to-90-day windows.** Treat their
  absolute numbers as contaminated. The app-side gate (`PRODUCTION_HOSTS` in
  `lib/analytics.ts`) stops NEW contamination at source the moment it deploys;
  it cannot retract what is already stored.

  To apply: create a fresh temporary key with `dashboard:write` + `insight:write`
  ONLY, put it in `.env.local` as `POSTHOG_PROVISIONING_API_KEY`, run
  `pnpm posthog:dashboards` (idempotent: it updates the 26 existing insights in
  place and creates nothing), then delete the key and prove it with
  `pnpm posthog:revoked-check`.
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
  reporting.** No production event was deleted to make this true. It is excluded
  twice over: no insight names it, pinned by a test, and it was captured from a
  headless localhost session so the `$host` filter above drops it anyway.
- **Access scope:** dashboards are visible to the PostHog project's members. There
  is no per-dashboard sharing configured and no public link is created.
- **The read-only key cannot LIST dashboards** (`dashboard:read` was not granted,
  and is not needed by `pnpm posthog:verify`). If you later want to audit
  dashboards through the API with the permanent key, add `dashboard:read` to it.
  Scopes can be edited on an existing key; it does not need recreating.
- **Every count is a floor.** All capture is behind the opt-out consent gate, so
  ratios are usable and absolute volumes are not.

## Rollback

Nothing here changes the application, so there is no user-visible rollback.

- **Undo the dashboards:** delete them in the PostHog UI (Dashboards, then delete
  each of the six by name). Insights created by the script are attached to those
  dashboards and can be deleted with them. **Deleting a dashboard does not delete
  events**; historical data is untouched and re-running
  `pnpm posthog:dashboards` recreates everything from code.
- **Undo the branch:** five scripts under `scripts/`, two guard tests under
  `scripts/__tests__/`, five `package.json` entries and two documents. Revert the
  MERGE COMMIT (`git revert -m 1 <sha>`), not "the single commit" as this used to
  say: the branch has had review rounds, and this repo squash-merges, so which of
  those is true depends on how it landed. Check `git log origin/main` first.
  A partial revert can leave a guard test importing a deleted module.
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
