# Fun London — Group-Room Security: Production Rollout

Live log of the production rollout. Branch `fix/group-room-security`.
Project `fxfuz…dopc` (`fun-london`, eu-west-2, Postgres 17.6).

## Pre-flight — all four confirmed by measurement, 2026-07-29

| Check | Result | How |
|---|---|---|
| Realtime "Allow public access to channels" is OFF | **CONFIRMED OFF** | Anon-role private-channel subscribe to `plan-ZZ9999` **and** to an unrelated topic both returned `CHANNEL_ERROR`. If the setting were on, RLS on `realtime.messages` would be bypassed and every policy in this track would be decorative. |
| An owner-level SQL route exists for the Realtime policies | **CONFIRMED — and it overturns the documented blocker** | The inert probe (`create policy … using (false)`, then drop) was run against production and **succeeded**: created, confirmed present in `pg_policies`, dropped, production left at exactly its two original policies. See below. |
| Backup and rollback available | **Rollback: yes, statement-level and proven. Backup: manual check.** | Rollback does not depend on a restore — see §Rollback. Daily backups are included on the Pro plan; PITR is a paid add-on and is **not** confirmed enabled. |
| Branch passes tests, build, lint, security verification | **Pass** | 349 tests / 38 files; typecheck, lint, format and copy guard clean; `next build` compiles. Supabase security advisors: **zero lints**. |

### The owner-level finding, in full

Earlier revisions of these documents stated that `0002`/`0003` **could not be applied at all**,
because:

```
current_user                                   = postgres
rolsuper(postgres)                             = FALSE
owner of realtime.messages                     = supabase_realtime_admin
pg_has_role(postgres,'supabase_realtime_admin','MEMBER') = FALSE
```

Stock PostgreSQL requires table ownership for `CREATE POLICY`, so the inference was that the
step was impossible without Supabase support. **The measurement was right; the inference was
wrong.** The probe succeeds. `postgres` is a member of `supabase_privileged_role`, which is the
likely mechanism, though stock PostgreSQL semantics do not fully account for it.

The practical rule that follows: **trust the probe, not the theory.** It is re-run immediately
before each policy step, and if it ever returns `42501` the rollout stops. `supabase db push`,
`db reset`, `apply_migration` and CI still must not be used for these two files — they take a
different path, which is why both live in `supabase/manual/`, outside the numbered chain.

## Production state before any change

| Fact | Value |
|---|---|
| `plan_room%` tables | **0** — 0001 had never been applied |
| Policies on `realtime.messages` | **2**, both broad `plan-%`, `to authenticated` |
| `exec_sql_readonly` | absent |
| `auth.users` | 16 |
| Security advisors | 0 lints |

The two live policies, verbatim from `pg_policies`:

```
"authenticated can read plan-together rooms"   SELECT {authenticated}
  USING ((SELECT realtime.topic()) ~~ 'plan-%' AND extension = ANY(ARRAY['broadcast','presence']))
"authenticated can write plan-together rooms"  INSERT {authenticated}
  WITH CHECK ((SELECT realtime.topic()) ~~ 'plan-%' AND extension = ANY(ARRAY['broadcast','presence']))
```

Any signed-in user may read and write **any** `plan-*` topic. That is the exposure being closed.

## A deliberate decision: `exec_sql_readonly` was NOT created

`scripts/verify-room-security.ts` calls this RPC, and the documented step 0 said to create it.
It was not created, because a permanent `SECURITY DEFINER` function that executes arbitrary
`SELECT` is a standing attack surface, and everything it would be used for here can be read
directly with privileged SQL instead. Production policy state in this rollout is therefore
verified by direct catalog queries, quoted verbatim in this document.

It is not merely unused, it is **REJECTED**, and the file is kept only so nobody revives it:
its "only a SELECT is grammatically valid here" defence is false. `select
public.purge_expired_plan_rooms()` starts with `select`, contains no semicolon, is valid in the
subquery position, passes both filters, and **deletes rows as `postgres`**, because a SELECT of
a volatile SECURITY DEFINER function is a side effect. See
`docs/funldn-group-security-staging-evidence/REJECTED-exec_sql_readonly.sql`. The durable fix
for the verification scripts is a direct Postgres connection, not an RPC.

## Rollout order and why it cannot be compressed

```
0001 (additive)  →  MERGE + client deploy  →  probe  →  0002 (dual-run)  →  soak  →  0003 (close)
```

The client deploy is **load-bearing between 0001 and 0003**, not a convenience:

