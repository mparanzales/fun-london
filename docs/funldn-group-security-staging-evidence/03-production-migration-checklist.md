# Production migration checklist (printable)

Staging has been run — see `02-test-matrix.md`. Steps 0–2 are **done**; everything from step 3
is Maria's.

🧨 **`pnpm verify-room-security` cannot run against production.** It calls an
`exec_sql_readonly` RPC that does **not** exist there and that we deliberately **rejected** as
unsafe (see `REJECTED-exec_sql_readonly.sql`). So wherever this checklist used to say "run the
gate", it now says **run the catalog queries over a privileged SQL session and paste the output
into `FUNLDN_GROUP_SECURITY_PRODUCTION_ROLLOUT.md`**. The queries are the ones in
`scripts/verify-room-security.ts` §1–3. Making the script work without the RPC (direct Postgres
connection) is tracked as follow-up.

- [x] **0.** Pre-flight. Realtime "Allow public access to channels" confirmed **OFF** by anon
      private-channel probe. Ownership route confirmed by the inert `zz_probe_delete_me` probe.
      `pg_policies` for `realtime.messages` snapshotted into the rollout doc. Security advisors:
      0 lints.
- [x] **1.** Apply `0001_plan_rooms.sql` — `public` objects only, purely additive, nothing reads
      it until the client ships.
- [x] **2.** Verify by catalog query: three tables exist, RLS on, no client write policies, and
      **`has_table_privilege('anon', …)` false for all three tables** — that last one is the
      anon-moat evidence that no behavioural test can produce.
- [ ] **3.** **Merge the PR and let Vercel deploy.** *Maria merges — Claude never does.* Watch
      room create/join for errors.
- [ ] **3a.** **Re-run the ownership probe** in the same session you are about to use. It is
      platform behaviour, not a standard guarantee. If it returns `42501`, stop.
- [ ] **3b.** **Re-run the anon Realtime probe.** A dashboard toggle silently nullifies every
      policy in this track.
- [ ] **4.** Apply `supabase/manual/0002_realtime_membership_policies.sql` over a privileged SQL
      session. Additive: the broad policies still OR in, so this cannot break a live room.
- [ ] **5.** Verify by catalog query: 4 policies on `realtime.messages` — 2 membership-scoped,
      2 broad.
- [ ] **6.** Two real accounts complete a room end to end.
- [ ] **7.** Third, uninvited account: confirm it **CAN** still get in at this stage. The broad
      policy still permits it, and this baseline is what makes step 9 provable.
- [ ] **8.** Apply `supabase/manual/0003_drop_broad_realtime_policies.sql`. **The only step that
      removes access.** Do not run it before step 3 has actually deployed — with no client
      writing membership rows, this takes Plan Together to 100% dead for 100% of users.
- [ ] **9.** Verify by catalog query: 2 policies, both membership-scoped, zero broad. Repeat
      step 7's attempt — it **must now be denied**. Members from step 6 must be uninterrupted.
- [ ] **10.** Smoke: closure, expiry (disposable room), host handoff across two real sessions.
- [ ] **11.** Confirm no room code reaches analytics: check a PostHog event's `$current_url`
      and properties for a `room=` value.
- [ ] **12.** Remove every temporary room and account, and verify by re-query rather than by
      trusting the delete.
- [ ] **13.** Monitor 48h: `together_room_create/join`, `together_join_denied`,
      `together_room_expired`, `together_host_handoff`, subscribe errors, Vercel runtime errors.
- [ ] **14.** Rollback trigger hit? → re-create the two broad policies verbatim from `0003`'s
      header (one statement pair). Proved by execution on an isolated database, both directions,
      twice. `0001`'s tables are inert without the policies and can stay.

## Before step 3, not after

- [ ] **Retention.** `purge_expired_plan_rooms()` has **no caller** — no cron, no route, no
      scheduled task. `plan_room_members` is a social graph (who planned a night with whom, and
      when) and without a caller it accumulates forever. Harmless while the tables are empty,
      which is why it does not block step 1 — but wire it or accept it **in writing** before real
      rows start landing at step 3.
- [ ] **Decision date.** If the PR is not merged within two weeks, drop `0001`'s objects.
      Empty inert tables are harmless; *forgotten* empty inert tables are how schema drift
      becomes permanent.
