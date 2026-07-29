# Fun London — Group-Room Security: Staging Verification

**Status: VERIFIED on an isolated live database. Not applied to production, not merged, not deployed.**
Date 2026-07-29 · branch `fix/group-room-security` · cost **£0**.

The previous revision of this document said the work was blocked before Phase 2 because no
isolated database could be reached without spending money. That is no longer true and the
document has been rewritten. A local Supabase CLI stack was used instead: real Postgres, real
GoTrue accounts, real PostgREST, real Realtime WebSockets, on loopback, for nothing.

## 1. What was verified, in one table

| # | Item | Result |
|---|---|---|
| 1 | Environment proved not production | **Verified** — loopback host, parsed not matched; zero real accounts |
| 2 | `0001_plan_rooms.sql` applied | **Verified** — by the migration runner |
| 3 | `realtime.messages` ownership handled | **Verified locally**, and the production route **confirmed by probe** (§4) |
| 4 | `supabase/manual/0002` applied (dual-run) | **Verified** — nothing broke, nothing yet closed |
| 5 | App run against the isolated database | **Verified** — real sign-in, real room, zero console errors |
| 6 | Host / member / unrelated account | **Verified** — 4 accounts, positive controls first |
| 7 | Direct RPC and PostgREST bypass | **Verified** — `42501`, and the throttle trips at attempt 21 |
| 8 | Room closure | **Verified** — and it now severs live sockets |
| 9 | Room expiry | **Verified** — no membership row is created |
| 10 | Deterministic host handoff | **Defect found and fixed** — see §3 |
| 11 | Existing socket after closure | **Measured** — ≥56s before, 0s after |
| 12 | Analytics privacy | **Verified** — no room code reaches any property |
| 13 | `supabase/manual/0003` applied (final) | **Verified** — exposure closed |
| 14 | `EXPECT_STAGE=3 verify-room-security` | **Passes**, and provably fails when broken |
| 15 | `pnpm staging:room-security` | **33 pass / 0 fail / 0 inconclusive** at commit `acc8368` (see note in the evidence file) |
| 16 | Test suite, typecheck, lint, build, copy guard | **347 tests / 38 files pass**; build compiles |
| 17 | Rollback | **Proved by execution**, both directions, twice |
| 18 | supabase-guardian / code-reviewer gates | Both ran; **both found blockers; all fixed** (§5) |
| 19 | Temporary rooms, members, accounts removed | **Verified by re-query**, not by trusting the delete |
| 20 | Temporary infrastructure removed | **Verified** — stack down, directory deleted |

Full per-check results: `docs/funldn-group-security-staging-evidence/02-test-matrix.md`.

## 2. The decisive contrast

The suite was run against the database **before** the fix as well as after. That is the whole
value of the exercise — a suite only ever run against a fixed database cannot tell you whether
it is measuring the fix or measuring a broken channel.

| | pre-fix | dual-run | after 0003 |
|---|---|---|---|
| result | 30 pass / **3 fail** | 30 pass / **3 fail** | **33 pass / 0 fail** |
| failing | C-3, X-3, X-4 — all Realtime subscribes that should have been refused | identical | none |

Dual-run behaving identically to pre-fix is correct and important: permissive policies OR
together, so 0002 cannot close anything while the broad policies live. It also proves 0002
breaks nothing, which is what makes it safe to apply to production ahead of the cutover.

## 3. Two real defects found — neither reachable by a unit test

**Host handoff oscillated forever.** With the shipped rule (exclude the current host, take
earliest-joined) a three-member room ping-ponged `B → A → B → A`, handing the room back to the
original *absent* host and never reaching a member who was present. Fixed in `0001` by rotating
forward through the roster; re-measured as `A → B → C → A`.

**The production verification gate could never run.** `scripts/verify-room-security.ts`
imported `@/lib/supabase/admin`, which begins `import "server-only"` — a package Next resolves
at build time and which is not installed. Run as documented (`pnpm tsx`) it died with
`MODULE_NOT_FOUND` before its first line. The gate meant to authorise the production cutover
had never executed once. It now builds its client inline and loads `.env.local` like its
siblings.

Two further defects were found in the *test apparatus* itself and are written up in the
evidence file, because a check that cannot fail is worse than no check: the environment guard
could never have fired (it refused at ≥25 accounts; production holds 16), and the anon
assertion passed whether or not the grant had been revoked.

## 4. The owner-level route — measured, and the earlier conclusion corrected

Re-measured today against production, read-only:

```
current_user                                   = postgres
owner of realtime.messages                     = supabase_realtime_admin
pg_has_role(postgres, supabase_realtime_admin) = false
```

**Correction, 2026-07-29:** the inert probe was subsequently RUN against production through
the Supabase MCP `execute_sql` path and **succeeded** (created, confirmed, dropped; production
left at its two original policies). `postgres` holds `supabase_privileged_role`. So the route
does exist — the measurement above was right, the inference drawn from it was not.

