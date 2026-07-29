# Test matrix — executed against a live database

Environment: isolated local Supabase CLI stack on loopback (`http://127.0.0.1:54321`),
Postgres 17, real GoTrue accounts, real JWTs, real PostgREST calls, real Realtime
WebSockets with `private: true` channels. Production was never contacted.
Run 2026-07-29. Harness: `pnpm staging:room-security`.

Four disposable accounts per run (`fl-staging-<a|b|c|d>-…@example.invalid`):
**A** host · **B** invited member · **C** unrelated signed-in account · **D** throttle subject.

## Headline

| Stage | Database state | Result |
|---|---|---|
| 1 — pre-fix | 0001 + production's two broad `plan-%` policies | **32 pass / 3 fail** |
| 2 — dual-run | + 0002 membership-scoped policies | **32 pass / 3 fail** (unchanged) |
| 3 — final | + 0003 drops the broad policies | **35 pass / 0 fail / 0 inconclusive** |
| rollback of 0003 | back to dual-run | **32 pass / 3 fail** — identical to baseline |
| rollback of 0002 | back to stage 1 | stage 1 detected |
| re-applied forward | 0002 then 0003 again | **35 pass / 0 fail** (repeatable) |

The three stage-1 failures are **C-3, X-3, X-4** — every one of them a Realtime subscribe
that should have been refused. They are the live vulnerability, reproduced. They are still
failing at stage 2, which is correct: permissive policies OR together, so 0002 cannot close
anything while the broad policies remain. They pass only after 0003.

That contrast is the point. A suite that was only ever run against the fixed database could
not tell you whether it was measuring the fix or measuring a broken channel.

## Full results at stage 3

| ID | Area | Expectation | Result |
|---|---|---|---|
| ENV-1 | environment | 0001 applied: both room tables exist | PASS |
| ENV-0 | environment | target holds no real user accounts | PASS — 0 accounts, 0 non-fixture |
| ENV-2 | accounts | four disposable accounts signed in | PASS |
| AN-1 | anon | signed-out caller refused `plan_rooms` **by grant** | PASS — `42501` |
| AN-3 | anon | signed-out caller refused `plan_room_members` by grant | PASS — `42501` |
| AN-4 | anon | signed-out caller refused `plan_room_join_attempts` by grant | PASS — `42501` |
| AN-2 | anon | signed-out caller cannot execute `create_plan_room` | PASS — `42501` |
| R-1 | room | host creates a room via RPC | PASS |
| R-2 | room | code is six characters | PASS |
| R-3 | room | creator recorded as host | PASS |
| R-4 | room | expiry is ~6 hours | PASS — 6.00h |
| R-5 | room join | invited member joins with the code | PASS |
| M-1 | realtime | **host CAN subscribe (positive control)** | PASS — SUBSCRIBED |
| M-2 | realtime | **member CAN subscribe (positive control)** | PASS — SUBSCRIBED |
| M-3 | table read | member CAN read their own room (positive control) | PASS |
| C-1 | table read | unrelated account reads NO room rows, query itself succeeded | PASS — 0 rows, no error |
| C-2 | table read | unrelated account reads NO membership rows | PASS — 0 rows, no error |
| **C-3** | realtime | **unrelated account CANNOT subscribe** | **PASS — CHANNEL_ERROR** (was SUBSCRIBED pre-fix) |
| C-4 | host | non-member cannot promote — asserted from the DB | PASS |
| C-5 | host | member cannot steal host from a LIVE host via `stale=0` | PASS — clamp holds |
| C-6 | host | non-member cannot close the room — asserted from the DB | PASS |
| C-7 | rpc | unrelated account denied purge, by permission not absence | PASS — `42501 permission denied for function purge_expired_plan_rooms` |
| H-0 | handoff | both successors joined, B before C — asserted from membership rows | PASS — 2 of 2 |
| H-1 | handoff | stale host replaced by the next member in the ring | PASS — B (note: does **not** discriminate the fix — B is the answer under the old rule too; only H-4 is evidence) |
| H-2 | handoff | the outgoing host is not re-selected | PASS |
| H-3 | handoff | promotion is **not reentrant** — immediate re-run cannot move the host | PASS — unchanged |
| H-4 | handoff | repeated handoffs **rotate**, never two-cycle | PASS — B → C → A → B |
| X-1 | closure | host can close the room | PASS |
| **X-2** | closure | MEASURED: how long an already-open socket keeps broadcasting | **rejected immediately (0s)** — pre-fix it was **still accepted at ≥56s** |
| X-3 | closure | member's NEW subscribe is denied after closure | PASS — CHANNEL_ERROR |
| X-4 | closure | unrelated account still denied after closure | PASS — CHANNEL_ERROR |
| E-1 | expiry | expired room cannot be joined — no membership row created | PASS — 0 rows |
| E-2 | expiry | a member can STILL READ an expired room, so the UI can explain why | PASS |
| T-1 | throttle | direct RPC join is throttled server-side, no UI in the path | PASS — tripped at attempt 21 (limit 20) |
| CLEAN-1 | cleanup | every temporary room AND account verified removed | PASS — 0 rooms, 0 users, 0 delete errors |

