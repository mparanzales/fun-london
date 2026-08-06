# Fun London analytics event dictionary

**Source of truth:** the `AnalyticsEvent` union and the exported unions in
`lib/analytics.ts`. A typo is a compile error; this file is the prose around it.

**On `main`.** Last updated 2026-08-06 against `main` @ `140e5e5`, adding the
nine plan-series events and the save dimensions from
[#194](https://github.com/mparanzales/fun-london/pull/194)–[#226](https://github.com/mparanzales/fun-london/pull/226).

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
write count. `succeeded` fires only once the write returns clean. `failed`
fires only on a real failed write. One successful save emits **three** events
(`tapped` + `succeeded` + the deprecated `plan_save`) with the byte-identical
prop bag; a failed save emits two. Never union the names.

Shared props: `mode`, `write_path`, `plan_origin`, `anon_origin`, `attempt`,
`saved_list_loaded`, plus the same coarse plan bag the legacy event sent
(`area`, `vibe`, `budget`, `daypart`, `stop_count`, `swapped`, `pool_stage`,
`pool_size`).

`mode`: `new`, `duplicate`, `resave_after_swap`, `resave_after_reshuffle`.
🧨 `duplicate` is a **structural zero**: the Save button's disabled expression
includes bare `alreadySaved` and `onSave` reads the same render's value, so the
only branch that could produce it is exactly the branch where the button cannot
be clicked. A flat line there is the design working. Both `resave_*` values
fire on the FIRST save of a night reached that way — no prior save is implied
by the name.

`write_path` (`insert` | `update`) — added by
[#224](https://github.com/mparanzales/fun-london/pull/224) (2026-08-05), which
retired two claims earlier versions of this section made:

- ~~"the write is insert-only and there is no UPDATE policy on the table"~~ —
  migration `0006_saved_plan_timing.sql` adds an owner-pinned UPDATE policy +
  table grant and a `plans_pin_row` BEFORE UPDATE trigger. A reopened or
  previously saved night now updates its own row in place. "update" rides
  here, NOT on `mode`.
- ~~"the Save button is unmounted in the restored-anon state"~~ — a restored or
  claimed night IS savable (that is the conversion path). `plan_origin` and
  `anon_origin` carry that information, because it is orthogonal to `mode`.

🧨 **`write_path` is provenance, not the SQL verb.** `insert` means "no
reopened row was targeted"; the statement for a live night is an upsert on a
client-minted uuid held for the night's life, so a same-session re-save of one
live night updates in place while reporting `insert`. Counting
`write_path: "insert"` as "new saved nights" over-counts. Catalogue churn also
FORCES `insert`: a reopened night that lost a stop deliberately writes a new
row rather than overwriting the survivor set, so a spike of `insert` under
`plan_origin: "saved"` is an ingest/hiding event — correlate with
`plan_restored_partial` before reading it as user behaviour.

`plan_origin` (`live` | `generated` | `saved` | `anon`): where the night on
screen came from. `live` = built this session; `generated` = restored from
localStorage after a refresh or a venue round trip; `saved` = reopened from
the saved list; `anon` = claimed at sign-in. `pool_stage` / `pool_size` are
null whenever `plan_origin` is not `live`, by construction: the engine kept
computing behind a restored night and describes a different night.

`anon_origin` (boolean) means "claimed on THIS page load". It is per-mount and
misreports in both directions: a claimed night that survives a refresh sends
`plan_origin: "anon"` with `anon_origin: false`; and the ref is cleared only by
`standDown()`, which the reopen path never calls, so claim → "← Edit" → open a
saved night → Save emits `anon_origin: true` on a `plan_origin: "saved"`
night. `plan_origin` is the durable signal.

`attempt` counts accepted save attempts per MOUNT, across nights, never reset.
It is not a retry counter — the in-flight guard swallows double-taps before it
increments.

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

### The plan-series additions (#194–#226): shared facts

Every event from here to `plan_restored_partial` fires on ONE surface: solo
signed-in `/plan`. The anon flow and the group room lack the producing controls
by construction (no saved list, no per-stop replacement, no undo, no
start-earlier lever, no booking handoff), so an anon or group flat line is
structural. None of them carries `plan_surface` — it would read `solo` on 100%
of events, and a constant property is worse than a missing one. None existed
before its PR's merge date: earlier data is absent, not zero. And none is
pinned by a dashboard or an emission test yet (only `plan_book_return`'s
`marker_shown` mechanics have a guard test) — nothing would notice if one
stopped firing.

### `plan_swap_undo`
One tap of the "Undo change" chip stepped a stop replacement back. Fires at the
end of the handler, after the pop really happened.
[#197](https://github.com/mparanzales/fun-london/pull/197), 2026-08-02.

Props: `remaining` — this night's history depth after the pop, 0–19
(`UNDO_DEPTH = 20`). It is not "undos still available", and it can shrink
between sessions for non-user reasons: the persisted history is rebuilt against
the live catalogue on mount, and entries touching a vanished venue restart the
run.

No stop index, no method, no surface discriminator — you cannot ask which stop
was undone, or join it to the `plan_swap` it reverses except by session
ordering. It can only ever be a subset of `plan_swap`: a flat line means
"nobody swaps" or "nobody regrets a swap", and those are indistinguishable
without reading `plan_swap` alongside it.

### `plan_reopen_conflict` / `plan_reopen_conflict_resolved`
Tapping a saved night while an unsaved night is live raises the conflict card
(`…conflict`, props: `stops` — the STORED night's count, 1–3, read from
localStorage, not the screen) and answering it resolves it (`…resolved`,
props: `choice`: `open_saved` | `keep_current`).
[#197](https://github.com/mparanzales/fun-london/pull/197), 2026-08-02.

Shown once per episode: a state latch keeps re-taps silent while the card is
up. 🧨 **Only answering the card clears the latch.** Build past it instead and
(a) no `resolved` is ever sent for that episode, (b) the stale card survives,
and (c) every later genuine conflict is silently suppressed until it is
answered. Expect an undercount on `…conflict` and the occasional late,
mis-attributed `…resolved`.

Not 1:1 in either direction: abandonment produces shown-with-no-resolved, and
`keep_current` re-arms the latch, so one session can produce many pairs. Read
`resolved / shown` as a completion rate. No correlation id joins the pair.

⚠️ `choice: "open_saved"` does not mean a night actually opened — the event
fires after the tap with no success check, and the reopen can bail silently
when every stop's venue has left the catalogue. ⚠️ `choice` is a bare string
at two call sites, not a union in `lib/analytics.ts`; a third value would
typecheck.

### `plan_reshuffle_confirm_shown` / `plan_edit_confirm_shown`
The two loss-warnings on a night with manual replacements: "Try another
combination" ([#200](https://github.com/mparanzales/fun-london/pull/200),
2026-08-04) and "← Edit"
([#216](https://github.com/mparanzales/fun-london/pull/216), 2026-08-05) ask
first instead of discarding. Both fire on the tap that was REFUSED — they
measure intercepted destructive taps, never intent that proceeded.

Props: `replaced` (1–3; 0 is unreachable — the guard requires replacements to
lose). Same prop name, same derivation, on both events: split by event name or
the two warnings merge into one wrong conclusion.

No latch on either. Every dismissal re-arms the emit, and each card's tap
clears the OTHER card's flag, so one indecisive user can ping-pong an unbounded
event count on a single night. Count sessions or users, never raw volume.

🧨 The funnel has only one end instrumented, and differently per event:

- reshuffle — accepting emits `plan_reshuffle` (or `plan_generate_failed`
  `no_result`), declining emits nothing. And `plan_reshuffle` also fires for
  every reshuffle that never raised a confirm, so "shown minus reshuffle" is
  NOT an abandonment rate.
- edit — NEITHER outcome emits ("Edit anyway" and "Keep my night" are both
  silent), unlike the reopen pair above. This event alone cannot answer "does
  the warning work?".

The group room lets users replace stops but has NO confirm on its own back
button — the solo-only line here reflects a missing guard in group, not
missing analytics.

### `plan_start_earlier`
One tap of the "Start 30 min earlier" chip.
[#216](https://github.com/mparanzales/fun-london/pull/216), 2026-08-05.

Props: `shift_mins` (negative multiples of 30 — the running total for this
mount, not the tap size) and `closed_stops` (1–3, the PRE-shift shut count).
There is no post-shift count, and the chip only renders when the shift
strictly reduces the count — so "did the lever help" is true by construction
and unmeasurable from this event. What it cannot see: whether a stop stayed
shut anyway.

🧨 **Structurally impossible on the default brief.** The chip requires the
night's start to be ≥ ~29 minutes in the future, and "Right now" (the
default), "Today" during the day and "Tonight" in the evening all resolve the
start to the live clock. Only "Tonight" picked during the day, a "Pick a day"
custom start, or a restored night with a pinned future clock can emit it. The
honest denominator is nights with a sufficiently future start — not nights
with a shut stop.

`shift_mins` resets per mount while the shifted clock persists: tap, walk to a
venue page, come back, tap again → two `-30` events on a night that actually
moved 60. Sum within a page session; never read max/last as displacement.
Autocapture also records the same tap as `$autocapture`; never add the series.

### `plan_book_return`
The first signed-in `/plan` mount in a tab within 2 hours of tapping a booking
door from a plan stop.
[#226](https://github.com/mparanzales/fun-london/pull/226), 2026-08-06.

The marker is a one-shot sessionStorage handoff written by the venue page's
booking doors and consumed remove-before-validate, so the event means "opened
a booking door from the plan, then reopened the plan in this tab" — reopening
`/plan` for ANY reason counts, and it does NOT prove the partner page loaded,
let alone a booking (`booking_self_logged` remains the only booking signal).
Two per-mount ref latches make it once per mount, StrictMode-proof.

Props: `stop_index` (0 | 1 | 2 — the index AT BOOKING TIME; the on-screen
marker re-anchors by slug precisely because indices shift) and `marker_shown`
(whether the "Booking opened here" paragraph actually rendered for that slug).

⚠️ Missing events are not "didn't come back": TTL expiry, an intervening
sign-out (clears the breadcrumbs), a closed tab, and private mode all lose the
marker silently. ⚠️ There is no same-tool denominator: the ReserveSheet door
emits `venue_reserve_click` `{from_plan: true}`, but the partner-less "Visit
website" door emits no `track()` event at all, so this event can legitimately
exceed `venue_reserve_click{from_plan}`. `stop_index`'s distribution measures
which slots hold bookable venue types, not booking preference.

🧨 `marker_shown` is load-bearing on effect ORDER: the restore runs in a
layout effect and the marker consumption in a passive one, in that order.
`lib/__tests__/booked-stop-marker-guard.test.ts` pins the scheduling and the
expression because it regressed twice with a green suite while the PR was
open. (Same lesson as the door itself: `window.open` + `noopener` returns null
BY SPEC, so the door is a real anchor and the write is gated on plan
provenance only — never on "did the popup open".)

### `plan_anon_claimed`
A night built signed-out was adopted by the account at sign-in — the
conversion moment the anon → signed-in transfer exists for. Fires in the mount
layout effect; no user gesture involved.
[#194](https://github.com/mparanzales/fun-london/pull/194), 2026-07-31.

Props: `stops` — the PERSISTED count, not the rendered one. A claim that lost
a venue to catalogue churn still reports the stored count; the truthful kept
number is on the `plan_restored_partial` that fires first in the same tick.

🧨 **Do not filter this event by `auth_state` — it reads `anon` on the
dominant path.** The claim emits in a layout effect; the module auth flag is
set from a passive effect after an async Supabase callback, and the usual
arrival is a full document load out of the OAuth redirect, so the layout
effect wins deterministically. A dashboard filtered to
`auth_state: "signed_in"` shows a flat line for an event that is firing fine.

🧨 **A failed conversion emits NOTHING and destroys the anon night.** The
claim clears every anon key first and checks freshness/liveness after: a stale
night (12h TTL for "Right now" nights; up to 14 days for picked dates) or one
whose venues all vanished lands the user on an empty setup form, silently. A
drop in this event can mean "claims are failing the freshness gate", not
"fewer people signing in".

The denominator is `plan_preview_built` — the anon slot is written as soon as
a preview renders, not on a save or sign-up tap. Total "anon night carried in"
= this + the legacy `plan_stash_restored` (mutually exclusive by construction;
the legacy leg is documented as removable, so expect it to trend to zero).
Claims will exceed `anon_origin: true` saves by more than funnel drop-off: a
reshuffle clears the anon-origin ref before the save.

### `plan_restored_partial`
A restored, claimed or reopened night lost at least one stop against today's
plan catalogue, and at least one survived.
[#194](https://github.com/mparanzales/fun-london/pull/194), 2026-07-31.

Props: `dropped` (≥ 1), `kept` (≥ 1), `source` (`generated` | `saved` |
`anon` — which door the night came through: refresh-restore, saved-list
reopen, or anon claim).

🧨 **The flat-line trap is inverted here: the catastrophic case is the silent
one.** A night that lost EVERY stop emits nothing — the slot is cleared and
the user sees an empty setup form. This event only ever reports partial
survivors; zero events is not zero churn damage.

🧨 What actually drops a stop is leaving the filtered plan catalogue:
`hidden_at` set, row deleted, `google_place_id` nulled, or the photo lost /
replaced with an Unsplash URL. A photo-pipeline regression therefore inflates
this event with no venue hidden — check the Places/photo pipeline before
assuming curation. A re-slug alone CANNOT drop a stop (hydration tries the
uuid first, slug as fallback); pre-model saved rows have no slug fallback, so
legacy rows drop at a structurally higher rate, all under `source: "saved"`.

`auth_state` is a code-path indicator here, not a user fact: restore and claim
fire pre-paint in a layout effect (reads `anon`), reopen fires on a tap (reads
`signed_in`). The mount paths are latched once per owner; reopen is NOT —
every reopen of a broken saved row re-emits, and because the first truncated
reopen re-persists only the survivors, later taps on the same row ALSO raise
`plan_reopen_conflict` for a night that was never at risk. One broken saved
row inflates both events on repeat taps.

The legacy stash path drops stops with no loss event at all
(`plan_stash_restored` carries only the kept count) — a partial loss there is
invisible.

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

## Known gaps: union members with no entry

Listed so nobody mistakes this file for exhaustive. These predate the
dictionary and still have no prose: `venue_save`, `venue_unsave`,
`event_ticket_click`, `booking_self_logged` (mentioned above only for its
missing plan attribution), `share`, `together_room_create`,
`together_room_join`, `together_swipe`, `detail_wall_dismissed`. The union in
`lib/analytics.ts` remains the source of truth for what exists; their prose is
owed, not lost.
