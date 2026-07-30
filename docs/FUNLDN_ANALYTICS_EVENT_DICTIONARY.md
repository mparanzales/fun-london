# Fun London analytics event dictionary

**Source of truth:** the `AnalyticsEvent` union and the exported unions in
`lib/analytics.ts`. A typo is a compile error; this file is the prose around it.

**Branch:** `feat/analytics-foundation`, rebased onto `main` @ `da88c2f`. Last updated 2026-07-30.

Read the two rules at the top before using any number below.

## Two rules that apply to every number here

1. **Every count is a FLOOR, not a total.** All capture is behind the
   `fl.consent.v1` opt-out gate (`lib/analytics.ts`, `analyticsAllowed`). The
   undercount is not random, so ratios stay usable and absolute volumes do not.
2. **A flat line can mean NOT INSTRUMENTED.** Several enum values below are
   documented as structurally unreachable today. Check this file before
   diagnosing a zero as a tracking bug or as a product signal.

## Common properties: on every event

Derived per event in `commonProps()`. **Not PostHog super-properties** and never
`posthog.register()`: persistence is localStorage and register state is cleared
only by `reset()`, so on a shared browser `auth_state: "signed_in"` would be
stamped onto the next person's anonymous session.

| Property | Values | Notes |
| --- | --- | --- |
| `auth_state` | `anon`, `signed_in` | Coarse enum only. The Supabase uuid is never a property; PostHog learns identity through `identifyUser()`. Reset to `anon` on sign-out. |
| `viewport_bucket` | `mobile` (<640), `tablet` (640-1023), `desktop` (>=1024) | Read from `window.innerWidth` per event, never cached at init, so a rotation or resize is reflected. Non-finite or <=0 buckets as `mobile`. |
| `entry_surface` | `explore`, `feed`, `plan`, `friends`, `venue`, `saved`, `onboarding`, `search_results`, `event`, `direct` | Written on navigation clicks into sessionStorage (per tab). The first eight mirror `SignalSurface` in `lib/signals.ts` so funnels can be joined against `user_events`; `event` and `direct` are analytics-only. `direct` means we did not observe an entry, and it is deliberately a real value rather than a missing property. |

A call site may override any of the three; explicit props win.

## Property sanitizer

`sanitizeProps()` in `lib/analytics.ts` runs on every payload:

- drops `undefined`;
- drops keys matching the PII / precise-geo pattern (`lat`, `lng`, `coord*`,
  `geo*`, `email`, `phone`, `*name*`, `address`, `postcode`, `ip`, `*token*`,
  `device*`, `user*`, `session*`, `password`, `secret`), the same list
  `lib/signals.ts` already applied to our own database;
- drops bearer-shaped names whole: `room_code`, `roomcode`, `invite_code`,
  `join_code`, `share_link`, `room_link`, `code`;
- **allows `room_id`** on purpose. It is an opaque row uuid with no join
  capability, and it is the only correlation property the group-security
  events carry;
- clamps any string to 120 characters;
- warns in development when it drops something, because a silently thinner
  payload looks fine on a dashboard.

## Plan events

### `plan_setup_started`
Fires **once per mount**, on the first meaningful setup selection.

Not on page load, not on a restored plan, not on the Build button, not from an
effect. Latched by `setupStartedRef`. On the signed-in surface the latch sits
inside `editInputs`, the single choke point for all four setup controls; on the
anon surface it is `markSetupStarted()`, wired to each control.

Props: `plan_surface` (`solo` | `anon`) and `first_control`
(`when` | `where` | `vibe` | `budget`).

🧨 **It deliberately carries NO dimension values.** The first version sent
`area_kind`, `vibe`, `budget` and `when`, and all four were **wrong by
construction**: `track()` runs before the state setter applies the selection, and
the latch fires only once, so every one of them was pinned to the mount-time
default on 100% of events. A property that is constant on every event is worse
than a missing one, because a dashboard will happily break down by it. Caught by
the analytics-schema review gate. The chosen values already ride on
`plan_generate` / `plan_preview_built`.