## X-2 is the answer to "what happens to a socket that is already open?"

Pre-fix, closing a room left an established socket broadcasting for **at least 56 seconds** —
the broad policy only matched on topic prefix, and closure changes nothing about the prefix.
After 0003 the same measurement reads **rejected immediately**, because
`is_plan_room_member()` re-evaluates `closed_at is null` on every message. Closing a room now
severs live sockets rather than merely preventing new ones.

## Two real defects the live run found

Neither could have been caught by a unit test.

**1. Host handoff oscillated forever.** With the shipped rule (exclude only the current host,
then take earliest-joined), a three-member room ping-ponged:

```
round 1 (caller B) -> host is B
round 2 (caller C) -> host is A (the ORIGINAL, absent host)
round 3 (caller B) -> host is B
round 4 (caller C) -> host is A ...
```

The room hands itself back to the very device that vanished, and never reaches a member who
is present. Fixed in 0001 by rotating forward through the roster; re-measured as
`A → B → C → A`, with promotion non-reentrant because it stamps `host_seen_at = now()`.

**2. The production verification gate could never run.** `scripts/verify-room-security.ts`
imported `@/lib/supabase/admin`, which begins `import "server-only"` — a package Next resolves
at build time and which is not installed. Run the documented way (`pnpm tsx`), the script died
with `MODULE_NOT_FOUND` before its first line. The gate that was supposed to authorise the
production cutover had never executed. It now builds its service client inline.
`scripts/verify-feed-rank.ts` and `scripts/verify-plan.ts` share the same latent fault and were
left alone as out of scope — they are logged as follow-up work.

## Two defects found in our own test apparatus

Reported because a test that cannot fail is worse than no test.

- **The environment guard could never have fired.** It refused to run only when the target held
  25 or more accounts. Production was then measured: **16**. On the one database the guard
  existed to protect, it was inert. Replaced with an identity test — every account the suite
  creates matches `fl-staging-<label>-<ts>-<rand>@example.invalid`, and any account that does
  not match aborts the run.
- **E-1 asserted the wrong thing.** A plpgsql function declared `returns public.plan_rooms`
  that returns NULL is serialised by PostgREST as an object with every column null — truthy in
  JavaScript. The old assertion therefore failed against a database that had correctly refused
  the join. Proven directly in SQL (`0 membership rows`), then the assertion was changed to
  measure the effect rather than the payload.

## Fidelity limits of a local stack, stated plainly

| Question | Answered here? |
|---|---|
| Do the policies deny a non-member on a real database? | **Yes** |
| Closure, expiry, handoff, throttle, anon moat? | **Yes** |
| Does `supabase db push` fail on `realtime.messages` for lack of ownership? | **No** — locally `postgres` is effectively superuser. Measured directly against production instead (read-only). |
| Is "Allow public access to channels" OFF in production? | **No** — hosted dashboard setting; remains a production prerequisite. |
| Behaviour under production data volume and concurrency? | **No** |

The local default privileges were deliberately aligned to production's first
(`anon=rm, authenticated=rm, service_role=arwdDxtm` for new public tables). Without that, the
anon checks would have passed whether or not 0001's `revoke ... from anon` existed — the hazard
would have been absent, so the check could not have failed. See
`00-infrastructure-assessment.md`.

## Application-level check

The app itself was run against the same isolated database (`next dev`, `.env.local` pointed at
loopback). A real account signed in through the real magic-link flow — the app sent the email,
it was captured by the stack's own mail catcher, and the link was followed — then created a room
through the UI. The lobby rendered, presence showed **Live**, and the private channel subscribed
under the membership-scoped policies with **zero console errors**. The row it created was
confirmed in the database: topic `plan-…`, creator is host, open, 6.00h TTL, 1 member.

## Both rebuilt guards were proved able to FAIL

A guard that has never been seen to fail is a guard you are trusting on faith.

**The identity guard fired, unprompted.** A separate account had been created for the
application-level UI check (`fl-uiprobe@example.invalid`). It is not a suite fixture, so on the
next run the harness stopped before writing anything:

```
❌ [ENV-0] target holds no real user accounts — 1 account(s), 1 not test fixtures
❌ [FATAL] refusing to create test data: 1 non-fixture account(s) present — this database belongs to real users
```

That is the guard doing exactly what the old ≥25-account version could never have done on a
16-account production database.

**The anon-grant assertion was broken on purpose.** Re-granting the privilege that `0001`
exists to revoke:

```
grant select on public.plan_rooms to anon;
→ ❌ anon holds NO select grant on any room table (0001's revoke actually applied) — plan_rooms
→ gate exit code 1
revoke all on public.plan_rooms from anon;
→ ✅ anon holds NO select grant on any room table
→ gate exit code 0
```

**`EXPECT_STAGE` typo guard.** `EXPECT_STAGE=three` previously yielded `NaN`, which is falsy, so
the gate printed "reporting only, not gating" and exited 0 — a deploy gate that disables itself
on a typo. It now exits 1 with `EXPECT_STAGE=three is not 1, 2 or 3. Refusing to run ungated.`
