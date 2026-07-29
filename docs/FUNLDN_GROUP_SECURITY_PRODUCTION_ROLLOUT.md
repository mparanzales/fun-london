# Fun London — Group-Room Security: Production Rollout

Live log of the production rollout. Branch `fix/group-room-security`.
Project `fxfuz…dopc` (`fun-london`, eu-west-2, Postgres 17.6).

## Pre-flight — all four confirmed by measurement, 2026-07-29

| Check | Result | How |
|---|---|---|
| Realtime "Allow public access to channels" is OFF | **CONFIRMED OFF** | Anon-role private-channel subscribe to `plan-ZZ9999` **and** to an unrelated topic both returned `CHANNEL_ERROR`. If the setting were on, RLS on `realtime.messages` would be bypassed and every policy in this track would be decorative. |
| An owner-level SQL route exists for the Realtime policies | **CONFIRMED — and it overturns the documented blocker** | The inert probe (`create policy … using (false)`, then drop) was run against production and **succeeded**: created, confirmed present in `pg_policies`, dropped, production left at exactly its two original policies. See below. |
| Backup and rollback available | **Rollback: yes, statement-level and proven. Backup: manual check.** | Rollback does not depend on a restore — see §Rollback. Daily backups are included on the Pro plan; PITR is a paid add-on and is **not** confirmed enabled. |
| Branch passes tests, build, lint, security verification | **Pass** | 347 tests / 38 files; typecheck, lint, format and copy guard clean; `next build` compiles. Supabase security advisors: **zero lints**. |

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

If the automated gate is wanted later, a hardened definition is kept at
`docs/funldn-group-security-staging-evidence/exec_sql_readonly.sql`. Adding it is a separate,
reviewable decision.

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

That is why 0003 waits for the deploy. Verified on an isolated database: pre-fix 32 pass / 3
fail, dual-run 32 pass / 3 fail (identical — nothing broken, nothing closed), after 0003
35 pass / 0 fail.

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
| 2026-07-29 | `0001_plan_rooms.sql` | See §Applied below |
| — | Merge + client deploy | **Founder action** — Claude does not merge |
| — | `0002` dual-run | Blocked on the deploy |
| — | Soak | Blocked on 0002 |
| — | `0003` close the exposure | Blocked on the soak |