`first_control` is the honest and more useful replacement: it answers which part
of the brief people reach for first.

**Two documented limitations.** (a) The latch is per-mount: a visitor who builds
anonymously, signs in, and lands on a fresh `PlanFlow` can emit a second event.
(b) A visitor who accepts every default emits `plan_generate` with no preceding
setup event, so `plan_setup_started` to `plan_generate` reads above 100%. Both
are inherent to "first meaningful selection" and neither is fixable without
firing on Build, which would defeat the point of the event.

### `plan_generate` / `plan_reshuffle`
Signed-in generation succeeded with at least one stop.

Props: `duration_ms`, `stop_count` (+ legacy `stops`), `pool_stage` (+ legacy
`poolStage`), `pool_size` (+ legacy `poolSize`), `area`, `area_kind` (+ legacy
`areaKind`), `vibe`, `budget`, `daypart`, `full`, and `offset` on reshuffle.

`duration_ms` wraps **only** the `computePlan` call: a local, synchronous engine
pass over the in-props catalogue. It excludes the React setState calls, and it is
never derived from animation timing.

### `plan_preview_built`
Anon generation succeeded.

Props: `duration_ms`, `stop_count`, `offset`, `vibe`, `budget`, `area` (legacy
spelling on this surface) and `area_kind`.

🧨 **`duration_ms` here is not comparable to the signed-in number and is bimodal
by design.** This path is a server round trip through `lib/plan-preview.ts`,
which holds a module-level TTL cache: a cold call includes a paged read of the
whole catalogue, a warm one does not. The signed-in number is pure local CPU with
no network and no database.

`pool_stage` is **absent** here. `lib/__tests__/plan-preview-guard.test.ts`
asserts `poolStage` / `poolSize` never cross to the client, so the two surfaces
cannot be compared on pool stage. Widening that payload is a moat decision.

### `plan_generate_failed` (signed-in) / `plan_preview_failed` (anon)
Props: `reason`, `duration_ms`, plus the same context bag as the success event.
Anon failures also carry `raw_reason` (the bounded server string) so the mapping
stays auditable.

`reason` values and their real reachability:

| Value | Reachable today |
| --- | --- |
| `no_result` | Yes, both surfaces. The engine filled zero stops; nothing threw, but the visitor sees a failure. Before this change these were emitted as `plan_generate` successes. |
| `rate_limited` | Anon only, from the preview cap. |
| `invalid_input`, `server` | Anon only, mapped from the server action's own reason. |
| `network` | Anon only, and only when `navigator.onLine === false`. |
| `timeout` | **NO.** There is no AbortController and no fetch timeout anywhere in the plan path. Shipped so the category exists the day one is added. Expect zero, and do not add a client-side timer to populate it. |
| `unknown` | The honest bucket. Never a dumping ground for a message. |

Signed-in failure categories are mostly unreachable by construction:
`computePlan` is local, synchronous and throw-free, so only `no_result` can
genuinely occur there.

### `plan_save_tapped` / `plan_save_succeeded` / `plan_save_failed`
`tapped` fires after the in-flight guard, so its count is comparable to the
insert count. `succeeded` fires only once the insert returns clean. `failed`
fires only on a real failed write.

Shared props: `mode`, `attempt`, `anon_origin`, `saved_list_loaded`, plus the
same coarse plan bag the legacy event sent (`area`, `vibe`, `budget`, `daypart`,
`stop_count`, `swapped`, `pool_stage`, `pool_size`).

`mode`: `new`, `duplicate`, `resave_after_swap`, `resave_after_reshuffle`.
No `update` (the write is insert-only and there is no UPDATE policy on the
table). No `restored_anon` (the Save button is unmounted in exactly the state a
restored anon stash creates, so the value could never be produced);
`anon_origin` carries that information instead.

