# Fun London — Group-Room Security: Staging Verification

**Status: BLOCKED BEFORE PHASE 2. No staging database could be provisioned without a founder decision, so no migration was applied anywhere and the live multi-account tests did not run.** This document records the environment proof, the one decisive new finding, the harness built so the verification is a single command once a database exists, and the exact production sequence. Every section is labelled: **Verified · Failed · Fixed · Not testable · Remaining blocker · Production prerequisite.**

Nothing was merged. Nothing was deployed. No SQL other than read-only catalog queries was executed against any database.

## 1. Scope

Phases 1–12 of the staging brief for `fix/group-room-security`. Phase 1 completed; Phases 2–12 blocked on the environment (§2). Boundaries honoured throughout: no production SQL, no merge, no production deployment, no unrelated code touched.

## 2. Environment proof — **Verified**, and the blocker it exposed

Full evidence: `funldn-group-security-staging-evidence/01-environment-proof.md`.

- Branch `fix/group-room-security`, clean tree, starting commit `9584e4e`. **Verified.**
- Two Supabase projects exist: `fxfuza…dopc` (**fun-london — PRODUCTION**, matches `STATUS.md`) and `rcecrn…fskx` (`fun-london-dev`, **INACTIVE/paused**). **Verified.**
- **Remaining blocker — no isolated database was available to use autonomously:**
  - A Supabase **branch** costs **$0.01344/hour (~£7/month)** and its creation tool requires an explicit cost confirmation from the account owner. Recurring spend is a founder decision, and the project's own spend policy defers Supabase upgrades.
  - Resuming **fun-london-dev** changes *shared* infrastructure (Vercel previews point at it) and resumes compute billing. Founder decision.
  - **Local Supabase is impossible here:** neither Docker nor the Supabase CLI is installed (`docker: not found`, `supabase: not found`).
- Three test accounts: **Not created.** Creating them requires the staging project's service-role key, which does not exist until the project does.

## 3. Starting branch and commit — **Verified**

`fix/group-room-security` @ `9584e4ec53df507c3a948fb3d875990df3127c02`, working tree clean at start.

## 4. Database baseline — **Not testable** (no staging DB). One production-side fact was established read-only:

## 5. THE DECISIVE FINDING — **Verified** (and it changes the production plan)

```
current_user = postgres · owner of realtime.messages = supabase_realtime_admin
pg_has_role(postgres, 'supabase_realtime_admin', 'MEMBER') = false
```

`CREATE POLICY` / `DROP POLICY` require table ownership. **The migration role is not the owner and not a member of the owner, so migrations `0002` and `0003` cannot be applied by `supabase db push`, the MCP migration tool, or any CI step** — they fail with `42501: must be owner of table messages`. Previously this was a "medium — verify before you rely on it" caveat from the security review; it is now measured fact.

**Fixed:** both files now open with an `OWNER-LEVEL EXECUTION REQUIRED` banner giving the evidence, the failure mode, the supported mechanism (dashboard SQL editor), and the command that proves the applied state matches the repository. `0001` is unaffected — it touches only `public` objects the migration role owns.

## 6–7. Migration 0001 / client preview deployment — **Not testable**

0001 was not applied (no target). The Phase 4 preview deployment is additionally a **remaining blocker on its own**: it would require pushing this branch to the **public** GitHub repository, which publishes a detailed fix for an **unpatched live vulnerability** before production is patched. That is a disclosure decision only the founder can make, and the safer order is patch-then-publish.

## 8. Administrative ownership requirements — **Production prerequisite**

| Item | Value |
|---|---|
| Why | `realtime.messages` is owned by `supabase_realtime_admin`; the migration role is `postgres` and not a member |
| Exact SQL | verbatim contents of `0002_realtime_membership_policies.sql` and `0003_drop_broad_realtime_policies.sql`, below their banners |
| Required role | an owner-level session — in practice the **Supabase dashboard SQL editor** (the mechanism that created the current live policies) |
| Verification query | `select policyname, cmd, roles, permissive, qual, with_check from pg_policies where schemaname='realtime' and tablename='messages';` and `EXPECT_STAGE=<2\|3> pnpm tsx scripts/verify-room-security.ts` |
| Rollback SQL | kept verbatim in the header of `0003` (re-creates the two broad policies in one statement pair) |
| Can the CLI do it in production? | **No.** Plan for a manual, owner-level step at stages 2 and 3, and keep the repo files as the source of truth for exactly what is pasted. |

## 9–20. Three-account dual-run, 0003, verification script, closure, expiry, host handoff, throttle, identity/vote integrity, analytics privacy, existing-socket behaviour, regression, rollback — **Not testable in this session**