**0002 and 0003 still must not be applied by `supabase db push`, `db reset`,
`apply_migration` or CI** — those take a different path. They live in `supabase/manual/`,
outside the numbered chain, so a `db push` or `db reset` cannot abort partway through on files
the runner can never apply.

Locally this constraint does not reproduce — `postgres` is effectively superuser there — which
is why it was measured directly on production instead.

## 5. Review gates

Both gates were re-run on the delta. Both found blockers, all of the *false-pass* class, and
all were fixed and re-verified. Details in
`docs/funldn-group-security-staging-evidence/04-review-verdicts.md`.

The headline: the code written to prevent false passes contained false passes. `H-4` — the only
check that proves the handoff defect is fixed — could have gone green having measured nothing,
because it discarded RPC errors and skipped nulls. And the guard tests pinned strings that the
*broken* rule also contained, so reverting `0001` would have left CI entirely green.

## 6. Remaining production prerequisites

1. **A privileged SQL session** for 0002/0003 — CONFIRMED available via the Supabase MCP
   `execute_sql` path. Re-prove it with the inert probe immediately before use; if it 42501s,
   stop.
2. **`exec_sql_readonly` is REJECTED — do not create it.** The automated gate calls it, so
   against production the gate aborts (fails closed, but does not run). It was rejected because
   its "only SELECT is possible here" defence is false: `select public.purge_expired_plan_rooms()`
   passes both of its filters and DELETEs rows, as `postgres`, because a SELECT of a volatile
   SECURITY DEFINER function is a side effect. Verify production with direct catalog queries
   instead. See `REJECTED-exec_sql_readonly.sql`.
3. **"Allow public access to channels" must be OFF** — **CONFIRMED OFF on production**
   2026-07-29 by probe: an anon-role private-channel subscribe to `plan-ZZ9999` and to an
   unrelated topic both return `CHANNEL_ERROR`. Were it on, RLS on `realtime.messages` would be
   bypassed and every policy here decorative. Re-check after any Realtime settings change.
4. **Two sibling scripts are dead the same way** as the gate was: `verify-feed-rank.ts` and
   `verify-plan.ts` both import the `server-only` admin client. Out of scope here, logged as
   follow-up. Note the trap: adding `server-only` as a dependency does **not** fix them — that
   package throws by design under plain Node. A shared `scripts/`-local service client is the
   durable fix, and a guard test now pins that the room-security gate does not regress.

## 7. Accepted limitations, recorded rather than fixed

- **Convergence costs up to 30s per absent member.** Promotion stamps `host_seen_at = now()`
  and `shouldClaimHost` will not fire again until that goes stale, so a room whose first *k*
  ring members are absent takes roughly 30·k seconds to reach a live host. Strictly better than
  never converging, but it is not instant.
- **A member can walk the host role to themselves** across an all-absent ring, one 30s hop at a
  time, and then close the room. This is a *new* capability — the old rule could only ever
  reach two members. It requires already holding the code and already being enrolled, and the
  walk stops at the first member whose client is actually pinging. Accepted; recorded here so
  it is a decision rather than an oversight.
- **Local fidelity.** Ownership constraints, the dashboard channel setting, and production
  data volume and concurrency were not exercised locally.

## 8. What was NOT done

Nothing was applied to production. Nothing was merged. Nothing was deployed. No Vercel preview
was created, no branch was pushed, and no Supabase project or database branch was created — so
no branch-compute charge was incurred. Production was read, never written.

## 9. Production migration sequence

Unchanged in shape from the previous revision, with one addition: step 0 now includes creating
`exec_sql_readonly`, without which every gate below aborts.

0. Do **not** create `exec_sql_readonly` (rejected — see above). Confirm
   **Realtime → Allow public access to channels = OFF** with the anon private-channel probe,
   and confirm the ownership route with the inert `zz_probe_delete_me` probe.
1. Apply `supabase/migrations/0001_plan_rooms.sql` by the normal runner. Purely additive.
   Gate: the catalog queries from `scripts/verify-room-security.ts` §1-3, run over a privileged session.
2. Deploy the client. Rooms still run on the broad policies; membership records start
   accumulating.
3. **Prove ownership before touching any policy** — run the inert probe from the header of
   `supabase/manual/0002`. If it 42501s, STOP: the rest of the plan needs a different mechanism.
4. Apply `supabase/manual/0002` in that owner-level session. Gate: catalog query — 4 policies, 2 scoped + 2 broad.
   Nothing should change for users; this is the dual-run soak.
5. Soak. Confirm rooms are being created with membership rows and that no member reports a
   failure.
6. Apply `supabase/manual/0003` in the same kind of session. Gate: catalog query — 2 policies, both scoped, zero broad. That is what
   authorises calling the exposure closed.
7. If anything is wrong at any point after step 6, re-create the two broad policies verbatim
   from the header of `0003`. Proved by execution here, in both directions, twice.