- `0002` adds membership-scoped policies *alongside* the broad ones. Permissive policies OR
  together, so nothing breaks and nothing closes. Safe at any point after 0001.
- `0003` **removes** the broad policies. If it runs while no deployed client is writing
  membership rows, `is_plan_room_member()` matches nothing and **every live room breaks
  instantly** for every user.

That is why 0003 waits for the deploy. Verified on an isolated database: pre-fix 30 pass / 3
fail, dual-run 30 pass / 3 fail (identical — nothing broken, nothing closed), after 0003
33 pass / 0 fail.

## Rollback

Rollback is statement-level and was **proved by execution on an isolated database, in both
directions, twice** — it does not depend on a backup.

- **After 0003:** re-create the two broad policies verbatim from the header of
  `supabase/manual/0003_…`. Restores the previous permissive behaviour in one statement pair.
- **After 0002:** `drop policy "plan room members read"/"plan room members write" on realtime.messages;`
- **After 0001:** drop **three** tables (`plan_rooms`, `plan_room_members`,
  `plan_room_join_attempts` — the last holds user ids, so leaving it behind is a data-retention
  miss) and **nine** functions.

## Log

| When | Step | Result |
|---|---|---|
| 2026-07-29 | Pre-flight (4 checks above) | All confirmed |
| 2026-07-29 | Ownership probe on production | Succeeded; probe policy removed; production back to 2 policies |
| 2026-07-29 | `0001_plan_rooms.sql` | **APPLIED and verified** — see below |
| 2026-07-30 | Merge (#187) + client deploy | **Merged by Maria** as `da88c2f`; Vercel `dpl_vU5Ca…` READY on `funldn.com` |
| 2026-07-30 | Dual-run baseline on production | 11 pass / 1 fail — the 1 is the exposure, reproduced |
| 2026-07-30 | `0002` applied | 4 policies: 2 scoped + 2 broad |
| 2026-07-30 | Dual-run battery | 11 pass / 1 fail — **identical**; nothing broken, nothing yet closed |
| 2026-07-30 | `0003` applied | **Exposure closed** — 2 policies, both membership-scoped |
| 2026-07-30 | Final battery | **12 pass / 0 fail** |
| 2026-07-30 | Cleanup | Verified by re-query: 16 users (unchanged), 0 room rows |

## Applied: 0001, 2026-07-29

Applied through the Supabase MCP `apply_migration` path (transactional), recorded as migration
`plan_rooms_membership_step1`. Verified immediately afterwards by direct catalog query — no
`exec_sql_readonly`, no RPC, no standing attack surface:

| Check | Result |
|---|---|
| Tables | `plan_room_join_attempts, plan_room_members, plan_rooms` |
| RLS enabled | true on all three |
| Functions | 9 |
| SECURITY DEFINER functions without a pinned `search_path` | **none** |
| Client INSERT/UPDATE/DELETE policies on room tables | **none** — writes are definer-only |
| 🧨 **`anon` SELECT grant on any room table** | **NONE** — the moat evidence no behavioural test can produce |
| `authenticated` can read `plan_room_join_attempts` | **false** — the throttle ledger stays private |
| Functions executable by `anon` | **none** |
| Policies on `realtime.messages` | **2**, unchanged — 0001 touched nothing there |

**Idempotency proved on production**, which is where it matters, since applying out-of-band
means a later `db push` may re-run the file: the two `create policy` statements plus a
`create table if not exists` were re-executed and completed without error, leaving 3 tables and
2 room policies. Before this change those statements would have aborted with `42710`.

### Advisors after 0001

`get_advisors(security)` went from 0 lints to 9. Both groups are expected, and both were
checked rather than waved through:

- **1 INFO — `rls_enabled_no_policy` on `plan_room_join_attempts`.** Intentional and predicted
  by review. The table is the throttle ledger: RLS on, *zero* policies, and every grant revoked
  from `public`, `anon` and `authenticated`. Deny-all for clients is the design; a policy would
  weaken it.
- **8 WARN — `authenticated_security_definer_function_executable`.** One per room function.
  This is the architecture, not a defect: all writes go through SECURITY DEFINER functions
  precisely so clients need no table grants, and every one of them derives identity from
  `auth.uid()` — none takes a user id, so a caller cannot act as somebody else. The two
  predicates (`is_plan_room_member`, `is_plan_room_participant`) **must** be executable by
  `authenticated` or the RLS policies that call them fail outright. Each returns information
  about the caller only.

Nothing else regressed: no pre-existing table, policy or grant was touched.


# The cutover, 2026-07-30

## What was deployed

PR #187 merged by Maria as `da88c2f8e3ef38e18941a2b22aedf64db8dc1c2d`. Confirmed **by content**,
not by the merged badge — `origin/main` and the reviewed tree are byte-identical across
`supabase/`, `scripts/` and `lib/`, and the rotation SQL `(m.joined_at, m.user_id) >` is present
in main at `0001_plan_rooms.sql:349`. (The squash-merge stranding trap has bitten this repo
twice before; the badge is not evidence.)

Production deployment `dpl_vU5Ca1mX81CobtActnMYUKJXasiQ`, target `production`, state `READY`,
commit `da88c2f`, region `lhr1`, aliased to `funldn.com` and `www.funldn.com`.

## Method

Three disposable accounts (A host, B member, C unrelated) exercised the **real deployed RPCs and
real Realtime private channels** on production. No service-role key was handled by the tooling:
the accounts were seeded through a privileged SQL session and signed in with the public anon key,
so the only secret in play was a throwaway password for accounts that no longer exist.

The battery ran **three times** — before 0002, after 0002, after 0003 — because a run that only
ever happens after the fix cannot tell you whether it measured the fix or measured a broken
channel.

| Check | before 0002 | dual-run | after 0003 |
|---|---|---|---|
| host creates room + membership row | PASS | PASS | PASS |
| member joins, membership row written | PASS | PASS | PASS |
| host subscribes (positive control) | PASS | PASS | PASS |
| member subscribes (positive control) | PASS | PASS | PASS |
| vote broadcast reaches the member | PASS | PASS | PASS |
| **unrelated account subscribe** | **SUBSCRIBED — the exposure** | **SUBSCRIBED** | **CHANNEL_ERROR** |
| unrelated account reads room rows | 0 rows | 0 rows | 0 rows |
| non-host cannot close | PASS | PASS | PASS |
| host can close | PASS | PASS | PASS |
| signed-out refused by grant | `42501` | `42501` | `42501` |
| **totals** | 11 / 1 fail | 11 / 1 fail | **12 / 0** |

Dual-run being *identical* to baseline is the point: permissive policies OR together, so 0002
could not close anything, and it demonstrably broke nothing for real host and member sessions.

## Final policy state, from `pg_policies`

| Condition | Result |
|---|---|
| Broad topic-prefix-only policies remaining | **NONE** |
| Realtime READ requires membership | true |
| Realtime WRITE requires membership | true |
| Predicate denies **closed** rooms | true (`closed_at is null`) |
| Predicate denies **expired** rooms | true (`expires_at > now()`) |
| Policies granting `anon` on `realtime.messages` | **NONE** |
| `anon` SELECT grant on any room table | **NONE** |
| Anon-executable room functions | **NONE** |
| Total policies on `realtime.messages` | **2**, both membership-scoped |

## `EXPECT_STAGE=3 pnpm tsx scripts/verify-room-security.ts`

Ran, and **failed closed** — as designed:

```
Target: fxfuzabrivuianfwdopc.supabase.co (key names project fxfuzabrivuianfwdopc)
verification error: Could not find the function public.exec_sql_readonly(q) in the schema cache
```

Two things worth noting. The new guard works: the script **names the database it is inspecting**
before doing anything, so it can no longer certify one database while you believe it certified
another. And it aborts rather than reporting success, because the RPC it depends on was
deliberately **rejected** as unsafe. The checks it would have run were executed directly over a
privileged SQL session instead, and are the table above.

The durable fix is to give that script a direct Postgres connection rather than an RPC. Until
then, the production gate is the catalog queries, not the script.

## Realtime and runtime errors

Vercel runtime errors for the project, 3-hour window spanning the cutover: **none**. The only
`CHANNEL_ERROR` observed anywhere was the intended one — the unrelated account being refused
after 0003. Host and member sockets stayed up throughout, and a broadcast vote was delivered
end to end on every run including the final one.

## Cleanup

Verified by re-query, not by trusting the deletes:

| | |
|---|---|
| Cutover accounts remaining | **0** |
| `auth.users` total | **16** — exactly the pre-cutover count |
| `plan_rooms` / `plan_room_members` / `plan_room_join_attempts` rows | **0 / 0 / 0** |
| Orphaned `profiles` rows from test accounts | **0** |

## Rollback

**Not used.** No legitimate-member test failed at any stage.

## Advisor review — all nine functions, individually

Eight of these are the WARN-flagged ones; `purge_expired_plan_rooms` is included for
completeness. Read directly from `pg_proc` after the cutover.

| Function | DEFINER intentional | `search_path` pinned | identity / membership check | anon EXECUTE | authenticated EXECUTE |
|---|---|---|---|---|---|
| `create_plan_room` | yes | `""` | `auth.uid()` | **no** | yes |
| `join_plan_room` | yes | `""` | `auth.uid()` + throttle | **no** | yes |
| `close_plan_room` | yes | `""` | `auth.uid()` = host | **no** | yes |
| `leave_plan_room` | yes | `""` | `auth.uid()` | **no** | yes |
| `touch_plan_room_host` | yes | `""` | `auth.uid()` = host | **no** | yes |
| `promote_plan_room_host` | yes | `""` | `auth.uid()` must be a member | **no** | yes |
| `is_plan_room_member` | yes | `""` | `auth.uid()` | **no** | yes |
| `is_plan_room_participant` | yes | `""` | `auth.uid()` | **no** | yes |
| `purge_expired_plan_rooms` | yes | `""` | `current_user` must be service role | **no** | **no** |

Every one is intentional: `SECURITY DEFINER` is the mechanism that lets clients hold **no table
grants at all** while still creating and joining rooms. No function takes a user id, so a caller
cannot act as someone else. The two predicates *must* be executable by `authenticated` or the
RLS policies that call them fail outright. `anon` can execute nothing.

The remaining INFO lint, `rls_enabled_no_policy` on `plan_room_join_attempts`, is the intended
design: RLS on, zero policies, all grants revoked — deny-all for clients. Adding a policy would
weaken it.

## Purge scheduling — analysis, no change made

`purge_expired_plan_rooms()` deletes rooms more than **7 days past expiry** (members and join
attempts follow by CASCADE). Rooms expire ~6 hours after creation, so effective retention is
about a week. It still has **no caller**.

**Expected growth.** The bytes are irrelevant; the exposure is the social graph. Each room is one
`plan_rooms` row plus one `plan_room_members` row per participant plus one
`plan_room_join_attempts` row per joining account. At today's 16 accounts this is a few hundred
rows a month, well under a megabyte a year. At a 500-user beta with one room per user per week
it is roughly 2,000 rooms and 6,000 member rows a week — still trivial on disk, but it is a
permanent record of **who planned a night with whom, and when**, growing forever. That is the
reason to schedule it, not storage.

**Recommended: add a step to `.github/workflows/maintenance.yml`.** It already runs daily at
03:00 UTC, already holds the service-role secret, already has the alert-on-failure step, and
already runs Node 22 with pnpm. A purge step is a few lines in an existing workflow: **£0, no new
service, no new infrastructure, no new attack surface.**

Existing no-cost alternatives, and why they are second choices:

| Option | Cost | Assessment |
|---|---|---|
| Step in `maintenance.yml` (daily 03:00 UTC) | £0 | **Recommended.** Existing workflow, existing secret, existing failure alerting. |
| `pg_cron` | £0 | Available but **not installed**. Database-native and needs no secret, but installing an extension is an infrastructure change and wants its own review. Would satisfy the function's `current_user` guard, since pg_cron runs as `postgres`. |
| Supabase Edge Function + schedule | £0 on current plan | Requires deploying edge functions, which this project does not currently use. More surface for less benefit. |
| Vercel Cron | £0 within Hobby limits | Needs a new API route, i.e. a new publicly-reachable endpoint guarding a destructive function. Worst option here. |

**Decision required from Maria:** approve adding the purge step to `maintenance.yml`. It was
deliberately **not enabled** — it is a workflow change, so it belongs in a reviewed PR, not in a
cutover. Until then, room and membership records accumulate indefinitely.

## Still open

- **`verify-room-security.ts` cannot run against production** until it takes a direct Postgres
  connection instead of the rejected RPC. The same change repairs `verify-plan.ts` and
  `verify-feed-rank.ts`.
- **Purge is unscheduled** (above).
- **`create_plan_room` is an unthrottled existence oracle.** It takes the code from the caller and
  relies on the unique constraint, so `23505` reveals whether a code exists, at unlimited rate,
  bypassing the 20-per-10-minutes join throttle. Not practically exploitable at 32^6 with 6-hour
  rooms, but the throttle is the stated enumeration perimeter and there is a door beside it.
- **Backups: better than recorded earlier.** `.github/workflows/backup-db.yml` backs the database
  up to private R2 every Sunday at 04:00 UTC. The pre-flight recorded this as an unverified manual
  check; it is in fact covered. PITR remains a separate paid add-on and is still not enabled.