All are implemented as executable checks rather than prose. `scripts/staging-room-security-suite.ts` (new, committed) creates three disposable accounts, signs them in for **real JWTs**, and exercises real PostgREST calls and real Realtime WebSocket subscriptions — no unit test stands in for a policy. The full matrix is in `funldn-group-security-staging-evidence/02-test-matrix.md`; every row is marked **NOT RUN**.

**The harness's production guard is itself verified working**: pointed at the production ref — in lower case *and* upper case — it refuses and exits 1 before any client is constructed. It now has four independent layers: a case-normalised ref denylist, a URL denylist, a ref/URL cross-check, and **the strongest one — the project ref decoded from the service key's own JWT payload**, so a custom domain or a mislabelled variable cannot hide which project the key belongs to. A key that names no project (opaque `sb_secret_…`) is refused rather than trusted. At runtime it also refuses to create anything if the target already holds ≥25 users, which is what a real cohort looks like and a fresh staging project does not.

**Existing-socket-after-closure (X-2)** deserves its own note: it is a *measurement*, not a pass/fail, because Realtime authorises at join time. The harness closes a room while a member's socket is open, then probes every 5s for up to 60s and reports the last moment a broadcast was **acknowledged by the server and observed coming back**. Both halves matter: `send()` alone resolves as soon as the message is queued locally and silently falls back to an HTTP POST when the socket is dead, so the first version of this test would have printed a confident number that measured nothing. **Until that number exists, no copy or documentation may claim closure is instant.**

## 21–22. Review verdicts — **both gates re-run on this delta; both found blockers; all fixed**

**Round 1 (commit `9584e4e`, the implementation)** — recorded in the implementation document §5b: code-reviewer 5 blockers, supabase-guardian SHIP WITH FIXES (4 blockers + 3 highs). All fixed.

**Round 2 (this delta: the harness, the banners, the production sequence).** Neither reviewer returned clean, and the harness was rewritten as a result.

- **code-reviewer: NOT READY** — 5 blockers, every one of the *false-pass* class, which is the worst defect available in something meant to prove a security fix: `send() === 'ok'` measured nothing (no ack, silent HTTP fallback); a re-subscribe to a topic the same client still held would have killed the measurement; `trySubscribe` scored any non-answer as a denial, so **if Realtime were simply unreachable, four denial checks would all have gone green**; `C-1`/`C-2` passed on any query failure including "table does not exist"; and the throttle test burned the same account the handoff test needed, making one check vacuous and another fail on a healthy database.
- **supabase-guardian: DO NOT SHIP (as a runnable gate)** — the guard was defeatable by pressing Shift (case-sensitive denylist) or by using a custom domain; the suite could not pass against a correct database *and* could pass against an empty one; teardown could silently leave real auth users behind while asserting it had not; plus the production sequence deployed the client **before** anyone had proven the owner-level step was even possible, and never re-checked the "Allow public access to channels" toggle that does the real work.

**Fixed in this commit** (all of the above): tri-state `allowed/denied/inconclusive` with denials gated on positive controls that run first; ack-plus-echo measurement with a channel-state guard; fresh clients for post-closure probes; error-shape assertions instead of "some error came back"; a fourth actor so the throttle test stops poisoning the handoff test; deterministic re-aged host for the stability check; per-actor teardown registration with verified user deletion; case-normalised **and key-derived** project identification; a populated-database refusal; SKIP records so a skipped block can never vanish from the evidence; scrubbed error output (a unique-violation quotes a live room code); and the two owner-level files **moved out of `supabase/migrations/`** into `supabase/manual/` so a `db push`/`db reset` cannot abort mid-chain on files the runner can never apply.

**Still not staging-validated.** These verdicts describe code and documents. No reviewer has seen this system running against a database, because no database was available.

## 23. Remaining limitations and blockers

1. **Remaining blocker — no isolated database.** Founder must choose: create a Supabase branch (~£7/mo, cost confirmation required), resume `fun-london-dev`, or install Docker + Supabase CLI for a free local stack. The last is the cheapest and the most isolated.
2. **Remaining blocker — preview deployment implies public disclosure** of an unpatched live vulnerability (public repo). Patch production first, or use a private mirror.
3. **Production prerequisite — owner-level SQL for stages 2 and 3** (§8), and the remedy itself (dashboard SQL editor) is **inferred from project history, not measured** — step 3a's inert probe is what turns it into a fact.
4. **Production prerequisite — `exec_sql_readonly`** does not exist; every automated gate in §24 depends on it (§24 step 0a).
5. **Production prerequisite — "Allow public access to channels" must be OFF**; if it is ON, every policy here is decorative and the verifier cannot detect it (§24 step 0b).
6. Everything already listed in the implementation document's *Remaining limitations* still stands, including member-to-member impersonation inside a real roster, best-effort `leaveRoom`, the unscheduled purge, and the client/DB host-rule difference.