`saved_list_loaded` exists because `loadSavedPlans` swallows its error. Without
it, a failed load would make every save look like `new`.

`plan_save_failed.reason`: `rls_denied`, `auth_expired`, `schema_mismatch`,
`constraint`, `rate_limited`, `network`, `server`, `unknown`, mapped in
`lib/analytics-reasons.ts` from the SQLSTATE code and the HTTP status **only**.
`pg_error_code` carries the bare code. **Never** `error.message`, `error.details`
(a full stack trace on the network path) or `error.hint`.

### `plan_save` (DEPRECATED)
Dual-emitted alongside `plan_save_succeeded` until **2026-09-30**. Every existing
PostHog insight and Vercel series keys on this name, so it cannot be renamed in
place. **New dashboards must use `plan_save_succeeded` and must not also count
this one**, or every save appears twice.

### `plan_swap`
Props: `stop_index` (+ legacy `stop`), `stop_role`, `dir`, `method`.

`method`: `swipe`, `button`, `group_veto`. Passed in by the caller, **never
derived from `dir`** (a left swipe and the Change button's default argument both
produce `dir === 1`). The group surface reports `group_veto` because the deciding
vote can arrive over Realtime from another device, so no local gesture describes
it.

`stop_role` (`Start` | `Then` | `Finish`) ships alongside the index because
**group roles are filtered by the room's hearted moods**, so group `stop_index: 0`
is not necessarily the opener. Without the role, solo and group merge into a
wrong conclusion about which stop people reject.

Note: `plan_swap` and `plan_open_maps` still merge solo and group with no surface
discriminator. The common properties do not disambiguate them.

