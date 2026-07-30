# Fun London analytics instrumentation

**Branch:** `feat/analytics-foundation`, **rebased onto `main` @ `da88c2f`** (which includes the merged group-room security work, [PR #187](https://github.com/mparanzales/fun-london/pull/187)). Originally cut from `0d35d47`.
**Scope:** the measurement layer only. No dashboards, no keys, no migrations, no
product behaviour changes beyond instrumentation and two defects found on the way.

Companion documents:
- `FUNLDN_ANALYTICS_EVENT_DICTIONARY.md` — every event and property, with the
  reachability caveats. Read that before interpreting any number.
- `FUNLDN_POSTHOG_CONNECTION_AND_DASHBOARDS.md` (on
  `feat/posthog-read-and-dashboards`) — key scopes, provisioning, the six
  dashboards.

## What this branch closes

Six gaps, in the order they were built. The order matters: steps 1 to 3 are
prerequisites, because instrumenting before them ships events that either never
reach PostHog or leak a room code on every pageview.

### 1. Common properties, derived not registered

`auth_state`, `viewport_bucket` and `entry_surface` now ride on every event and
on `reportError`, added in `track()` so no call site has to remember them.

**The design decision worth keeping:** they are **derived per event**, not
PostHog super-properties. `posthog.register()` was the obvious implementation and
is the wrong one. Persistence is localStorage; register state is cleared only by
`posthog.reset()`. On a shared browser that means `auth_state: "signed_in"` would
be stamped onto the next person's anonymous session. Deriving costs three cheap
reads per event, cannot leak across identities, and keeps the Vercel leg
identical to the PostHog leg (which `register()` would not).

`auth_state` comes from a module variable set by `AuthUserProvider` on every auth
transition. It receives the **coarse enum**, never the uuid.

### 2. A property sanitizer on the path that leaves the country

`track()` previously stripped only `undefined`. `recordSignal()`, which writes to
**our own database**, already dropped identifying keys and clamped long strings.
The unguarded path was the one going to two third parties.

The same guard is now applied in `track()`, plus bearer-shaped key names
(`room_code`, `invite_code`, `join_code`, `share_link`, `code`) blocked whole.
`room_id` is deliberately allowed: it is an opaque row uuid with no join
capability and it is the only correlation property the group-security events
carry. Blocking it would have silently stripped them.

This is a backstop, not a licence. Call sites still pass coarse values.

### 3. A pending-event queue, and the provider order

`track()` dropped every event fired before `AnalyticsGate` ran its effect. That
is why `sign_in_complete` reached Vercel and never reached PostHog:
`SignInTracker` mounted as a sibling of the gate, so `posthogReady` was false at
fire time. Adding a `trigger` property to a dropped event would have been wasted
work.

The existing `pendingIdentify` variable proves the race was known for
`identify()` and unhandled for `track()`. Now: a bounded queue (20 events),
flushed in `posthog.init`'s `loaded` callback **after** identify so queued events
land on the person, with **consent re-checked at flush time** so a visitor who
declines during the window has their queue discarded. `resetAnalyticsIdentity()`
also clears it, so one account's queue cannot replay onto the next.

Belt and braces: `<AnalyticsGate />` now mounts **above** `<SignInTracker />` in
`components/authed-providers.tsx`.

### 4. Generation failure and latency

The gap that made dashboard 5 dishonest.

- The anon builder's `limited` and `soft` branches set UI state and emitted
  **nothing**. `res.reason` was computed and thrown away.
- A zero-stop result was emitted as `plan_generate`, i.e. every no-result was
  counted as a success.
- No event carried a duration.

Now: `plan_generate_failed` and `plan_preview_failed` with closed reason
categories, and `duration_ms` timed around the actual work on both surfaces. The
success events gate on `steps.length === 0` so a failure is no longer
double-counted as a success.

Failure categories are mapped in `lib/analytics-reasons.ts` from error **codes and
statuses only**. Nothing that came out of an error object becomes a property.

### 5. The save split

`plan_save_tapped` / `plan_save_succeeded` / `plan_save_failed`, with a
controlled `mode`, an `attempt` counter, and a mapped failure reason.

`plan_save` is **dual-emitted until 2026-09-30** because every existing insight
keys on it. New dashboards must count `plan_save_succeeded` and must not also
count `plan_save`.

**Known limitation, documented rather than solved here:** save idempotency is a
separate product-foundation task. Today the in-flight `saveState === "saving"`
guard is the only protection against a double tap, and there is no unique
constraint or upsert. So `plan_save_tapped` can in principle exceed the insert
count under a fast enough double tap. `attempt` makes that visible.

### 6. Attribution

- **Booking:** `venue_reserve_click` gains `from_plan`, `stop_index` and
  `entry_surface`, resolved from a one-shot sessionStorage handoff written by the
  plan stop link.
- **Sign-in:** `sign_in_complete` gains an allow-listed `trigger`, armed on the
  CTA click, carried in localStorage with a 15-minute TTL, consumed one-shot.

Neither uses a query string. Two independent reasons:
`lib/safe-redirect.ts` passes any site-internal path through `/auth/callback`
**including its query string**, so a query-string trigger would be
caller-controllable and would land in `$current_url` on every event; and adding
`searchParams` or `useSearchParams()` to the venue route would opt it out of
static rendering and kill the `/anon/venue/[slug]` ISR cache.

The one-shot read removes the value **before** validating it. Without that, the
failure paths in `/auth/callback` (which arm a trigger and never consume it)
would attribute a visitor's next successful sign-in, days later, to the wrong
door.

### Also: explore instrumentation

`explore_filter_applied`, `card_dismissed`, `feed_end_reached`,
`near_you_result`. The traps each one avoids are in the event dictionary; the
short version is that none of them is fired from an effect or from an
IntersectionObserver, because both replay on back-navigation.

## Two defects fixed while in here (not instrumentation)

Called out separately rather than smuggled in as analytics:

1. **A rejected anon server action left the Build button stuck forever.**
   `setBuilding(false)` sat after the `await`, so a rejection skipped it and the
   button stayed disabled on "Building your night". Now recovered in the new
   catch path.
2. **`search_query` sent the raw user-typed query** to PostHog EU and Vercel, two
   lines above a comment promising "never the raw text, no PII" for the other
   sink. A search box is free text. Now `q_len` only. ⚠️ **This drops a
   property**: any insight breaking `search_query` down by `q` will go blank.

## Privacy posture

Verified as part of this work:

| Requirement | Status |
| --- | --- |
| Consent-gated | Yes. Single gate at the top of `track()`, opt-out (`fl.consent.v1`). Tested that a declined visitor reaches NEITHER provider, with a positive control. |
| EU endpoint | Yes. `api_host` defaults to `https://eu.i.posthog.com`; pinned by a test. |
| Cookieless, no recordings | Yes. `persistence: "localStorage"`, `disable_session_recording: true`, `person_profiles: "identified_only"`. Unchanged. |
| Sign-out resets identity | Yes, and widened. `resetAnalyticsIdentity()` is now called from `AuthUserProvider` on the sign-out transition, using the same `isSignOutTransition` helper the saved/bookings contexts use. Previously only two profile buttons did it, so a token expiry, a sign-out in another tab, or cleared cookies left the person attached. |
| No PII added | Yes. Every new non-numeric property comes from a closed union. Sanitizer as a backstop. |
| No exact location | Yes. `near_you_result` reports the outcome only. A source guard test asserts no explore event references `geo`, `lat`, `lng`, `distance` or the geo-bearing view key. |
| No raw exception text | Yes. `lib/analytics-reasons.ts` maps codes and statuses only; a guard test asserts no `track()` call in either plan flow references `error.message`, `error.details`, `error.hint` or `String(err)`. |
| No full plan payload, no alternatives | Yes. Save events carry the coarse bag only: no title, no `why_it_works`, no venue names or ids. `plan_open_maps` still sends a stop count, never the maps URL. |
| No room code in pageview URLs | ✅ **Now covered, and verified live on production.** `sanitize_properties: stripRoomCodes` came in from [PR #187](https://github.com/mparanzales/fun-london/pull/187) and was kept verbatim through the rebase. Confirmed present in the deployed prod bundle. |

### The room-code gap: closed, and how

`capture_pageview` plus `autocapture` attach `$current_url` to every event,
including autocaptured clicks, and `/plan/together?room=CODE` puts a **bearer
credential** in the address bar. A code lifted from the analytics feed is a
working key to a live room.

This branch deliberately did **not** write that fix, because it already existed on
`fix/group-room-security`, in the same `posthog.init` call this branch edits. A
second copy would have guaranteed a conflict and made no user safer while both
branches were unmerged.

**That branch merged on 2026-07-30 ([PR #187](https://github.com/mparanzales/fun-london/pull/187)), this branch was rebased onto it, and the
resolution kept BOTH sides**: `sanitize_properties: stripRoomCodes` and this
branch's pending-event queue now live in the same `posthog.init` call. Verified
live: the stripper's replacement string is present in the deployed production
bundle.

Two guards keep the resolution honest, because a careless future conflict in that
exact hunk is precisely how one side's protection gets silently dropped:
`analytics-instrumentation-guard.test.ts` asserts `sanitize_properties:
stripRoomCodes` and `function stripRoomCodes(` are both present, that the three
`together_*` event names survived, and that this branch's own ten survived too.

The `track()` key sanitizer protects **explicit event properties** independently,
and its carve-out for `room_id` is now load-bearing: `together_room_expired` and
`together_host_handoff` send `{ room_id }` as their only correlation property, and
a broader block would have silently stripped them. A test pins that.

## Merge order: steps 1 and 2 are DONE

1. ~~`fix/group-room-security` first.~~ **Merged 2026-07-30 as
   [PR #187](https://github.com/mparanzales/fun-london/pull/187)** (`main` @ `da88c2f`).
2. ~~Then this branch, rebased onto it.~~ **Done.** Two conflict hunks in
   `lib/analytics.ts`, both resolved by taking **both sides**:
   - the `AnalyticsEvent` union: #187's three `together_*` names **plus** this
     branch's ten;
   - `posthog.init`: #187's `sanitize_properties: stripRoomCodes` **plus** this
     branch's `loaded` callback with the identify-then-flush ordering and the
     consent re-check.
   Neither branch lost a privacy protection. Five new guard assertions pin it.
3. Product-foundation work (save idempotency, the `plans` UPDATE policy) is
   independent. When save idempotency ships, revisit the `plan_save_tapped` note
   above.
4. `feat/posthog-read-and-dashboards` ([#186](https://github.com/mparanzales/fun-london/pull/186))
   is independent: it touches only `scripts/` and four `package.json` entries.

⚠️ **This repo has a documented squash-merge hazard:** commits pushed to a branch
after its PR was squash-merged never reach `main`. After merging, verify the
instrumentation landed **by content** (grep `origin/main` for a changed line),
not by trusting the PR's Merged badge.

## Verification

- `pnpm check` green: **487 tests, 43 files** post-rebase (was 288 / 34 on the original base; the jump includes #187's own tests arriving via `main`).
- `pnpm build` green.
- `/anon/venue/[slug]` and `/anon/event/[id]` still prerender as SSG in the build
  output. This is the invariant most at risk from adding client code to the venue
  page, and it was checked explicitly.
- The anon moat guard (`lib/__tests__/plan-preview-guard.test.ts`) is green: the
  two new modules the anon flow imports are import-safe by construction
  (`lib/analytics-keys.ts` has zero imports; `lib/analytics-reasons.ts` imports
  only types, which are erased at build).
- **Not yet verified:** live event delivery. Every event above is
  code-verified and test-verified, and none has been observed arriving in
  PostHog, because the read key does not exist yet. That is the gate described in
  the connection document.

## New test files

| File | Covers |
| --- | --- |
| `lib/__tests__/analytics-contract.test.ts` | Common properties on every event, identical payload to both providers, viewport and position bucket boundaries, sanitizer rejection of 24 key shapes each with a positive control, `room_id` explicitly allowed, string clamping, EU config. |
| `lib/__tests__/analytics-consent-guard.test.ts` | Consent blocks both providers (with positive control), opt-out semantics, identity reset, and the pending queue: delivery, identify-before-flush ordering, discard on revoke, bounding, and no replay after reset. |
| `lib/__tests__/analytics-reasons.test.ts` | Every failure mapping, plus hostile input (SQL, an email inside a constraint message, a 5000-character string) always landing inside the closed set and never echoing the input. |
| `lib/__tests__/analytics-keys.test.ts` | One-shot semantics, slug scoping, TTL expiry, allow-list rejection of a script payload, corrupt values, and storage-throws-in-private-mode. |
| `lib/__tests__/analytics-instrumentation-guard.test.ts` | Static source guards: no raw error text in any `track()` call, fire-once latched by refs not effects, `feed_end_reached` not on the observer, swap `method` passed not inferred, no coordinates or venue ids on the new events, the three `together_*` events NOT redefined here, no `posthog.register`, gate mounts before tracker. |

The test environment is `node` with no jsdom, by deliberate long-standing repo
choice. Component click handlers therefore cannot be rendered and asserted on;
the static source guards are the strongest available substitute and are labelled
as such. Every negative assertion has a positive control, because three early
returns in `track()` make a vacuous pass the dominant failure mode.

## Open questions for Maria

These are decisions, not defects. None of them blocks the branch.

1. **`category_count` is 0 or 1** because the explore category chips are
   single-select. Shipped as `category` plus a 0/1 count. If you want a genuine
   multi-select category count, that is a product change.
2. **The `plan_save` dual-emit ends 2026-09-30.** Migrate insights before then.
3. **The `search_query` `q` property is gone.** If an insight used it, it needs
   `q_len`.
4. **A conversion bug found, not fixed:** the Save button is unmounted while a
   restored anon plan is on screen (`{!openedSaved && (`), so the
   highest-intent anon-to-signed-in moment has no Save button. Out of scope here;
   worth its own fix.
5. **`entry_surface` extends the `SignalSurface` vocabulary** with `event` and
   `direct`. Analytics-only: the DB CHECK constraint is untouched, but a join
   against `user_events` will not match those two values.