## 24. Production migration recommendation — **do not execute; run staging first**

Recommended sequence, each step with its approver. **Maria approves every step; supabase-guardian re-reviews any SQL that changes.**

0. **Prerequisites (must be true before step 1).**
   a. **`exec_sql_readonly` exists**, or the verifier's catalog queries are run by hand. `scripts/verify-room-security.ts` depends on it and no migration creates it. If it is created: SECURITY INVOKER, `revoke all … from public, anon, authenticated`, `grant execute … to service_role` only — a SECURITY DEFINER SQL executor in `public` would hand `anon` arbitrary reads including `auth.users`. Narrow fixed-purpose functions are safer than a general executor.
   b. **Project Settings → Realtime → "Allow public access to channels" = OFF.** Per `supabase/realtime-policies.sql`, this toggle is "the control doing the real work": flipped ON, RLS on `realtime.messages` is bypassed and every policy below is decorative. The verifier cannot see it (project setting, not catalog state) — check it by eye here and again at step 9.
   c. **Whoever is on call for the 48-hour window has dashboard SQL-editor access**, with the rollback SQL from `0003`'s header pre-staged. Rollback is itself a `CREATE POLICY`, so it carries the same ownership constraint — without dashboard access, MTTR is however long it takes to wake someone.
1. **Backup + snapshot.** Verified DB backup; save `pg_policies` for `realtime.messages` and the `public` room objects to a dated file. *(Approver: Maria.)*
2. **Apply `0001`** via the normal migration path (it is `public`-only and additive; the migration role owns these objects). *(Maria.)*
3. **Verify:** `EXPECT_STAGE=1 pnpm tsx scripts/verify-room-security.ts` → tables, RLS, definer functions, grants (`purge` not executable by anon/authenticated), no client write policies. *(Automated gate.)*
3a. **PROVE OWNERSHIP BEFORE DEPLOYING ANYTHING ELSE.** In the dashboard SQL editor run the inert probe (it grants nothing and removes nothing, because a permissive `using (false)` policy adds no access):
    ```sql
    create policy "zz_probe_delete_me" on realtime.messages
      for select to authenticated using (false);
    drop policy "zz_probe_delete_me" on realtime.messages;
    ```
    **If this 42501s, STOP.** Do not proceed to step 4 — otherwise production ends up running the new client, filling `plan_room_members`, with the **broad policies still live and the exposure still open**, and no way to close it. The fallback is Supabase support granting `supabase_realtime_admin` to `postgres` for one window (then revoking it). *(Maria, manually.)*
4. **Deploy the client** to production only after 0001 is in place, so membership rows begin to exist. Watch for room create/join errors. *(Maria merges; Vercel auto-deploys from main.)*
5. **Apply `0002` through the dashboard SQL editor** (owner-level; the CLI cannot). Dual-run: nothing is removed, so live rooms cannot break. *(Maria, manually.)*
6. **Verify:** `EXPECT_STAGE=2 …` → membership-scoped policies present *alongside* the broad ones.
7. **Two-account check** on production: a real host + a real invitee complete a room. **Unrelated-account denial baseline:** confirm a third account can still get in at this stage (it can — the broad policy still permits) so step 9's change is provably the thing that closes it. *(Maria.)*
8. **Apply `0003` through the dashboard SQL editor.** This is the only step that removes access. *(Maria, manually.)*
9. **Verify:** `EXPECT_STAGE=3 …` → must exit 0, asserting no unscoped policy of any name remains, and the grants hold. Repeat the third-account attempt: it **must** now be denied.
10. **Smoke tests:** closure, expiry (on a disposable room), host handoff with two real sessions.
11. **Monitoring period:** 48 hours on `together_room_create/join`, `together_join_denied`, subscribe-error rates and Vercel runtime errors.
12. **Rollback triggers:** any legitimate member denied; room creation failing; a spike in `together_join_denied` from real invitees; subscribe errors above baseline. **Rollback = re-create the two broad policies** (verbatim SQL in `0003`'s header, dashboard, one statement pair), then investigate. `0001`'s tables can stay — they are inert without the policies.

## 25. Cleanup confirmation — **Verified (nothing to clean)**

No staging project was created, no migration applied, no test account created, no room created, no production data read beyond read-only catalog metadata, and no temporary data exists anywhere. The only artefacts are files on the branch.