### Unchanged plan events
`plan_open_maps` (`stops` only, never the maps URL, which is two lines away and
contains every stop's coordinates), `plan_stop_opened`, `plan_stash_restored`.

## Explore events

### `explore_filter_applied`
Props: `category`, `category_count`, `has_area`, `has_price`, `has_open_now`,
`sort`.

Read from the incoming `next` object, not from `filters` state, which is one
apply behind in the same tick.

`category_count` is **0 or 1 by construction**: the category chips are
single-select on this surface, and `for-you` is the unfiltered default. The
genuinely multi-select dimensions are price and area, reported as booleans. A
flat `1` is the design, not a bug.

No free-form search term and no tag string is ever sent here.

### `card_dismissed`
Props: `card_type`, `position_bucket`, `surface`.

`position_bucket`: `0-4`, `5-11`, `12-23`, `24+` (aligned to
`FEED_PAGE_SIZE = 24`). A raw index is a fingerprinting nudge and a useless
breakdown.

`card_type` is always `venue`: `EventCard` has no dismiss control, so a 0%
event-dismiss rate is structural, not a product signal. Anon cannot produce this
event at all (`onDismissed` is only passed when signed in).

No venue identifier. `recordSignal("dismiss")` already carries `venueId` to our
own database for the taste vector; the third-party event does not need it.

### `feed_end_reached`
Props: `category`, `sort`, `how` (`first_page` | `paginated`), `loaded_count`,
`has_area`, `has_price`, `has_open_now`.

Fires **once per distinct feed view**, latched on a **geo-free** key
(`category|sort|price|region|openNow`). The app's own `viewKey()` embeds lat/lng
to three decimals and must never reach a payload.

🧨 Deliberately **not** hung off the IntersectionObserver. That observer re-arms
by design (3000px rootMargin, deps include `loaded.length`) and the
back-navigation scroll restore parks the visitor at max scroll, so an
observer-driven event would fire on essentially every return from a venue page.
The Events tab's hard-set `hasMore = false` is excluded: no server call happened,
so it is not an end-of-feed.

### `near_you_result`
Props: `result`, `source` (`cache` | `prompt`), `entry` (`pill` | `sheet`).

`result`: `granted`, `denied`, `unavailable`, `error`. Read from the geo helper's
own reason **before** the UI collapses `timeout` into `unavailable`; `timeout`
maps to `error`. **Never a coordinate.**

Fires at all three exits, including the cached fast path. Turning nearest OFF
emits nothing: that is not a permission outcome.

Note for interpretation: `lib/geo.ts` silently retries once (12s then 20s), so
one event can describe up to ~32 seconds across two attempts.

## Booking and sign-in attribution

### `venue_reserve_click`
Existing props: `venue` (slug), `platform`, `party`.
Added: `from_plan` (boolean), `stop_index` (only when from a plan),
`entry_surface`.

Resolved on the venue page from a one-shot sessionStorage handoff written by the
plan stop link. **Not from the URL:** a query param on the venue route would opt
it out of static rendering and kill the `/anon/venue/[slug]` ISR cache.

Never sent: booking date, party size beyond the existing `party`, plan title,
route, coordinates.

Out of scope and worth knowing: `booking_self_logged` does **not** carry plan
attribution, and the "Call to book" CTA has no analytics at all.

### `sign_in_complete`
Added prop: `trigger`, from a closed allow-list
(`venue_teaser_readmore`, `venue_reviews_locked`, `venue_booking_cta`,
`event_ticket_cta`, `plan_save`, `plan_rate_limited`, `saved_screen`,
`explore_wall`, `events_wall`, `together`, `profile`, `unknown`).

Carried in localStorage (a magic link can open in a new tab), one-shot,
TTL 15 minutes, validated against the allow-list at read time, and cleared on
sign-out. **Never a query string:** `lib/safe-redirect.ts` passes any
site-internal path through with its query intact, which would make the property
caller-controllable.

The property is **always sent**, never omitted. `unknown` is the measurable
carrier-loss bucket for a magic link opened on another device and for the
server-side sign-in doors that cannot arm a trigger at all.

⚠️ **This event almost certainly never reached PostHog before this branch.**
`SignInTracker` mounted as a sibling of `AnalyticsGate`, so `posthogReady` was
still false when it fired and `track()` skipped the capture. Fixed twice over:
the provider order was swapped, and `track()` now queues pre-init events.

### `search_query`
🧨 **Changed, and it drops a property.** It sent the raw user-typed query
(`{ q }`) to PostHog EU and Vercel, two lines above a comment promising "never
the raw text, no PII" for the other sink. It now sends `q_len` and `results`
only. Any insight breaking down `search_query` by `q` will go blank.

## Group events: now present, from the merged security work

`together_join_denied`, `together_room_expired` and `together_host_handoff` were
defined on `fix/group-room-security`, **merged 2026-07-30 as
[PR #187](https://github.com/mparanzales/fun-london/pull/187)**. This branch was
rebased onto it and the union now carries all three alongside this branch's own
ten. They arrived verbatim; this branch did not author or alter them.

Their payloads, and why they pass the sanitizer:

| Event | Payload | Note |
| --- | --- | --- |
| `together_join_denied` | `{ reason }` | `lib/room-errors.ts` categories. No room identifier at all. |
| `together_room_expired` | `{ room_id }` | Opaque row uuid, not a join credential. |
| `together_host_handoff` | `{ room_id }` | Same. |

🧨 **The sanitizer's `room_id` carve-out is load-bearing.** `room_id` is
deliberately absent from the blocked-key patterns. A broader block (anything
matching `room`) would have silently stripped the only correlation property two of
these three events carry, which is exactly the class of silent thinning this
repository has been burned by before. `room_code`, `invite_code`, `join_code`,
`share_link` and bare `code` remain blocked whole, and a test asserts both halves.

Also from #187 and kept verbatim through the rebase:
`sanitize_properties: stripRoomCodes` in `posthog.init`, which removes `room=` from
every URL-bearing property before anything leaves the browser. Verified present in
the deployed production bundle.
